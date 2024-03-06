package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
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
				createdIngress := obj.(*networking_v1.Ingress)
				ingressBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.INGRESS_CREATED,
					Payload: createdIngress,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- ingressBytes
			case "update":
				ingress := obj.(*networking_v1.Ingress)
				ingressBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.INGRESS_UPDATED,
					Payload: ingress,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- ingressBytes
			case "delete":
				ingressBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.INGRESS_DELETED,
					Payload: informerEvent.key,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- ingressBytes
			}
			return nil
		})
	return ingressController, nil
}
