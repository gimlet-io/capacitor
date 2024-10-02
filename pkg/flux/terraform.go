package flux

import (
	"fmt"

	tf "github.com/flux-iac/tofu-controller/api/v1alpha2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type terraformAdapter struct {
	*tf.Terraform
}

func (h terraformAdapter) asClientObject() client.Object {
	return h.Terraform
}

func (h terraformAdapter) deepCopyClientObject() client.Object {
	return h.Terraform.DeepCopy()
}

func (obj terraformAdapter) isSuspended() bool {
	return obj.Terraform.Spec.Suspend
}

func (obj terraformAdapter) setSuspended() {
	obj.Terraform.Spec.Suspend = true
}

func (obj terraformAdapter) setUnsuspended() {
	obj.Terraform.Spec.Suspend = false
}

func (obj terraformAdapter) getObservedGeneration() int64 {
	return obj.Terraform.Status.ObservedGeneration
}

func (obj terraformAdapter) isStatic() bool {
	return false
}

func (obj terraformAdapter) lastHandledReconcileRequest() string {
	return obj.Status.LastAttemptedRevision
}

func (obj terraformAdapter) successMessage() string {
	return fmt.Sprintf("fetched revision %s", obj.Status.LastAppliedRevision)
}

type terraformListAdapter struct {
	*tf.TerraformList
}

func (h terraformListAdapter) asClientList() client.ObjectList {
	return h.TerraformList
}

func (h terraformListAdapter) len() int {
	return len(h.TerraformList.Items)
}

func (a terraformListAdapter) item(i int) suspendable {
	return &terraformAdapter{&a.TerraformList.Items[i]}
}

func (a terraformListAdapter) resumeItem(i int) resumable {
	return &terraformAdapter{&a.TerraformList.Items[i]}
}
