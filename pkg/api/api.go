package api

import (
	"encoding/json"
	"net/http"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/sirupsen/logrus"
	"k8s.io/client-go/dynamic"
)

func fluxStateHandler(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)

	fluxState, err := flux.GetFluxState(dynamicClient)
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

	inventory, err := flux.GetFluxInventory(dynamicClient)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
	}

	servicesBytes, err := json.Marshal(inventory)
	if err != nil {
		logrus.Errorf(err.Error())
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("{}"))
	}

	w.WriteHeader(http.StatusOK)
	w.Write(servicesBytes)
}
