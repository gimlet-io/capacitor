package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	v1 "k8s.io/api/core/v1"
	meta_v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

func EventController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	eventListWatcher := cache.NewListWatchFromClient(client.CoreV1().RESTClient(), "events", v1.NamespaceAll, fields.Everything())
	eventController := NewController(
		"event",
		eventListWatcher,
		&v1.Event{},
		func(informerEvent Event, objectMeta meta_v1.ObjectMeta, obj interface{}) error {
			if _, ok := obj.(*v1.Event); !ok {
				return nil
			}

			if flux.IgnoreEvent(*obj.(*v1.Event)) {
				return nil
			}

			events, err := flux.Events(client, dynamicClient)
			if err != nil {
				return err
			}

			eventBytes, err := json.Marshal(streaming.Envelope{
				Type:    streaming.FLUX_EVENTS_RECEIVED,
				Payload: events,
			})
			if err != nil {
				panic(err.Error())
			}
			clientHub.Broadcast <- eventBytes
			return nil
		})
	return eventController, nil
}
