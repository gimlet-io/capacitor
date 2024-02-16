package controllers

import (
	"encoding/json"

	"github.com/gimlet-io/capacitor/pkg/flux"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
	meta_v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

func DeploymentController(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	clientHub *streaming.ClientHub,
) (*Controller, error) {
	deploymentListWatcher := cache.NewListWatchFromClient(client.AppsV1().RESTClient(), "deployments", v1.NamespaceAll, fields.Everything())
	deploymentController := NewController(
		"deployment",
		deploymentListWatcher,
		&apps_v1.Deployment{},
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
	return deploymentController, nil
}
