package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	v1 "k8s.io/api/core/v1"
	networking_v1 "k8s.io/api/networking/v1"
	meta_v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

func IngressController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	ingressListWatcher := cache.NewListWatchFromClient(client.NetworkingV1().RESTClient(), "ingresses", v1.NamespaceAll, fields.Everything())
	ingressController := NewController(
		"ingress",
		ingressListWatcher,
		&networking_v1.Ingress{},
		func(informerEvent Event, objectMeta meta_v1.ObjectMeta, obj interface{}) error {
			switch informerEvent.eventType {
			case "create":
				fallthrough
			case "update":
				fallthrough
			case "delete":
				services, err := flux.Services(client, dynamicClient)
				if err != nil {
					panic(err.Error())
				}
				servicesBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.SERVICES_RECEIVED,
					Payload: services,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- servicesBytes
			}
			return nil
		})
	return ingressController, nil
}
