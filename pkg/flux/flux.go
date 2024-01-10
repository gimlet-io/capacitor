package flux

import (
	"bufio"
	"context"
	"encoding/json"
	"strings"

	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/cli-utils/pkg/object"
)

var (
	kustomizationGVR = schema.GroupVersionResource{
		Group:    "kustomize.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "kustomizations",
	}

	gitRepositoryGVR = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "gitrepositories",
	}
)

func Services(c *kubernetes.Clientset, dc *dynamic.DynamicClient) ([]Service, error) {
	services := []Service{}

	inventory, err := inventory(dc)
	if err != nil {
		return nil, err
	}

	for _, item := range inventory {
		if item.GroupKind.Kind == "Service" {
			svc, err := c.CoreV1().Services(item.Namespace).Get(context.TODO(), item.Name, metav1.GetOptions{})
			if err != nil {
				return nil, err
			}

			services = append(services, Service{
				Svc: *svc,
			})
		}
	}

	deploymentsInNamespaces := map[string][]apps_v1.Deployment{}
	for _, service := range services {
		namespace := service.Svc.Namespace
		if _, ok := deploymentsInNamespaces[namespace]; !ok {
			deployments, err := c.AppsV1().Deployments(namespace).List(context.TODO(), metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			deploymentsInNamespaces[namespace] = deployments.Items
		}
	}

	for idx, service := range services {
		for _, deployment := range deploymentsInNamespaces[service.Svc.Namespace] {
			if selectorsMatch(deployment.Spec.Selector.MatchLabels, service.Svc.Spec.Selector) {
				services[idx].Deployment = &deployment
			}
		}
	}

	pods, err := c.CoreV1().Pods("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for idx, service := range services {
		services[idx].Pods = []v1.Pod{}
		for _, pod := range pods.Items {
			if labelsMatchSelectors(pod.ObjectMeta.Labels, service.Svc.Spec.Selector) {
				services[idx].Pods = append(services[idx].Pods, pod)
			}
		}
	}

	return services, nil
}

func selectorsMatch(first map[string]string, second map[string]string) bool {
	if len(first) != len(second) {
		return false
	}

	for k, v := range first {
		if v2, ok := second[k]; ok {
			if v != v2 {
				return false
			}
		} else {
			return false
		}
	}

	for k2, v2 := range second {
		if v, ok := first[k2]; ok {
			if v2 != v {
				return false
			}
		} else {
			return false
		}
	}

	return true
}

func labelsMatchSelectors(labels map[string]string, selectors map[string]string) bool {
	for k2, v2 := range selectors {
		if v, ok := labels[k2]; ok {
			if v2 != v {
				return false
			}
		} else {
			return false
		}
	}

	return true
}

func inventory(dc *dynamic.DynamicClient) ([]object.ObjMetadata, error) {
	inventory := []object.ObjMetadata{}

	kustomizations, err := dc.Resource(kustomizationGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, k := range kustomizations.Items {
		unstructured := k.UnstructuredContent()
		var kustomization kustomizationv1.Kustomization
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &kustomization)
		if err != nil {
			return nil, err
		}

		if kustomization.Status.Inventory == nil {
			continue
		}
		for _, entry := range kustomization.Status.Inventory.Entries {
			objMeta, err := object.ParseObjMetadata(entry.ID)
			if err != nil {
				return nil, err
			}

			inventory = append(inventory, objMeta)
		}
	}

	return inventory, nil
}

func State(dc *dynamic.DynamicClient) (*FluxState, error) {
	fluxState := &FluxState{
		GitRepositories: []sourcev1.GitRepository{},
		Kustomizations:  []kustomizationv1.Kustomization{},
	}

	gitRepositories, err := dc.Resource(gitRepositoryGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, repo := range gitRepositories.Items {
		unstructured := repo.UnstructuredContent()
		var gitRepository sourcev1.GitRepository
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &gitRepository)
		if err != nil {
			return nil, err
		}
		fluxState.GitRepositories = append(fluxState.GitRepositories, gitRepository)
	}

	kustomizations, err := dc.Resource(kustomizationGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, k := range kustomizations.Items {
		unstructured := k.UnstructuredContent()
		var kustomization kustomizationv1.Kustomization
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &kustomization)
		if err != nil {
			return nil, err
		}
		fluxState.Kustomizations = append(fluxState.Kustomizations, kustomization)
	}

	return fluxState, nil
}

func PodLogs(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	namespace string,
	serviceName string,
	clientHub *streaming.ClientHub,
	runningLogStreams *RunningLogStreams,
) {
	services, err := Services(client, dynamicClient)
	if err != nil {
		logrus.Errorf("could not get services: %v", err)
		return
	}

	pods := []v1.Pod{}
	for _, s := range services {
		if s.Svc.Namespace == namespace && s.Svc.Name == serviceName {
			pods = s.Pods
		}
	}

	for _, pod := range pods {
		containers := podContainers(pod.Spec)
		for _, container := range containers {
			go streamPodLogs(client, namespace, pod.Name, container.Name, serviceName, clientHub, runningLogStreams)
		}
	}
}

func podContainers(podSpec v1.PodSpec) (containers []v1.Container) {
	containers = append(containers, podSpec.InitContainers...)
	containers = append(containers, podSpec.Containers...)

	return containers
}

func streamPodLogs(
	client *kubernetes.Clientset,
	namespace string,
	pod string,
	containerName string,
	serviceName string,
	clientHub *streaming.ClientHub,
	runningLogStreams *RunningLogStreams,
) {
	count := int64(100)
	podLogOpts := v1.PodLogOptions{
		Container:  containerName,
		TailLines:  &count,
		Follow:     true,
		Timestamps: true,
	}
	logsReq := client.CoreV1().Pods(namespace).GetLogs(pod, &podLogOpts)

	podLogs, err := logsReq.Stream(context.Background())
	if err != nil {
		logrus.Errorf("could not stream pod logs: %v", err)
		return
	}
	defer podLogs.Close()

	stopCh := make(chan int)
	runningLogStreams.Regsiter(stopCh, namespace, serviceName)

	go func() {
		<-stopCh
		podLogs.Close()
	}()

	sc := bufio.NewScanner(podLogs)
	for sc.Scan() {
		text := sc.Text()
		chunks := chunks(text, 1000)
		for _, chunk := range chunks {
			timestamp, message := parseMessage(chunk)
			payload := streaming.PodLogMessage{
				Timestamp: timestamp,
				Container: containerName,
				Pod:       pod,
				Svc:       namespace + "/" + serviceName,
				Message:   message,
			}

			msgBytes, err := json.Marshal(streaming.Envelope{
				Type:    streaming.POD_LOGS_RECEIVED,
				Payload: payload,
			})
			if err != nil {
				logrus.Error("cannot serialize message", err)
			}

			clientHub.Broadcast <- msgBytes
		}
	}
}

func chunks(str string, size int) []string {
	if len(str) <= size {
		return []string{str}
	}
	return append([]string{string(str[0:size])}, chunks(str[size:], size)...)
}

func parseMessage(chunk string) (string, string) {
	parts := strings.SplitN(chunk, " ", 2)

	return parts[0], parts[1]
}
