// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

/*
Copyright 2025 The Capacitor authors
Copyright 2022 The Flux authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"sort"
	"time"

	"github.com/google/go-cmp/cmp"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	"github.com/fluxcd/cli-utils/pkg/object"
	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	"github.com/fluxcd/pkg/ssa"
	ssautil "github.com/fluxcd/pkg/ssa/utils"

	"github.com/gimlet-io/capacitor/pkg/flux/build"
)

const (
	controllerName      = "kustomize-controller"
	controllerGroup     = "kustomize.toolkit.fluxcd.io"
	mask                = "**SOPS**"
	dockercfgSecretType = "kubernetes.io/dockerconfigjson"
	typeField           = "type"
	dataField           = "data"
	stringDataField     = "stringData"
)

type FluxDiffResult struct {
	FileName    string `json:"fileName"`
	ClusterYaml string `json:"clusterYaml"`
	AppliedYaml string `json:"appliedYaml"`
	Created     bool   `json:"created"`
	HasChanges  bool   `json:"hasChanges"`
	Deleted     bool   `json:"deleted"`
}

func fluxDiff(
	kubeClient client.WithWatch,
	b *build.Builder,
	kustomization *kustomizev1.Kustomization,
) ([]FluxDiffResult, error) {
	results := []FluxDiffResult{}

	objects, err := b.Build()
	if err != nil {
		return results, err
	}

	err = ssa.SetNativeKindsDefaults(objects)
	if err != nil {
		return results, err
	}

	resourceManager, err := b.Manager()
	if err != nil {
		return results, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var diffErrs []error
	// create an inventory of objects to be reconciled
	newInventory := newInventory()
	for _, obj := range objects {
		diffOptions := ssa.DiffOptions{
			Exclusions: map[string]string{
				"kustomize.toolkit.fluxcd.io/reconcile": "disabled",
				"kustomize.toolkit.fluxcd.io/ssa":       "ignore",
			},
			IfNotPresentSelector: map[string]string{
				"kustomize.toolkit.fluxcd.io/ssa": "ifnotpresent",
			},
		}
		change, liveObject, mergedObject, err := resourceManager.Diff(ctx, obj, diffOptions)
		if err != nil {
			// gather errors and continue, as we want to see all the diffs
			diffErrs = append(diffErrs, err)
			continue
		}

		// if the object is a sops secret, we need to
		// make sure we diff only if the keys are different
		if obj.GetKind() == "Secret" && change.Action == ssa.ConfiguredAction {
			diffSopsSecret(obj, liveObject, mergedObject, change)
		}

		if change.Action == ssa.UnchangedAction {
			existingObject := &unstructured.Unstructured{}
			existingObject.SetGroupVersionKind(obj.GroupVersionKind())
			err = kubeClient.Get(ctx, client.ObjectKeyFromObject(obj), existingObject)
			if err != nil {
				return results, err
			}
			clusterYaml, err := renderToYAML(existingObject)
			if err != nil {
				return results, err
			}

			results = append(results, FluxDiffResult{
				FileName:    change.Subject,
				ClusterYaml: clusterYaml,
				AppliedYaml: clusterYaml,
				Created:     false,
				HasChanges:  false,
				Deleted:     false,
			})
		}

		if change.Action == ssa.CreatedAction {
			appliedYaml, err := renderToYAML(obj)
			if err != nil {
				// gather errors and continue, as we want to see all the diffs
				diffErrs = append(diffErrs, err)
				continue
			}

			results = append(results, FluxDiffResult{
				FileName:    change.Subject,
				ClusterYaml: "",
				AppliedYaml: appliedYaml,
				Created:     true,
				HasChanges:  false,
				Deleted:     false,
			})
		}

		if change.Action == ssa.ConfiguredAction {
			clusterYaml, err := renderToYAML(liveObject)
			if err != nil {
				// gather errors and continue, as we want to see all the diffs
				diffErrs = append(diffErrs, err)
				continue
			}
			appliedYaml, err := renderToYAML(mergedObject)
			if err != nil {
				// gather errors and continue, as we want to see all the diffs
				diffErrs = append(diffErrs, err)
				continue
			}

			results = append(results, FluxDiffResult{
				FileName:    change.Subject,
				ClusterYaml: clusterYaml,
				AppliedYaml: appliedYaml,
				Created:     false,
				HasChanges:  true,
				Deleted:     false,
			})
		}

		addObjectsToInventory(newInventory, change)
	}

	if kustomization.Spec.Prune && len(diffErrs) == 0 {
		oldStatus := kustomization.Status.DeepCopy()
		if oldStatus.Inventory != nil {
			staleObjects, err := diffInventory(oldStatus.Inventory, newInventory)
			if err != nil {
				return results, err
			}
			for _, object := range staleObjects {
				existingObject := &unstructured.Unstructured{}
				existingObject.SetGroupVersionKind(object.GroupVersionKind())
				err = kubeClient.Get(ctx, client.ObjectKeyFromObject(object), existingObject)
				if err != nil {
					return results, err
				}
				clusterYaml, err := renderToYAML(existingObject)
				if err != nil {
					return results, err
				}

				results = append(results, FluxDiffResult{
					FileName:    ssautil.FmtUnstructured(object),
					ClusterYaml: clusterYaml,
					AppliedYaml: "",
					Created:     false,
					HasChanges:  false,
					Deleted:     true,
				})
			}
		}
	}

	return results, errors.Reduce(errors.Flatten(errors.NewAggregate(diffErrs)))
}

func renderToYAML(obj *unstructured.Unstructured) (string, error) {
	yml, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to marshal object to YAML: %w", err)
	}

	return string(yml), nil
}

func diffSopsSecret(obj, liveObject, mergedObject *unstructured.Unstructured, change *ssa.ChangeSetEntry) {
	// get both data and stringdata maps
	data := obj.Object[dataField]

	if m, ok := data.(map[string]interface{}); ok && m != nil {
		applySopsDiff(m, liveObject, mergedObject, change)
	}
}

func applySopsDiff(data map[string]interface{}, liveObject, mergedObject *unstructured.Unstructured, change *ssa.ChangeSetEntry) {
	for _, v := range data {
		v, err := base64.StdEncoding.DecodeString(v.(string))
		if err != nil {
			fmt.Println(err)
		}

		if bytes.Contains(v, []byte(mask)) {
			if liveObject != nil && mergedObject != nil {
				change.Action = ssa.UnchangedAction
				liveKeys, mergedKeys := sopsComparableByKeys(liveObject), sopsComparableByKeys(mergedObject)
				if cmp.Diff(liveKeys, mergedKeys) != "" {
					change.Action = ssa.ConfiguredAction
				}
			}
		}
	}
}

func sopsComparableByKeys(object *unstructured.Unstructured) []string {
	m := object.Object[dataField].(map[string]interface{})
	keys := make([]string, len(m))
	i := 0
	for k := range m {
		// make sure we can compare only on keys
		m[k] = "*****"
		keys[i] = k
		i++
	}

	object.Object[dataField] = m

	sort.Strings(keys)

	return keys
}

// diffInventory returns the slice of objects that do not exist in the target inventory.
func diffInventory(inv *kustomizev1.ResourceInventory, target *kustomizev1.ResourceInventory) ([]*unstructured.Unstructured, error) {
	versionOf := func(i *kustomizev1.ResourceInventory, objMetadata object.ObjMetadata) string {
		for _, entry := range i.Entries {
			if entry.ID == objMetadata.String() {
				return entry.Version
			}
		}
		return ""
	}

	objects := make([]*unstructured.Unstructured, 0)
	aList, err := listMetaInInventory(inv)
	if err != nil {
		return nil, err
	}

	bList, err := listMetaInInventory(target)
	if err != nil {
		return nil, err
	}

	list := aList.Diff(bList)
	if len(list) == 0 {
		return objects, nil
	}

	for _, metadata := range list {
		u := &unstructured.Unstructured{}
		u.SetGroupVersionKind(schema.GroupVersionKind{
			Group:   metadata.GroupKind.Group,
			Kind:    metadata.GroupKind.Kind,
			Version: versionOf(inv, metadata),
		})
		u.SetName(metadata.Name)
		u.SetNamespace(metadata.Namespace)
		objects = append(objects, u)
	}

	sort.Sort(ssa.SortableUnstructureds(objects))
	return objects, nil
}

// listMetaInInventory returns the inventory entries as object.ObjMetadata objects.
func listMetaInInventory(inv *kustomizev1.ResourceInventory) (object.ObjMetadataSet, error) {
	var metas []object.ObjMetadata
	for _, e := range inv.Entries {
		m, err := object.ParseObjMetadata(e.ID)
		if err != nil {
			return metas, err
		}
		metas = append(metas, m)
	}

	return metas, nil
}

func newInventory() *kustomizev1.ResourceInventory {
	return &kustomizev1.ResourceInventory{
		Entries: []kustomizev1.ResourceRef{},
	}
}

// addObjectsToInventory extracts the metadata from the given objects and adds it to the inventory.
func addObjectsToInventory(inv *kustomizev1.ResourceInventory, entry *ssa.ChangeSetEntry) error {
	if entry == nil {
		return nil
	}

	inv.Entries = append(inv.Entries, kustomizev1.ResourceRef{
		ID:      entry.ObjMetadata.String(),
		Version: entry.GroupVersion,
	})

	return nil
}
