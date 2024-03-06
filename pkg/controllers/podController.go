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
				createdPod := obj.(*v1.Pod)
				podBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.POD_CREATED,
					Payload: createdPod,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- podBytes
			case "update":
				pod := obj.(*v1.Pod)
				podBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.POD_UPDATED,
					Payload: pod,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- podBytes
			case "delete":
				podBytes, err := json.Marshal(streaming.Envelope{
					Type:    streaming.POD_DELETED,
					Payload: informerEvent.key,
				})
				if err != nil {
					logrus.Warnf("could not marshal event: %s", err)
					return nil
				}
				clientHub.Broadcast <- podBytes
			}
			return nil
		})
	return podController, nil
}
