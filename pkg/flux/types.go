package flux

import (
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
)

type FluxState struct {
	GitRepositories []sourcev1.GitRepository        `json:"gitRepositories"`
	Kustomizations  []kustomizationv1.Kustomization `json:"kustomizations"`
}

type Service struct {
	Deployment *apps_v1.Deployment `json:"deployment"`
	Svc        v1.Service          `json:"svc"`
	Pods       []v1.Pod            `json:"pods"`
}
