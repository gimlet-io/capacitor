package flux

import (
	"bytes"
	"context"
	"fmt"

	helmv2beta1 "github.com/fluxcd/helm-controller/api/v2beta1"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/gimlet-io/capacitor/pkg/k8s"
	"github.com/sirupsen/logrus"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/kube"
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

	helmReleaseGVR = schema.GroupVersionResource{
		Group:    "helm.toolkit.fluxcd.io",
		Version:  "v2beta1",
		Resource: "helmreleases",
	}
)

func helmServices(dc *dynamic.DynamicClient) ([]Service, error) {
	helmReleases, err := helmReleases(dc)
	if err != nil {
		return nil, err
	}

	services := []Service{}
	for _, release := range helmReleases {
		resources, err := helmStatusWithResources(release.Spec.ReleaseName)
		if err != nil {
			logrus.Warnf("could not get helm status for %s: %s", release.Spec.ReleaseName, err.Error())
			continue
		}

		if objs, found := resources["v1/Service"]; found {
			svc := v1.Service{}
			for _, obj := range objs {
				unstructured, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
				if err != nil {
					logrus.Warnf("could not convert to unstructured: %s", err.Error())
					continue
				}

				err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &svc)
				if err != nil {
					logrus.Warnf("could not convert from unstructured: %s", err.Error())
					continue
				}

				services = append(services, Service{
					Svc:         svc,
					HelmRelease: release.Name,
				})
			}
		}
	}

	return services, nil
}

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

	helmServices, err := helmServices(dc)
	if err != nil {
		return nil, err
	}

	services = append(services, helmServices...)

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
			if k8s.SelectorsMatch(deployment.Spec.Selector.MatchLabels, service.Svc.Spec.Selector) {
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
			if k8s.LabelsMatchSelectors(pod.ObjectMeta.Labels, service.Svc.Spec.Selector) {
				services[idx].Pods = append(services[idx].Pods, pod)
			}
		}
	}

	return services, nil
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

func helmReleases(dc *dynamic.DynamicClient) ([]helmv2beta1.HelmRelease, error) {
	releases := []helmv2beta1.HelmRelease{}

	helmReleases, err := dc.Resource(helmReleaseGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, h := range helmReleases.Items {
		unstructured := h.UnstructuredContent()
		var helmRelease helmv2beta1.HelmRelease
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &helmRelease)
		if err != nil {
			return nil, err
		}

		releases = append(releases, helmRelease)
	}

	return releases, nil
}

func helmStatusWithResources(releaseName string) (map[string][]runtime.Object, error) {
	actionConfig := action.Configuration{}
	actionConfig.Init(cli.New().RESTClientGetter(), "", "", nil)

	r, err := actionConfig.Releases.Last(releaseName)
	if err != nil {
		return nil, err
	}

	kubeClient, ok := actionConfig.KubeClient.(kube.InterfaceResources)
	if !ok {
		return nil, fmt.Errorf("unable to get kubeClient with interface InterfaceResources")
	}

	resources, err := actionConfig.KubeClient.Build(bytes.NewBufferString(r.Manifest), false)
	if err != nil {
		return nil, err
	}

	resp, err := kubeClient.Get(resources, false)
	if err != nil {
		return nil, err
	}

	return resp, nil
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

	helmReleases, err := dc.Resource(helmReleaseGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, h := range helmReleases.Items {
		unstructured := h.UnstructuredContent()
		var helmRelease helmv2beta1.HelmRelease
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &helmRelease)
		if err != nil {
			return nil, err
		}
		fluxState.HelmReleases = append(fluxState.HelmReleases, helmRelease)
	}

	return fluxState, nil
}
