package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/streaming"
	v1 "k8s.io/api/core/v1"
	meta_v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

func ServiceController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	serviceListWatcher := cache.NewListWatchFromClient(client.CoreV1().RESTClient(), "services", v1.NamespaceAll, fields.Everything())
	serviceController := NewController(
		"service",
		serviceListWatcher,
		&v1.Service{},
		func(informerEvent Event, objectMeta meta_v1.ObjectMeta, obj interface{}) error {
			switch informerEvent.eventType {
			case "create":
				serviceBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICE_CREATED,
					Payload: obj,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- serviceBytes
			case "update":
				serviceBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICE_UPDATED,
					Payload: obj,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- serviceBytes
			case "delete":
				serviceBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICE_DELETED,
					Payload: informerEvent.key,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- serviceBytes
			}
			return nil
		})
	return serviceController, nil
}
