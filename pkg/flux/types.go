package flux

import (
	helmv2beta2 "github.com/fluxcd/helm-controller/api/v2beta2"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	sourcev1beta2 "github.com/fluxcd/source-controller/api/v1beta2"
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
)

type FluxState struct {
	GitRepositories []sourcev1.GitRepository        `json:"gitRepositories"`
	OCIRepositories []sourcev1beta2.OCIRepository   `json:"ociRepositories"`
	Buckets         []sourcev1beta2.Bucket          `json:"buckets"`
	Kustomizations  []kustomizationv1.Kustomization `json:"kustomizations"`
	HelmReleases    []helmv2beta2.HelmRelease       `json:"helmReleases"`
	FluxServices    []Service                       `json:"fluxServices"`
}

type Service struct {
	Deployment *apps_v1.Deployment `json:"deployment"`
	Svc        v1.Service          `json:"svc"`
	Pods       []v1.Pod            `json:"pods"`
}

type Event struct {
	InvolvedObjectKind      string `json:"involvedObjectKind"`
	InvolvedObjectNamespace string `json:"involvedObjectNamespace"`
	InvolvedObject          string `json:"involvedObject"`
	Type                    string `json:"type"`
	Reason                  string `json:"reason"`
	Message                 string `json:"message"`
	LastSeen                string `json:"lastSeen"`
}
