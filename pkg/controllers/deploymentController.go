package controllers

import (
	"encoding/json"

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
				createdDeployment := obj.(*apps_v1.Deployment)
				deploymentBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.DEPLOYMENT_CREATED,
					Payload: createdDeployment,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- deploymentBytes
			case "update":
				deployment := obj.(*apps_v1.Deployment)
				deploymentBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.DEPLOYMENT_UPDATED,
					Payload: deployment,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- deploymentBytes
			case "delete":
				deploymentBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.DEPLOYMENT_DELETED,
					Payload: informerEvent.key,
				})
				if err != nil {
					panic(err.Error())
				}
				clientHub.Broadcast <- deploymentBytes
			}
			return nil
		})
	return deploymentController, nil
}
