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
Original version: https://github.com/fluxcd/flux2/blob/437a94367784541695fa68deba7a52b188d97ea8/cmd/flux/suspend.go
*/

package flux

import (
	"context"
	"errors"

	tf "github.com/flux-iac/tofu-controller/api/v1alpha2"
	helmv2beta1 "github.com/fluxcd/helm-controller/api/v2beta1"
	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	sourcev1beta2 "github.com/fluxcd/source-controller/api/v1beta2"
	"github.com/sirupsen/logrus"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type suspendCommand struct {
	kind         string
	groupVersion schema.GroupVersion
	list         listSuspendable
	object       suspendable
}

type listSuspendable interface {
	asClientList() client.ObjectList
	len() int
	item(i int) suspendable
}

type suspendable interface {
	asClientObject() client.Object
	deepCopyClientObject() client.Object
	isSuspended() bool
	setSuspended()
}

func NewSuspendCommand(resource string) *suspendCommand {
	switch resource {
	case "kustomization":
		return &suspendCommand{
			kind:         kustomizationv1.KustomizationKind,
			groupVersion: kustomizationv1.GroupVersion,
			object:       kustomizationAdapter{&kustomizationv1.Kustomization{}},
			list:         &kustomizationListAdapter{&kustomizationv1.KustomizationList{}},
		}
	case "helmrelease":
		return &suspendCommand{
			kind:         helmv2beta1.HelmReleaseKind,
			groupVersion: helmv2beta1.GroupVersion,
			object:       &helmReleaseAdapter{&helmv2beta1.HelmRelease{}},
			list:         &helmReleaseListAdapter{&helmv2beta1.HelmReleaseList{}},
		}
	case sourcev1.GitRepositoryKind:
		return &suspendCommand{
			kind:         sourcev1.GitRepositoryKind,
			groupVersion: sourcev1.GroupVersion,
			object:       gitRepositoryAdapter{&sourcev1.GitRepository{}},
			list:         gitRepositoryListAdapter{&sourcev1.GitRepositoryList{}},
		}
	case sourcev1beta2.OCIRepositoryKind:
		return &suspendCommand{
			kind:         sourcev1beta2.OCIRepositoryKind,
			groupVersion: sourcev1beta2.GroupVersion,
			object:       ociRepositoryAdapter{&sourcev1beta2.OCIRepository{}},
			list:         ociRepositoryListAdapter{&sourcev1beta2.OCIRepositoryList{}},
		}
	case sourcev1beta2.BucketKind:
		return &suspendCommand{
			kind:         sourcev1beta2.BucketKind,
			groupVersion: sourcev1beta2.GroupVersion,
			object:       bucketAdapter{&sourcev1beta2.Bucket{}},
			list:         bucketListAdapter{&sourcev1beta2.BucketList{}},
		}
	case tf.TerraformKind:
		return &suspendCommand{
			kind:         tf.TerraformKind,
			groupVersion: tf.GroupVersion,
			object:       &terraformAdapter{&tf.Terraform{}},
			list:         &terraformListAdapter{&tf.TerraformList{}},
		}
	}

	return nil
}

func (s *suspendCommand) Run(config *rest.Config, namespace, name string) {
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

	if err := s.patch(context.TODO(), kubeClient, listOpts, namespace); err != nil {
		if err == ErrNoObjectsFound {
			logrus.Errorf("%s %s not found in %s namespace", s.kind, name, namespace)
		} else {
			logrus.Errorf("failed suspending %s %s in %s namespace: %s", s.kind, name, namespace, err.Error())
		}
	}
}

var ErrNoObjectsFound = errors.New("no objects found")

func (s suspendCommand) patch(ctx context.Context, kubeClient client.WithWatch, listOpts []client.ListOption, namespace string) error {
	if err := kubeClient.List(ctx, s.list.asClientList(), listOpts...); err != nil {
		return err
	}

	if s.list.len() == 0 {
		return ErrNoObjectsFound
	}

	for i := 0; i < s.list.len(); i++ {
		logrus.Infof("suspending %s %s in %s namespace", s.kind, s.list.item(i).asClientObject().GetName(), namespace)

		obj := s.list.item(i)
		patch := client.MergeFrom(obj.deepCopyClientObject())
		obj.setSuspended()
		if err := kubeClient.Patch(ctx, obj.asClientObject(), patch); err != nil {
			return err
		}

		logrus.Infof("%s suspended", s.kind)
	}

	return nil
}
