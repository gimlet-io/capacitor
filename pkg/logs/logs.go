package logs

import (
	"bufio"
	"context"
	"encoding/json"
	"strings"

	"github.com/gimlet-io/capacitor/pkg/k8s"
	"github.com/gimlet-io/capacitor/pkg/streaming"
	"github.com/sirupsen/logrus"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

func Logs(
	client *kubernetes.Clientset,
	dynamicClient *dynamic.DynamicClient,
	namespace string,
	deploymentName string,
	clientHub *streaming.ClientHub,
	runningLogStreams *RunningLogStreams,
) {
	pods, err := pods(client, namespace, deploymentName)
	if err != nil {
		logrus.Warnf("could not get pods to stream logs: %v", err)
		return
	}

	for _, pod := range pods {
		containers := podContainers(pod.Spec)
		for _, container := range containers {
			go streamLogs(client, namespace, pod.Name, container.Name, deploymentName, clientHub, runningLogStreams)
		}
	}
}

func pods(client *kubernetes.Clientset, namespace string, deploymentName string) ([]v1.Pod, error) {
	deployment, err := client.AppsV1().Deployments(namespace).Get(context.TODO(), deploymentName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	podsInNamespace, err := client.CoreV1().Pods(namespace).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	pods := []v1.Pod{}
	for _, pod := range podsInNamespace.Items {
		if k8s.LabelsMatchSelectors(pod.ObjectMeta.Labels, deployment.Spec.Selector.MatchLabels) {
			pods = append(pods, pod)
		}
	}

	return pods, nil
}

func podContainers(podSpec v1.PodSpec) (containers []v1.Container) {
	containers = append(containers, podSpec.InitContainers...)
	containers = append(containers, podSpec.Containers...)

	return containers
}

func streamLogs(
	client *kubernetes.Clientset,
	namespace string,
	pod string,
	containerName string,
	deploymentName string,
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

	stopCh := runningLogStreams.register(namespace, deploymentName)

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
				Timestamp:  timestamp,
				Container:  containerName,
				Pod:        pod,
				Deployment: namespace + "/" + deploymentName,
				Message:    message,
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

	if len(parts) != 2 {
		return "", parts[0]
	}

	return parts[0], parts[1]
}
