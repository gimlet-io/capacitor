package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/gimlet-io/capacitor/pkg/controllers"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
)

func main() {
	fmt.Println("Capacitor starting..")

	fmt.Println("Connecting to Kubernetes..")

	var kubeconfig = flag.String("kubeconfig", "", "absolute path to the kubeconfig file")
	flag.Parse()

	// use the current context in kubeconfig
	config, err := clientcmd.BuildConfigFromFlags("", *kubeconfig)
	if err != nil {
		panic(err.Error())
	}

	fmt.Println("--- Flux custom resources ---")
	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		panic(err.Error())
	}

	fluxState, err := getFluxState(dynamicClient)
	if err != nil {
		panic(err.Error())
	}
	fluxStateBytes, err := json.Marshal(fluxState)
	if err != nil {
		panic(err.Error())
	}
	fmt.Println(string(fluxStateBytes))

	var gitRepositoryResource = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "gitrepositories",
	}

	stopCh := make(chan struct{})
	defer close(stopCh)

	clientHub := streaming.NewClientHub()
	go clientHub.Run()

	ctrl := controllers.NewDynamicController(
		"gitrepositories.source.toolkit.fluxcd.io",
		dynamicClient,
		gitRepositoryResource,
		func(informerEvent controllers.Event, objectMeta metav1.ObjectMeta, obj interface{}) error {
			switch informerEvent.EventType {
			case "create":
				fallthrough
			case "update":
				fallthrough
			case "delete":
				fmt.Printf("Changes in %s\n", objectMeta.Name)
				fluxState, err := getFluxState(dynamicClient)
				if err != nil {
					panic(err.Error())
				}
				fluxStateBytes, err := json.Marshal(fluxState)
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- fluxStateBytes
			}
			return nil
		})
	go ctrl.Run(1, stopCh)

	r := setupRouter(dynamicClient, clientHub)
	go func() {
		err = http.ListenAndServe(":9000", r)
		if err != nil {
			panic(err)
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)

	done := make(chan bool, 1)

	// This goroutine executes a blocking receive for signals.
	// When it gets one it’ll print it out and then notify the program that it can finish.
	go func() {
		sig := <-signals
		logrus.Info(sig)
		done <- true
	}()

	logrus.Info("Initialized")
	<-done
	logrus.Info("Exiting")
}

type fluxState struct {
	GitRepositories []sourcev1.GitRepository        `json:"gitRepositories"`
	Kustomizations  []kustomizationv1.Kustomization `json:"kustomizations"`
}

func getFluxState(dc *dynamic.DynamicClient) (*fluxState, error) {
	fluxState := &fluxState{
		GitRepositories: []sourcev1.GitRepository{},
		Kustomizations:  []kustomizationv1.Kustomization{},
	}

	gitRepositories, err := dc.Resource(schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "gitrepositories",
	}).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, repo := range gitRepositories.Items {
		unstructured := repo.UnstructuredContent()
		var gitRepository sourcev1.GitRepository
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &gitRepository)
		if err != nil {
			return nil, err
		}
		fluxState.GitRepositories = append(fluxState.GitRepositories, gitRepository)
	}

	kustomizations, err := dc.Resource(schema.GroupVersionResource{
		Group:    "kustomize.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "kustomizations",
	}).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, k := range kustomizations.Items {
		unstructured := k.UnstructuredContent()
		var kustomization kustomizationv1.Kustomization
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &kustomization)
		if err != nil {
			return nil, err
		}
		fluxState.Kustomizations = append(fluxState.Kustomizations, kustomization)
	}

	return fluxState, nil
}

func setupRouter(
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.WithValue("dynamicClient", dynamicClient))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/api/fluxState", fluxStateHandler)
	r.Get("/ws/", func(w http.ResponseWriter, r *http.Request) {
		streaming.ServeWs(clientHub, w, r)
	})

	filesDir := http.Dir("./web/build")
	fileServer(r, "/", filesDir)

	return r
}

// static files from a http.FileSystem
func fileServer(r chi.Router, path string, root http.FileSystem) {
	if strings.ContainsAny(path, "{}*") {
		//TODO: serve all React routes https://github.com/go-chi/chi/issues/403
		panic("FileServer does not permit any URL parameters.")
	}

	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", http.StatusMovedPermanently).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		ctx := chi.RouteContext(r.Context())
		pathPrefix := strings.TrimSuffix(ctx.RoutePattern(), "/*")
		fs := http.StripPrefix(pathPrefix, http.FileServer(root))
		fs.ServeHTTP(w, r)
	})
}

func fluxStateHandler(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)

	fluxState, err := getFluxState(dynamicClient)
	if err != nil {
		panic(err.Error())
	}
	fluxStateBytes, err := json.Marshal(fluxState)
	if err != nil {
		panic(err.Error())
	}

	w.WriteHeader(http.StatusOK)
	w.Write(fluxStateBytes)
}
