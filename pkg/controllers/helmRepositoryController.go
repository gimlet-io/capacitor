package controllers

import (
	"context"
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

var helmRepositoryResource = schema.GroupVersionResource{
	Group:    "source.toolkit.fluxcd.io",
	Version:  "v1",
	Resource: "helmrepositories",
}

var helmRepositoryResourceV1beta2 = schema.GroupVersionResource{
	Group:    "source.toolkit.fluxcd.io",
	Version:  "v1beta2",
	Resource: "helmrepositories",
}

func HelmRepositoryController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	resource := helmRepositoryResource
	// check if v1 is supported
	_, err := dynamicClient.Resource(resource).Namespace("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		// try and possibly fail (helm-controller is not mandatory) with v1beta2
		resource = helmRepositoryResourceV1beta2
	}
	return NewDynamicController(
		"helmrepositories.source.toolkit.fluxcd.io",
		dynamicClient,
		resource,
		func(informerEvent Event, objectMeta metav1.ObjectMeta, obj interface{}) error {
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
