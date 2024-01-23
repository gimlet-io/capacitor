package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

var gitRepositoryResource = schema.GroupVersionResource{
	Group:    "source.toolkit.fluxcd.io",
	Version:  "v1",
	Resource: "gitrepositories",
}

func GitRepositoryController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) *Controller {
	return NewDynamicController(
		"gitrepositories.source.toolkit.fluxcd.io",
		dynamicClient,
		gitRepositoryResource,
		func(informerEvent Event, objectMeta metav1.ObjectMeta, obj interface{}) error {
			switch informerEvent.EventType {
			case "create":
				fallthrough
			case "update":
				fallthrough
			case "delete":
				fluxState, err := flux.State(client, dynamicClient)
				if err != nil {
					panic(err.Error())
				}
				fluxStateBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.FLUX_STATE_RECEIVED,
					Payload: fluxState,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- fluxStateBytes
			}
			return nil
		})
}
