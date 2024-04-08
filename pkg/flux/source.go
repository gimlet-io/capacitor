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
Original version: https://github.com/fluxcd/flux2/blob/437a94367784541695fa68deba7a52b188d97ea8/cmd/flux/source.go
*/

package flux

import (
	"fmt"

	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	sourcev1beta2 "github.com/fluxcd/source-controller/api/v1beta2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type gitRepositoryAdapter struct {
	*sourcev1.GitRepository
}

func (a gitRepositoryAdapter) asClientObject() client.Object {
	return a.GitRepository
}

func (obj gitRepositoryAdapter) isSuspended() bool {
	return obj.GitRepository.Spec.Suspend
}

func (obj gitRepositoryAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj gitRepositoryAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type ociRepositoryAdapter struct {
	*sourcev1beta2.OCIRepository
}

func (a ociRepositoryAdapter) asClientObject() client.Object {
	return a.OCIRepository
}

func (obj ociRepositoryAdapter) isSuspended() bool {
	return obj.OCIRepository.Spec.Suspend
}

func (obj ociRepositoryAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj ociRepositoryAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type bucketAdapter struct {
	*sourcev1beta2.Bucket
}

func (a bucketAdapter) asClientObject() client.Object {
	return a.Bucket
}

func (obj bucketAdapter) isSuspended() bool {
	return obj.Bucket.Spec.Suspend
}

func (obj bucketAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj bucketAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type helmRepositoryAdapter struct {
	*sourcev1beta2.HelmRepository
}

func (a helmRepositoryAdapter) asClientObject() client.Object {
	return a.HelmRepository
}

func (obj helmRepositoryAdapter) isSuspended() bool {
	return obj.HelmRepository.Spec.Suspend
}

func (obj helmRepositoryAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj helmRepositoryAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type helmChartAdapter struct {
	*sourcev1beta2.HelmChart
}

func (a helmChartAdapter) asClientObject() client.Object {
	return a.HelmChart
}

func (obj helmChartAdapter) isSuspended() bool {
	return obj.HelmChart.Spec.Suspend
}

func (obj helmChartAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj helmChartAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}
