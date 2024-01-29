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
Original version: https://github.com/fluxcd/flux2/blob/437a94367784541695fa68deba7a52b188d97ea8/cmd/flux/kustomization.go
*/

package flux

import (
	"fmt"

	kustomizationv1 "github.com/fluxcd/kustomize-controller/api/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type kustomizationAdapter struct {
	*kustomizationv1.Kustomization
}

func (a kustomizationAdapter) asClientObject() client.Object {
	return a.Kustomization
}

func (obj kustomizationAdapter) isSuspended() bool {
	return obj.Kustomization.Spec.Suspend
}

func (obj kustomizationAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj kustomizationAdapter) successMessage() string {
	return fmt.Sprintf("applied revision %s", obj.Status.LastAppliedRevision)
}
