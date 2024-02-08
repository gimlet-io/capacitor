package main

import (
	"flag"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gimlet-io/capacitor/pkg/api"
	"github.com/gimlet-io/capacitor/pkg/controllers"
	"github.com/gimlet-io/capacitor/pkg/logs"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

func main() {
	var kubeconfig = flag.String("kubeconfig", "", "absolute path to the kubeconfig file")
	flag.Parse()

	// use the current context in kubeconfig
	config, err := clientcmd.BuildConfigFromFlags("", *kubeconfig)
	if err != nil {
		panic(err.Error())
	}

	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		panic(err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		panic(err.Error())
	}

	runningLogStreams := logs.NewRunningLogStreams()

	stopCh := make(chan struct{})
	defer close(stopCh)

	clientHub := streaming.NewClientHub()
	go clientHub.Run()

	gitRepositoryController, err := controllers.GitRepositoryController(client, dynamicClient, clientHub)
	runController(err, gitRepositoryController, stopCh)
	ociRepositoryController, err := controllers.OciRepositoryController(client, dynamicClient, clientHub)
	runController(err, ociRepositoryController, stopCh)
	bucketController, err := controllers.BucketController(client, dynamicClient, clientHub)
	runController(err, bucketController, stopCh)
	kustomizationController, err := controllers.KustomizeController(client, dynamicClient, clientHub)
	runController(err, kustomizationController, stopCh)
	helmReleaseController, err := controllers.HelmReleaseController(client, dynamicClient, clientHub)
	runController(err, helmReleaseController, stopCh)

	r := api.SetupRouter(client, dynamicClient, config, clientHub, runningLogStreams)
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

func runController(err error, controller *controllers.Controller, stopCh chan struct{}) {
	if err != nil {
		logrus.Warn(err)
	} else {
		go controller.Run(1, stopCh)
	}
}
