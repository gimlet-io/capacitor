package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
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
				createdService := obj.(*v1.Service)
				serviceBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICE_CREATED,
					Payload: createdService,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- serviceBytes
			case "update":
				service := obj.(*v1.Service)
				serviceBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICE_UPDATED,
					Payload: service,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- serviceBytes
			case "delete":
				serviceBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICE_DELETED,
					Payload: informerEvent.key,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- serviceBytes
			}
			return nil
		})
	return serviceController, nil
}
