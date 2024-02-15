package api

import (
	"encoding/json"
	"net/http"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/logs"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/kubectl/pkg/describe"
)

func fluxStateHandler(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)
	client, _ := r.Context().Value("client").(*kubernetes.Clientset)

	fluxState, err := flux.State(client, dynamicClient)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
		return
	}
	fluxStateBytes, err := json.Marshal(fluxState)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write(fluxStateBytes)
}

func fluxEvents(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)
	client, _ := r.Context().Value("client").(*kubernetes.Clientset)

	events, err := flux.Events(client, dynamicClient)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
		return
	}
	fluxStateBytes, err := json.Marshal(events)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write(fluxStateBytes)
}

func servicesHandler(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)
	client, _ := r.Context().Value("client").(*kubernetes.Clientset)

	services, err := flux.Services(client, dynamicClient)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
		return
	}

	servicesBytes, err := json.Marshal(services)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write(servicesBytes)
}

func describeConfigmap(w http.ResponseWriter, r *http.Request) {
	config, _ := r.Context().Value("config").(*rest.Config)
	namespace := r.URL.Query().Get("namespace")
	name := r.URL.Query().Get("name")

	describer, ok := describe.DescriberFor(schema.GroupKind{Group: "", Kind: "ConfigMap"}, config)
	if !ok {
		logrus.Errorf("could not get describer for configmap")
		return
	}

	output, err := describer.Describe(namespace, name, describe.DescriberSettings{ShowEvents: true, ChunkSize: 500})
	if err != nil {
		logrus.Errorf("could not get output of describer: %s", err)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(output))
}

func describeSecret(w http.ResponseWriter, r *http.Request) {
	config, _ := r.Context().Value("config").(*rest.Config)
	namespace := r.URL.Query().Get("namespace")
	name := r.URL.Query().Get("name")

	describer, ok := describe.DescriberFor(schema.GroupKind{Group: "", Kind: "Secret"}, config)
	if !ok {
		logrus.Errorf("could not get describer for secret")
		return
	}

	output, err := describer.Describe(namespace, name, describe.DescriberSettings{ShowEvents: true, ChunkSize: 500})
	if err != nil {
		logrus.Errorf("could not get output of describer: %s", err)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(output))
}

func describeDeployment(w http.ResponseWriter, r *http.Request) {
	config, _ := r.Context().Value("config").(*rest.Config)
	namespace := r.URL.Query().Get("namespace")
	name := r.URL.Query().Get("name")

	describer, ok := describe.DescriberFor(schema.GroupKind{Group: apps_v1.GroupName, Kind: "Deployment"}, config)
	if !ok {
		logrus.Errorf("could not get describer for deployment")
		return
	}

	output, err := describer.Describe(namespace, name, describe.DescriberSettings{ShowEvents: true, ChunkSize: 500})
	if err != nil {
		logrus.Errorf("could not get output of describer: %s", err)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(output))
}

func describePod(w http.ResponseWriter, r *http.Request) {
	config, _ := r.Context().Value("config").(*rest.Config)
	namespace := r.URL.Query().Get("namespace")
	name := r.URL.Query().Get("name")

	describer, ok := describe.DescriberFor(schema.GroupKind{Group: v1.GroupName, Kind: "Pod"}, config)
	if !ok {
		logrus.Errorf("could not get describer for pod")
		return
	}

	output, err := describer.Describe(namespace, name, describe.DescriberSettings{ShowEvents: true, ChunkSize: 500})
	if err != nil {
		logrus.Errorf("could not get output of describer: %s", err)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(output))
}

func streamLogs(w http.ResponseWriter, r *http.Request) {
	namespace := r.URL.Query().Get("namespace")
	deployment := r.URL.Query().Get("deploymentName")
	runningLogStreams, _ := r.Context().Value("runningLogStreams").(*logs.RunningLogStreams)
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)
	client, _ := r.Context().Value("client").(*kubernetes.Clientset)
	clientHub, _ := r.Context().Value("clientHub").(*streaming.ClientHub)

	go logs.Logs(
		client,
		dynamicClient,
		namespace,
		deployment,
		clientHub,
		runningLogStreams,
	)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("{}"))
}

func stopLogs(w http.ResponseWriter, r *http.Request) {
	namespace := r.URL.Query().Get("namespace")
	deployment := r.URL.Query().Get("deploymentName")
	runningLogStreams, _ := r.Context().Value("runningLogStreams").(*logs.RunningLogStreams)

	runningLogStreams.Stop(namespace, deployment)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("{}"))
}

func reconcile(w http.ResponseWriter, r *http.Request) {
	resource := r.URL.Query().Get("resource")
	namespace := r.URL.Query().Get("namespace")
	name := r.URL.Query().Get("name")
	config, _ := r.Context().Value("config").(*rest.Config)

	reconcileCommand := flux.NewReconcileCommand(resource)
	go reconcileCommand.Run(config, namespace, name)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("{}"))
}
