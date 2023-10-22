package api

import (
	"encoding/json"
	"net/http"

	"k8s.io/client-go/dynamic"
	"github.com/gimlet-io/capacitor/pkg/flux"
)

func fluxStateHandler(w http.ResponseWriter, r *http.Request) {
	dynamicClient, _ := r.Context().Value("dynamicClient").(*dynamic.DynamicClient)

	fluxState, err := flux.GetFluxState(dynamicClient)
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
