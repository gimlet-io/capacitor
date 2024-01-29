/*
Copyright 2020 The Flux authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
Original version: https://github.com/fluxcd/flux2/blob/437a94367784541695fa68deba7a52b188d97ea8/cmd/flux/reconcile.go
*/

package flux

import (
	"context"
	"time"

	helmv2 "github.com/fluxcd/helm-controller/api/v2beta1"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	"github.com/fluxcd/pkg/apis/meta"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	"github.com/sirupsen/logrus"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/util/retry"
	kstatus "sigs.k8s.io/cli-utils/pkg/kstatus/status"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type reconcileCommand struct {
	kind         string
	groupVersion schema.GroupVersion
	object       reconcilable
}

type reconcilable interface {
	asClientObject() client.Object
	isSuspended() bool
	lastHandledReconcileRequest() string
	successMessage() string
}

func NewReconcileCommand(resource string) *reconcileCommand {
	switch resource {
	case "kustomization":
		return &reconcileCommand{
			object:       kustomizationAdapter{&kustomizationv1.Kustomization{}},
			groupVersion: kustomizationv1.GroupVersion,
			kind:         kustomizationv1.KustomizationKind,
		}
	case "helmrelease":
		return &reconcileCommand{
			object:       helmReleaseAdapter{&helmv2.HelmRelease{}},
			groupVersion: helmv2.GroupVersion,
			kind:         helmv2.HelmReleaseKind,
		}
	case "source":
		return &reconcileCommand{
			object:       gitRepositoryAdapter{&sourcev1.GitRepository{}},
			groupVersion: sourcev1.GroupVersion,
			kind:         sourcev1.GitRepositoryKind,
		}
	}
	return nil
}

func (r *reconcileCommand) Run(kubeClient client.WithWatch, namespace, name string) {
	namespacedName := types.NamespacedName{
		Namespace: namespace,
		Name:      name,
	}

	err := kubeClient.Get(context.TODO(), namespacedName, r.object.asClientObject())
	if err != nil {
		logrus.Error(err)
		return
	}

	if r.object.isSuspended() {
		logrus.Errorf("resource is suspended")
		return
	}

	lastHandledReconcileAt := r.object.lastHandledReconcileRequest()
	logrus.Infof("annotating %s %s in %s namespace", r.kind, name, namespace)
	if err := requestReconciliation(context.TODO(), kubeClient, namespacedName,
		r.groupVersion.WithKind(r.kind)); err != nil {
		logrus.Error(err)
		return
	}
	logrus.Infof("%s annotated", r.kind)

	logrus.Infof("waiting for %s reconciliation", r.kind)
	if err := wait.PollUntilContextTimeout(context.TODO(), 2*time.Second, 5*time.Minute, true,
		reconciliationHandled(kubeClient, namespacedName, r.object, lastHandledReconcileAt)); err != nil {
		logrus.Error(err)
		return
	}

	readyCond := apimeta.FindStatusCondition(reconcilableConditions(r.object), meta.ReadyCondition)
	if readyCond == nil {
		logrus.Errorf("status can't be determined")
		return
	}

	if readyCond.Status != metav1.ConditionTrue {
		logrus.Errorf("%s reconciliation failed: %s", r.kind, readyCond.Message)
		return
	}
	logrus.Infof(r.object.successMessage())
}

// oldConditions represents the deprecated API which is sunsetting.
type oldConditions interface {
	// this is usually implemented by GOTK API objects because it's used by pkg/apis/meta
	GetStatusConditions() *[]metav1.Condition
}

func reconcilableConditions(object reconcilable) []metav1.Condition {
	if s, ok := object.(meta.ObjectWithConditions); ok {
		return s.GetConditions()
	}

	if s, ok := object.(oldConditions); ok {
		return *s.GetStatusConditions()
	}

	return []metav1.Condition{}
}

func requestReconciliation(
	ctx context.Context,
	kubeClient client.Client,
	namespacedName types.NamespacedName,
	gvk schema.GroupVersionKind,
) error {
	return retry.RetryOnConflict(retry.DefaultBackoff, func() (err error) {
		object := &metav1.PartialObjectMetadata{}
		object.SetGroupVersionKind(gvk)
		object.SetName(namespacedName.Name)
		object.SetNamespace(namespacedName.Namespace)
		if err := kubeClient.Get(ctx, namespacedName, object); err != nil {
			return err
		}
		patch := client.MergeFrom(object.DeepCopy())

		// Add a timestamp annotation to trigger a reconciliation.
		ts := time.Now().Format(time.RFC3339Nano)
		annotations := object.GetAnnotations()
		if annotations == nil {
			annotations = make(map[string]string, 1)
		}
		annotations[meta.ReconcileRequestAnnotation] = ts

		// HelmRelease specific annotations to force a release.
		if gvk.Kind == helmv2.HelmReleaseKind {
			annotations["reconcile.fluxcd.io/forceAt"] = ts
		}

		object.SetAnnotations(annotations)
		return kubeClient.Patch(ctx, object, patch)
	})
}

func reconciliationHandled(
	kubeClient client.Client,
	namespacedName types.NamespacedName,
	obj reconcilable,
	lastHandledReconcileAt string,
) wait.ConditionWithContextFunc {
	return func(ctx context.Context) (bool, error) {
		err := kubeClient.Get(ctx, namespacedName, obj.asClientObject())
		if err != nil {
			return false, err
		}

		if obj.lastHandledReconcileRequest() == lastHandledReconcileAt {
			return false, nil
		}

		result, err := kstatusCompute(obj.asClientObject())
		if err != nil {
			return false, err
		}

		return result.Status == kstatus.CurrentStatus, nil
	}
}

// kstatusCompute returns the kstatus computed result of a given object.
func kstatusCompute(obj client.Object) (result *kstatus.Result, err error) {
	u, err := toUnstructured(obj)
	if err != nil {
		return result, err
	}
	return kstatus.Compute(u)
}

// ToUnstructured converts a runtime.Object into an Unstructured object.
func toUnstructured(obj runtime.Object) (*unstructured.Unstructured, error) {
	// If the incoming object is already unstructured, perform a deep copy first
	// otherwise DefaultUnstructuredConverter ends up returning the inner map without
	// making a copy.
	if _, ok := obj.(runtime.Unstructured); ok {
		obj = obj.DeepCopyObject()
	}
	rawMap, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
	if err != nil {
		return nil, err
	}
	return &unstructured.Unstructured{Object: rawMap}, nil
}
