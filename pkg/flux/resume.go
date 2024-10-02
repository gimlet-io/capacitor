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
Original version: https://github.com/fluxcd/flux2/blob/437a94367784541695fa68deba7a52b188d97ea8/cmd/flux/resume.go
*/

package flux

import (
	"context"
	"fmt"
	"time"

	tf "github.com/flux-iac/tofu-controller/api/v1alpha2"
	helmv2beta1 "github.com/fluxcd/helm-controller/api/v2beta1"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	"github.com/fluxcd/pkg/apis/meta"
	"github.com/fluxcd/pkg/runtime/object"
	"github.com/fluxcd/pkg/runtime/patch"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	sourcev1beta2 "github.com/fluxcd/source-controller/api/v1beta2"
	"github.com/sirupsen/logrus"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/rest"
	kstatus "sigs.k8s.io/cli-utils/pkg/kstatus/status"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// objectStatusType is the type of object in terms of status when computing the
// readiness of an object. Readiness check method depends on the type of object.
// For a dynamic object, Ready status condition is considered only for the
// latest generation of the object. For a static object that don't have any
// condition, the object generation is not considered.
type objectStatusType int

const (
	objectStatusDynamic objectStatusType = iota
	objectStatusStatic
)

type resumeCommand struct {
	kind         string
	groupVersion schema.GroupVersion
	list         listResumable
}

type listResumable interface {
	asClientList() client.ObjectList
	len() int
	resumeItem(i int) resumable
}

type resumable interface {
	asClientObject() client.Object
	deepCopyClientObject() client.Object
	GetGeneration() int64
	getObservedGeneration() int64
	setUnsuspended()
	isStatic() bool
	successMessage() string
}

func NewResumeCommand(resource string) *resumeCommand {
	switch resource {
	case "kustomization":
		return &resumeCommand{
			kind:         kustomizationv1.KustomizationKind,
			groupVersion: kustomizationv1.GroupVersion,
			list:         kustomizationListAdapter{&kustomizationv1.KustomizationList{}},
		}
	case "helmrelease":
		return &resumeCommand{
			kind:         helmv2beta1.HelmReleaseKind,
			groupVersion: helmv2beta1.GroupVersion,
			list:         helmReleaseListAdapter{&helmv2beta1.HelmReleaseList{}},
		}
	case sourcev1.GitRepositoryKind:
		return &resumeCommand{
			kind:         sourcev1.GitRepositoryKind,
			groupVersion: sourcev1.GroupVersion,
			list:         gitRepositoryListAdapter{&sourcev1.GitRepositoryList{}},
		}
	case sourcev1beta2.OCIRepositoryKind:
		return &resumeCommand{
			kind:         sourcev1beta2.OCIRepositoryKind,
			groupVersion: sourcev1beta2.GroupVersion,
			list:         ociRepositoryListAdapter{&sourcev1beta2.OCIRepositoryList{}},
		}
	case sourcev1beta2.BucketKind:
		return &resumeCommand{
			kind:         sourcev1beta2.BucketKind,
			groupVersion: sourcev1beta2.GroupVersion,
			list:         bucketListAdapter{&sourcev1beta2.BucketList{}},
		}
	case tf.TerraformKind:
		return &resumeCommand{
			kind:         tf.TerraformKind,
			groupVersion: tf.GroupVersion,
			list:         &terraformListAdapter{&tf.TerraformList{}},
		}
	}

	return nil
}

func (r *resumeCommand) Run(config *rest.Config, namespace, name string) {
	scheme := runtime.NewScheme()
	sourcev1.AddToScheme(scheme)
	sourcev1beta2.AddToScheme(scheme)
	kustomizationv1.AddToScheme(scheme)
	helmv2beta1.AddToScheme(scheme)
	tf.AddToScheme(scheme)

	kubeClient, err := client.NewWithWatch(config, client.Options{
		Scheme: scheme,
	})
	if err != nil {
		logrus.Errorf("kubernetes client initialization failed: %s", err)
		return
	}

	listOpts := []client.ListOption{
		client.InNamespace(namespace),
		client.MatchingFields{
			"metadata.name": name,
		},
	}

	obj, err := r.patch(context.TODO(), kubeClient, listOpts, namespace)
	if err != nil {
		if err == ErrNoObjectsFound {
			logrus.Errorf("%s %s not found in %s namespace", r.kind, name, namespace)
		} else {
			logrus.Errorf("failed suspending %s %s in %s namespace: %s", r.kind, name, namespace, err.Error())
		}
	}
	r.reconcile(kubeClient, obj, namespace)
}

// Patches resumable object by setting status to unsuspended.
// Returns a resumable that have been patched and any error encountered during patching.
func (r resumeCommand) patch(ctx context.Context, kubeClient client.WithWatch, listOpts []client.ListOption, namespace string) (resumable, error) {
	if err := kubeClient.List(ctx, r.list.asClientList(), listOpts...); err != nil {
		return nil, err
	}

	if r.list.len() == 0 {
		logrus.Errorf("no %s objects found in %s namespace", r.kind, namespace)
		return nil, nil
	}

	var resumables []resumable
	for i := 0; i < r.list.len(); i++ {
		obj := r.list.resumeItem(i)
		logrus.Infof("resuming %s %s in %s namespace", r.kind, obj.asClientObject().GetName(), namespace)

		patch := client.MergeFrom(obj.deepCopyClientObject())
		obj.setUnsuspended()
		if err := kubeClient.Patch(ctx, obj.asClientObject(), patch); err != nil {
			return nil, err
		}

		resumables = append(resumables, obj)

		logrus.Infof("%s resumed", r.kind)
	}

	return resumables[0], nil
}

// Waits for resumable object to be reconciled and returns the object and any error encountered while waiting.
func (r resumeCommand) reconcile(kubeClient client.WithWatch, res resumable, namespace string) {
	namespacedName := types.NamespacedName{
		Name:      res.asClientObject().GetName(),
		Namespace: namespace,
	}

	logrus.Infof("waiting for %s reconciliation", r.kind)

	readyConditionFunc := isObjectReadyConditionFunc(kubeClient, namespacedName, res.asClientObject())
	if res.isStatic() {
		readyConditionFunc = isStaticObjectReadyConditionFunc(kubeClient, namespacedName, res.asClientObject())
	}

	if err := wait.PollUntilContextTimeout(context.TODO(), 2*time.Second, 5*time.Minute, true, readyConditionFunc); err != nil {
		logrus.Error(err)
		return
	}

	logrus.Infof("%s %s reconciliation completed", r.kind, res.asClientObject().GetName())
	logrus.Infof(res.successMessage())
}

// isObjectReady determines if an object is ready using the kstatus.Compute()
// result. statusType helps differenciate between static and dynamic objects to
// accurately check the object's readiness. A dynamic object may have some extra
// considerations depending on the object.
func isObjectReady(obj client.Object, statusType objectStatusType) (bool, error) {
	observedGen, err := object.GetStatusObservedGeneration(obj)
	if err != nil && err != object.ErrObservedGenerationNotFound {
		return false, err
	}

	if statusType == objectStatusDynamic {
		// Object not reconciled yet.
		if observedGen < 1 {
			return false, nil
		}

		cobj, ok := obj.(meta.ObjectWithConditions)
		if !ok {
			return false, fmt.Errorf("unable to get conditions from object")
		}

		if c := apimeta.FindStatusCondition(cobj.GetConditions(), meta.ReadyCondition); c != nil {
			// Ensure that the ready condition is for the latest generation of
			// the object.
			// NOTE: Some APIs like ImageUpdateAutomation and HelmRelease don't
			// support per condition observed generation yet. Per condition
			// observed generation for them are always zero.
			// There are two strategies used across different object kinds to
			// check the latest ready condition:
			//   - check that the ready condition's generation matches the
			//     object's generation.
			//   - check that the observed generation of the object in the
			//     status matches the object's generation.
			//
			// TODO: Once ImageUpdateAutomation and HelmRelease APIs have per
			// condition observed generation, remove the object's observed
			// generation and object's generation check (the second condition
			// below). Also, try replacing this readiness check function with
			// fluxcd/pkg/ssa's ResourceManager.Wait(), which uses kstatus
			// internally to check readiness of the objects.
			if c.ObservedGeneration != 0 && c.ObservedGeneration != obj.GetGeneration() {
				return false, nil
			}
			if c.ObservedGeneration == 0 && observedGen != obj.GetGeneration() {
				return false, nil
			}
		} else {
			return false, nil
		}
	}

	u, err := patch.ToUnstructured(obj)
	if err != nil {
		return false, err
	}
	result, err := kstatus.Compute(u)
	if err != nil {
		return false, err
	}
	switch result.Status {
	case kstatus.CurrentStatus:
		return true, nil
	case kstatus.InProgressStatus:
		return false, nil
	default:
		return false, fmt.Errorf(result.Message)
	}
}

// isObjectReadyConditionFunc returns a wait.ConditionFunc to be used with
// wait.Poll* while polling for an object with dynamic status to be ready.
func isObjectReadyConditionFunc(kubeClient client.Client, namespaceName types.NamespacedName, obj client.Object) wait.ConditionWithContextFunc {
	return func(ctx context.Context) (bool, error) {
		err := kubeClient.Get(ctx, namespaceName, obj)
		if err != nil {
			return false, err
		}

		return isObjectReady(obj, objectStatusDynamic)
	}
}

// isStaticObjectReadyConditionFunc returns a wait.ConditionFunc to be used with
// wait.Poll* while polling for an object with static or no status to be
// ready.
func isStaticObjectReadyConditionFunc(kubeClient client.Client, namespaceName types.NamespacedName, obj client.Object) wait.ConditionWithContextFunc {
	return func(ctx context.Context) (bool, error) {
		err := kubeClient.Get(ctx, namespaceName, obj)
		if err != nil {
			return false, err
		}

		return isObjectReady(obj, objectStatusStatic)
	}
}
