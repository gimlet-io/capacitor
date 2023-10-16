package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/gimlet-io/capacitor/pkg/controllers"
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

	gitRepositories, err := dynamicClient.
		Resource(schema.GroupVersionResource{
			Group:    "source.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "gitrepositories",
		}).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		panic(err.Error())
	}

	for _, repo := range gitRepositories.Items {
		unstructured := repo.UnstructuredContent()

		var gitRepository sourcev1.GitRepository
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &gitRepository)
		if err != nil {
			panic(err.Error())
		}

		fmt.Printf("%s\n", gitRepository.Name)
	}

	kustomizations, err := dynamicClient.
		Resource(schema.GroupVersionResource{
			Group:    "kustomize.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "kustomizations",
		}).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		panic(err.Error())
	}

	for _, k := range kustomizations.Items {
		unstructured := k.UnstructuredContent()

		var kustomization kustomizationv1.Kustomization
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &kustomization)
		if err != nil {
			panic(err.Error())
		}

		fmt.Printf("%s\n", kustomization.Name)
	}

	var gitRepositoryResource = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "gitrepositories",
	}

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
			}
			return nil
		})

	stopCh := make(chan struct{})
	defer close(stopCh)

	go ctrl.Run(1, stopCh)

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
