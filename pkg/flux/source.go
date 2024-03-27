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
	sourcev1b2 "github.com/fluxcd/source-controller/api/v1beta2"
	sourcev1beta2 "github.com/fluxcd/source-controller/api/v1beta2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type gitRepositoryAdapter struct {
	*sourcev1.GitRepository
}

func (a gitRepositoryAdapter) asClientObject() client.Object {
	return a.GitRepository
}

func (a gitRepositoryAdapter) deepCopyClientObject() client.Object {
	return a.GitRepository.DeepCopy()
}

func (obj gitRepositoryAdapter) isSuspended() bool {
	return obj.GitRepository.Spec.Suspend
}

func (obj gitRepositoryAdapter) setSuspended() {
	obj.GitRepository.Spec.Suspend = true
}

func (obj gitRepositoryAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj gitRepositoryAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type gitRepositoryListAdapter struct {
	*sourcev1.GitRepositoryList
}

func (a gitRepositoryListAdapter) asClientList() client.ObjectList {
	return a.GitRepositoryList
}

func (a gitRepositoryListAdapter) len() int {
	return len(a.GitRepositoryList.Items)
}

func (a gitRepositoryListAdapter) item(i int) suspendable {
	return &gitRepositoryAdapter{&a.GitRepositoryList.Items[i]}
}

type ociRepositoryAdapter struct {
	*sourcev1beta2.OCIRepository
}

func (a ociRepositoryAdapter) asClientObject() client.Object {
	return a.OCIRepository
}

func (a ociRepositoryAdapter) deepCopyClientObject() client.Object {
	return a.OCIRepository.DeepCopy()
}

func (obj ociRepositoryAdapter) isSuspended() bool {
	return obj.OCIRepository.Spec.Suspend
}

func (obj ociRepositoryAdapter) setSuspended() {
	obj.OCIRepository.Spec.Suspend = true
}

func (obj ociRepositoryAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj ociRepositoryAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type ociRepositoryListAdapter struct {
	*sourcev1b2.OCIRepositoryList
}

func (a ociRepositoryListAdapter) asClientList() client.ObjectList {
	return a.OCIRepositoryList
}

func (a ociRepositoryListAdapter) len() int {
	return len(a.OCIRepositoryList.Items)
}

func (a ociRepositoryListAdapter) item(i int) suspendable {
	return &ociRepositoryAdapter{&a.OCIRepositoryList.Items[i]}
}

type bucketAdapter struct {
	*sourcev1beta2.Bucket
}

func (a bucketAdapter) asClientObject() client.Object {
	return a.Bucket
}

func (a bucketAdapter) deepCopyClientObject() client.Object {
	return a.Bucket.DeepCopy()
}

func (obj bucketAdapter) isSuspended() bool {
	return obj.Bucket.Spec.Suspend
}

func (obj bucketAdapter) setSuspended() {
	obj.Bucket.Spec.Suspend = true
}

func (obj bucketAdapter) lastHandledReconcileRequest() string {
	return obj.Status.GetLastHandledReconcileRequest()
}

func (obj bucketAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.Artifact.Revision)
}

type bucketListAdapter struct {
	*sourcev1b2.BucketList
}

func (a bucketListAdapter) asClientList() client.ObjectList {
	return a.BucketList
}

func (a bucketListAdapter) len() int {
	return len(a.BucketList.Items)
}

func (a bucketListAdapter) item(i int) suspendable {
	return &bucketAdapter{&a.BucketList.Items[i]}
}
