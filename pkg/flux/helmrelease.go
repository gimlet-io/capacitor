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
Original version: https://github.com/fluxcd/flux2/blob/437a94367784541695fa68deba7a52b188d97ea8/cmd/flux/helmrelease.go
*/

package flux

import (
	"fmt"

	helmv2beta1 "github.com/fluxcd/helm-controller/api/v2beta1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type helmReleaseAdapter struct {
	*helmv2beta1.HelmRelease
}

func (h helmReleaseAdapter) asClientObject() client.Object {
	return h.HelmRelease
}

func (h helmReleaseAdapter) deepCopyClientObject() client.Object {
	return h.HelmRelease.DeepCopy()
}

func (obj helmReleaseAdapter) isSuspended() bool {
	return obj.HelmRelease.Spec.Suspend
}

func (obj helmReleaseAdapter) setSuspended() {
	obj.HelmRelease.Spec.Suspend = true
}

func (obj helmReleaseAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj helmReleaseAdapter) successMessage() string {
	return fmt.Sprintf("applied revision %s", obj.Status.LastAppliedRevision)
}

type helmReleaseListAdapter struct {
	*helmv2beta1.HelmReleaseList
}

func (h helmReleaseListAdapter) asClientList() client.ObjectList {
	return h.HelmReleaseList
}

func (h helmReleaseListAdapter) len() int {
	return len(h.HelmReleaseList.Items)
}

func (a helmReleaseListAdapter) item(i int) suspendable {
	return &helmReleaseAdapter{&a.HelmReleaseList.Items[i]}
}
