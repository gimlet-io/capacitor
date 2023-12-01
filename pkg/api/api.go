package api

import (
	"encoding/json"
	"net/http"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/sirupsen/logrus"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

func fluxStateHandler(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)

	fluxState, err := flux.State(dynamicClient)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
	}
	fluxStateBytes, err := json.Marshal(fluxState)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
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
	}

	servicesBytes, err := json.Marshal(services)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
	}

	w.WriteHeader(http.StatusOK)
	w.Write(servicesBytes)
}
