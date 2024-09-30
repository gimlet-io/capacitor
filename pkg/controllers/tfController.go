package controllers

import (
	"encoding/json"
	"fmt"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

var tfResource = schema.GroupVersionResource{
	Group:    "infra.contrib.fluxcd.io",
	Version:  "v1alpha2",
	Resource: "terraforms",
}

func TfController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	return NewDynamicController(
		"terraforms.infra.contrib.fluxcd.io",
		dynamicClient,
		tfResource,
		func(informerEvent Event, objectMeta metav1.ObjectMeta, obj interface{}) error {
			fmt.Println("GOT EVENT", informerEvent.eventType, informerEvent)
			switch informerEvent.eventType {
			case "create":
				fallthrough
			case "update":
				fallthrough
			case "delete":
				fluxState, err := flux.State(client, dynamicClient)
				if err != nil {
					logrus.Warnf("could not get flux state: %s", err)
					return nil
				}
				fluxStateBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.FLUX_STATE_RECEIVED,
					Payload: fluxState,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- fluxStateBytes
			}
			return nil
		})
}
