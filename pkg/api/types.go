package api

import (
	apps_v1 "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
)

type Service struct {
	Deployment *apps_v1.Deployment `json:"deployment"`
	Svc        v1.Service          `json:"svc"`
	Pods       []*v1.Pod           `json:"pods"`
}
