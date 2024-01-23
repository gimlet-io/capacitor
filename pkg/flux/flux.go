package flux

import (
	"bytes"
	"context"
	"fmt"
	"time"

	helmv2beta1 "github.com/fluxcd/helm-controller/api/v2beta1"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/gimlet-io/capacitor/pkg/k8s"
	"github.com/sirupsen/logrus"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/kube"
	rspb "helm.sh/helm/v3/pkg/release"
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

	actionConfig := action.Configuration{}
	actionConfig.Init(cli.New().RESTClientGetter(), "", "", nil)
	releases, err := actionConfig.Releases.ListReleases()
	if err != nil {
		return nil, err
	}

	serviceResourceList := kube.ResourceList{}
	for _, release := range helmReleases {
		serviceList, err := helmStatusWithResources(releases, release.Spec.ReleaseName, release.Namespace)
		if err != nil {
			logrus.Warnf("could not get helm status for %s: %s", release.Spec.ReleaseName, err.Error())
			continue
		}

		for _, i := range serviceList {
			serviceResourceList.Append(i)
		}
	}

	kubeClient, ok := actionConfig.KubeClient.(kube.InterfaceResources)
	if !ok {
		return nil, fmt.Errorf("unable to get kubeClient with interface InterfaceResources")
	}

	resources, err := kubeClient.Get(serviceResourceList, false)
	if err != nil {
		return nil, err
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

			var helmReleaseName string
			for label, value := range svc.ObjectMeta.Labels {
				if label == "helm.toolkit.fluxcd.io/name" {
					helmReleaseName = value
				}
			}

			services = append(services, Service{
				Svc:         svc,
				HelmRelease: helmReleaseName,
			})
		}
	}

	return services, nil
}

func Services(c *kubernetes.Clientset, dc *dynamic.DynamicClient) ([]Service, error) {
	services := []Service{}

	t0 := time.Now().UnixMilli()
	inventory, err := inventory(dc)
	if err != nil {
		return nil, err
	}
	fmt.Printf("inventory: %d", time.Now().UnixMilli()-t0)

	t0 = time.Now().UnixMilli()
	servicesInNamespaces := map[string][]v1.Service{}
	for _, item := range inventory {
		if item.GroupKind.Kind == "Service" {
			if _, ok := servicesInNamespaces[item.Namespace]; !ok {
				services, err := c.CoreV1().Services(item.Namespace).List(context.TODO(), metav1.ListOptions{})
				if err != nil {
					return nil, err
				}
				servicesInNamespaces[item.Namespace] = services.Items
			}

			for _, svc := range servicesInNamespaces[item.Namespace] {
				if svc.ObjectMeta.Namespace == item.Namespace &&
					svc.ObjectMeta.Name == item.Name {
					services = append(services, Service{
						Svc: svc,
					})
				}
			}
		}
	}
	fmt.Printf("services: %d", time.Now().UnixMilli()-t0)

	t0 = time.Now().UnixMilli()
	helmServices, err := helmServices(dc)
	if err != nil {
		return nil, err
	}
	fmt.Printf("helm services: %d", time.Now().UnixMilli()-t0)

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
				d := deployment
				services[idx].Deployment = &d
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

func helmStatusWithResources(
	releases []*rspb.Release,
	releaseName string,
	namespace string,
) (kube.ResourceList, error) {
	var release *rspb.Release
	version := -1
	for _, r := range releases {
		if r.Namespace == namespace && r.Name == releaseName {
			if r.Version > version {
				release = r
				version = r.Version
			}
		}
	}
	if release == nil {
		return nil, fmt.Errorf("could not find helm release %s", releaseName)
	}

	actionConfig := action.Configuration{}
	actionConfig.Init(cli.New().RESTClientGetter(), "", "", nil)

	resources, err := actionConfig.KubeClient.Build(bytes.NewBufferString(release.Manifest), false)
	if err != nil {
		return nil, err
	}

	services := kube.ResourceList{}
	for _, r := range resources {
		gvk := r.Object.GetObjectKind().GroupVersionKind()
		if gvk.Version == "v1" && gvk.Kind == "Service" {
			services.Append(r)
		}
	}

	return services, nil
}

func State(c *kubernetes.Clientset, dc *dynamic.DynamicClient) (*FluxState, error) {
	fluxState := &FluxState{
		GitRepositories: []sourcev1.GitRepository{},
		Kustomizations:  []kustomizationv1.Kustomization{},
		HelmReleases:    []helmv2beta1.HelmRelease{},
		FluxServices:    []Service{},
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

	fluxServices, err := fluxServicesWithDetails(c)
	if err != nil {
		return nil, err
	}
	fluxState.FluxServices = fluxServices

	return fluxState, nil
}

func fluxServicesWithDetails(c *kubernetes.Clientset) ([]Service, error) {
	services := []Service{}
	svc, err := c.CoreV1().Services("flux-system").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, service := range svc.Items {
		services = append(services, Service{
			Svc: service,
		})
	}

	deployments, err := c.AppsV1().Deployments("flux-system").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for idx, service := range services {
		for _, d := range deployments.Items {
			if k8s.SelectorsMatch(d.Spec.Selector.MatchLabels, service.Svc.Spec.Selector) {
				deployment := d
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
