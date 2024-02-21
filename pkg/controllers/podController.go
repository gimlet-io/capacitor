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

func PodController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	podListWatcher := cache.NewListWatchFromClient(client.CoreV1().RESTClient(), "pods", v1.NamespaceAll, fields.Everything())
	podController := NewController(
		"pod",
		podListWatcher,
		&v1.Pod{},
		func(informerEvent Event, objectMeta meta_v1.ObjectMeta, obj interface{}) error {
			switch informerEvent.eventType {
			case "create":
				podBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.POD_CREATED,
					Payload: obj,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- podBytes
			case "update":
				podBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.POD_UPDATED,
					Payload: obj,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- podBytes
			case "delete":
				podBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.POD_DELETED,
					Payload: informerEvent.key,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- podBytes
			}
			return nil
		})
	return podController, nil
}
