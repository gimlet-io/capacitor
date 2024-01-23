package flux

import (
	helmv2beta1 "github.com/fluxcd/helm-controller/api/v2beta1"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
)

type FluxState struct {
	GitRepositories []sourcev1.GitRepository        `json:"gitRepositories"`
	Kustomizations  []kustomizationv1.Kustomization `json:"kustomizations"`
	HelmReleases    []helmv2beta1.HelmRelease       `json:"helmReleases"`
	FluxServices    []Service                       `json:"fluxServices"`
}

type Service struct {
	Deployment  *apps_v1.Deployment `json:"deployment"`
	Svc         v1.Service          `json:"svc"`
	Pods        []v1.Pod            `json:"pods"`
	HelmRelease string              `json:"helmRelease,omitempty"`
}
