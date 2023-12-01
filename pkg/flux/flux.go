package flux

import (
	"context"

	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
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
