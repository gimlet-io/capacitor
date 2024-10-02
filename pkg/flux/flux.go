package flux

import (
	"bytes"
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"

	tf "github.com/flux-iac/tofu-controller/api/v1alpha2"
	helmv2beta2 "github.com/fluxcd/helm-controller/api/v2beta2"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	sourcev1beta2 "github.com/fluxcd/source-controller/api/v1beta2"
	"github.com/gimlet-io/capacitor/pkg/k8s"
	"github.com/sirupsen/logrus"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/kube"
	rspb "helm.sh/helm/v3/pkg/release"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
	networking_v1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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

	ociRepositoryGVR = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1beta2",
		Resource: "ocirepositories",
	}

	tfResourceGVR = schema.GroupVersionResource{
		Group:    "infra.contrib.fluxcd.io",
		Version:  "v1alpha2",
		Resource: "terraforms",
	}

	bucketGVR = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1beta2",
		Resource: "buckets",
	}

	helmReleaseGVR = schema.GroupVersionResource{
		Group:    "helm.toolkit.fluxcd.io",
		Version:  "v2",
		Resource: "helmreleases",
	}

	helmReleaseGVRV2beta2 = schema.GroupVersionResource{
		Group:    "helm.toolkit.fluxcd.io",
		Version:  "v2beta2",
		Resource: "helmreleases",
	}

	helmReleaseGVRV2beta1 = schema.GroupVersionResource{
		Group:    "helm.toolkit.fluxcd.io",
		Version:  "v2beta1",
		Resource: "helmreleases",
	}

	helmRepositoryGVR = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1beta2",
		Resource: "helmrepositories",
	}

	helmChartGVR = schema.GroupVersionResource{
		Group:    "source.toolkit.fluxcd.io",
		Version:  "v1beta2",
		Resource: "helmcharts",
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
		serviceList, err := helmStatusWithResources(releases, release)
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

			services = append(services, Service{
				Svc: svc,
			})
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

	i, err := c.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for idx, service := range services {
		services[idx].Ingresses = []networking_v1.Ingress{}
		for _, ingress := range i.Items {
			for _, rule := range ingress.Spec.Rules {
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service.Name == service.Svc.Name {
						services[idx].Ingresses = append(services[idx].Ingresses, ingress)
					}
				}
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
		if strings.Contains(err.Error(), "the server could not find the requested resource") {
			return nil, fmt.Errorf("capacitor requires kustomize.toolkit.fluxcd.io/v1: %s", err)
		}
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

func helmReleases(dc *dynamic.DynamicClient) ([]helmv2beta2.HelmRelease, error) {
	releases := []helmv2beta2.HelmRelease{}

	helmReleases, err := dc.Resource(helmReleaseGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		if strings.Contains(err.Error(), "the server could not find the requested resource") {
			// let's try the deprecated v2beta2
			helmReleases, err = dc.Resource(helmReleaseGVRV2beta2).
				Namespace("").
				List(context.TODO(), metav1.ListOptions{})
			if err != nil {
				if strings.Contains(err.Error(), "the server could not find the requested resource") {
					// let's try the deprecated v2beta1
					helmReleases, err = dc.Resource(helmReleaseGVRV2beta1).
						Namespace("").
						List(context.TODO(), metav1.ListOptions{})
					if err != nil {
						if strings.Contains(err.Error(), "the server could not find the requested resource") {
							// helm-controller is not mandatory, ignore error
							return releases, nil
						} else {
							return nil, err
						}
					}
				} else {
					return nil, err
				}
			}
		} else {
			return nil, err
		}
	}

	for _, h := range helmReleases.Items {
		unstructured := h.UnstructuredContent()
		var helmRelease helmv2beta2.HelmRelease
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
	hr helmv2beta2.HelmRelease,
) (kube.ResourceList, error) {
	var release *rspb.Release
	version := -1
	for _, r := range releases {
		if r.Namespace == hr.GetReleaseNamespace() && r.Name == hr.GetReleaseName() {
			if r.Version > version {
				release = r
				version = r.Version
			}
		}
	}
	if release == nil {
		return nil, fmt.Errorf("could not find helm release %s", hr.GetReleaseName())
	}

	actionConfig := action.Configuration{}
	envSettings := cli.New()
	envSettings.SetNamespace(hr.GetReleaseNamespace())
	actionConfig.Init(envSettings.RESTClientGetter(), "", "", nil)
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
		GitRepositories:  []sourcev1.GitRepository{},
		OCIRepositories:  []sourcev1beta2.OCIRepository{},
		Buckets:          []sourcev1beta2.Bucket{},
		Kustomizations:   []kustomizationv1.Kustomization{},
		HelmReleases:     []helmv2beta2.HelmRelease{},
		HelmRepositories: []sourcev1beta2.HelmRepository{},
		HelmCharts:       []sourcev1beta2.HelmChart{},
		TfResources:      []tf.Terraform{},
		FluxServices:     []Service{},
	}

	gitRepositories, err := dc.Resource(gitRepositoryGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		if strings.Contains(err.Error(), "the server could not find the requested resource") {
			return nil, fmt.Errorf("capacitor requires source.toolkit.fluxcd.io/v1: %s", err)
		}
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

	ociRepositories, err := dc.Resource(ociRepositoryGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, repo := range ociRepositories.Items {
		unstructured := repo.UnstructuredContent()
		var ociRepository sourcev1beta2.OCIRepository
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &ociRepository)
		if err != nil {
			return nil, err
		}
		fluxState.OCIRepositories = append(fluxState.OCIRepositories, ociRepository)
	}

	tfResources, err := dc.Resource(tfResourceGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		if strings.Contains(err.Error(), "the server could not find the requested resource") {
			// tofu-controller is not mandatory, ignore error
			tfResources = &unstructured.UnstructuredList{}
		} else {
			return nil, err
		}
	}
	for _, t := range tfResources.Items {
		unstructured := t.UnstructuredContent()
		var tfResource tf.Terraform
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &tfResource)
		if err != nil {
			return nil, err
		}
		fluxState.TfResources = append(fluxState.TfResources, tfResource)
	}

	buckets, err := dc.Resource(bucketGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, repo := range buckets.Items {
		unstructured := repo.UnstructuredContent()
		var bucket sourcev1beta2.Bucket
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &bucket)
		if err != nil {
			return nil, err
		}
		fluxState.Buckets = append(fluxState.Buckets, bucket)
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
		if strings.Contains(err.Error(), "the server could not find the requested resource") {
			// let's try the deprecated v2beta1
			helmReleases, err = dc.Resource(helmReleaseGVRV2beta1).
				Namespace("").
				List(context.TODO(), metav1.ListOptions{})
			if err != nil {
				if !strings.Contains(err.Error(), "the server could not find the requested resource") {
					return nil, err
				} else {
					// helm-controller is not mandatory, ignore error
					helmReleases = &unstructured.UnstructuredList{}
				}
			}
		} else {
			return nil, err
		}
	}
	for _, h := range helmReleases.Items {
		unstructured := h.UnstructuredContent()
		var helmRelease helmv2beta2.HelmRelease
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &helmRelease)
		if err != nil {
			return nil, err
		}
		fluxState.HelmReleases = append(fluxState.HelmReleases, helmRelease)
	}

	helmRepositories, err := dc.Resource(helmRepositoryGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, h := range helmRepositories.Items {
		unstructured := h.UnstructuredContent()
		var helmRepository sourcev1beta2.HelmRepository
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &helmRepository)
		if err != nil {
			return nil, err
		}
		fluxState.HelmRepositories = append(fluxState.HelmRepositories, helmRepository)
	}

	helmCharts, err := dc.Resource(helmChartGVR).
		Namespace("").
		List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, h := range helmCharts.Items {
		unstructured := h.UnstructuredContent()
		var helmChart sourcev1beta2.HelmChart
		err = runtime.DefaultUnstructuredConverter.FromUnstructured(unstructured, &helmChart)
		if err != nil {
			return nil, err
		}
		fluxState.HelmCharts = append(fluxState.HelmCharts, helmChart)
	}

	fluxServices, err := fluxServicesWithDetails(c)
	if err != nil {
		return nil, err
	}
	fluxState.FluxServices = fluxServices

	return fluxState, nil
}

func Events(c *kubernetes.Clientset, dc *dynamic.DynamicClient) ([]Event, error) {
	events, err := c.CoreV1().Events("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	sort.Sort(SortableEvents(events.Items))
	slices.Reverse(events.Items)

	var eventDTOs []Event
	for _, item := range events.Items {
		if IgnoreEvent(item) {
			continue
		}

		var series *Series
		if item.Series != nil {
			series = &Series{Count: item.Series.Count, LastObservedTime: item.Series.LastObservedTime.Time}
		}
		eventDTOs = append(eventDTOs, Event{
			InvolvedObjectKind:      item.InvolvedObject.Kind,
			InvolvedObjectNamespace: item.Namespace,
			InvolvedObject:          item.InvolvedObject.Name,
			Type:                    item.Type,
			Reason:                  item.Reason,
			Message:                 item.Message,
			EventTime:               item.EventTime.Time,
			FirstTimestamp:          item.FirstTimestamp.Time,
			LastTimestamp:           item.LastTimestamp.Time,
			Count:                   item.Count,
			Series:                  series,
		})
	}

	return eventDTOs, nil
}

func fluxServicesWithDetails(c *kubernetes.Clientset) ([]Service, error) {
	services := []Service{}
	deployments, err := c.AppsV1().Deployments("flux-system").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, d := range deployments.Items {
		deployment := d
		services = append(services, Service{
			Deployment: &deployment,
		})
	}

	svc, err := c.CoreV1().Services("flux-system").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for idx, service := range services {
		for _, s := range svc.Items {
			if k8s.SelectorsMatch(service.Deployment.Spec.Selector.MatchLabels, s.Spec.Selector) {
				services[idx].Svc = s
			}
		}
	}

	pods, err := c.CoreV1().Pods("flux-system").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for idx, service := range services {
		services[idx].Pods = []v1.Pod{}
		for _, pod := range pods.Items {
			if k8s.LabelsMatchSelectors(pod.ObjectMeta.Labels, service.Deployment.Spec.Selector.MatchLabels) {
				services[idx].Pods = append(services[idx].Pods, pod)
			}
		}
	}

	return services, nil
}
