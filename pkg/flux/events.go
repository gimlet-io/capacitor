/*
Copyright 2023 The Kubernetes Authors.
Copyright 2023 The Flux authors

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

package flux

import (
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/duration"

	helmv2 "github.com/fluxcd/helm-controller/api/v2beta2"
	autov1 "github.com/fluxcd/image-automation-controller/api/v1beta1"
	imagev1 "github.com/fluxcd/image-reflector-controller/api/v1beta2"
	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	notificationv1 "github.com/fluxcd/notification-controller/api/v1"
	notificationv1b3 "github.com/fluxcd/notification-controller/api/v1beta3"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	sourcev1b2 "github.com/fluxcd/source-controller/api/v1beta2"
)

// SortableEvents implements sort.Interface for []api.Event by time
type SortableEvents []corev1.Event

func (list SortableEvents) Len() int {
	return len(list)
}

func (list SortableEvents) Swap(i, j int) {
	list[i], list[j] = list[j], list[i]
}

// Return the time that should be used for sorting, which can come from
// various places in corev1.Event.
func eventTime(event corev1.Event) time.Time {
	if event.Series != nil {
		return event.Series.LastObservedTime.Time
	}
	if !event.LastTimestamp.Time.IsZero() {
		return event.LastTimestamp.Time
	}
	return event.EventTime.Time
}

func (list SortableEvents) Less(i, j int) bool {
	return eventTime(list[i]).Before(eventTime(list[j]))
}

func getLastSeen(e corev1.Event) string {
	var interval string
	firstTimestampSince := translateMicroTimestampSince(e.EventTime)
	if e.EventTime.IsZero() {
		firstTimestampSince = translateTimestampSince(e.FirstTimestamp)
	}
	if e.Series != nil {
		interval = fmt.Sprintf("%s (x%d over %s)", translateMicroTimestampSince(e.Series.LastObservedTime), e.Series.Count, firstTimestampSince)
	} else if e.Count > 1 {
		interval = fmt.Sprintf("%s (x%d over %s)", translateTimestampSince(e.LastTimestamp), e.Count, firstTimestampSince)
	} else {
		interval = firstTimestampSince
	}

	return interval
}

// translateMicroTimestampSince returns the elapsed time since timestamp in
// human-readable approximation.
func translateMicroTimestampSince(timestamp metav1.MicroTime) string {
	if timestamp.IsZero() {
		return "<unknown>"
	}

	return duration.HumanDuration(time.Since(timestamp.Time))
}

// translateTimestampSince returns the elapsed time since timestamp in
// human-readable approximation.
func translateTimestampSince(timestamp metav1.Time) string {
	if timestamp.IsZero() {
		return "<unknown>"
	}

	return duration.HumanDuration(time.Since(timestamp.Time))
}

type refInfo struct {
	// gvk is the group version kind of the resource
	gvk schema.GroupVersionKind
	// kind is the kind that the resource references if it's not static
	kind string
	// crossNamespaced indicates if this resource uses cross namespaced references
	crossNamespaced bool
	// otherRefs returns other reference that might not be directly accessible
	// from the spec of the object
	otherRefs func(namespace, name string) []string
	field     []string
}
type refMap map[string]refInfo

func (r refMap) getRefInfo(kind string) (refInfo, error) {
	for key, ref := range r {
		if strings.EqualFold(key, kind) {
			return ref, nil
		}
	}
	return refInfo{}, fmt.Errorf("'%s' is not a recognized Flux kind", kind)
}

func (r refMap) hasKind(kind string) bool {
	_, err := r.getRefInfo(kind)
	return err == nil
}

var fluxKindMap = refMap{
	kustomizev1.KustomizationKind: {
		gvk:             kustomizev1.GroupVersion.WithKind(kustomizev1.KustomizationKind),
		crossNamespaced: true,
		field:           []string{"spec", "sourceRef"},
	},
	helmv2.HelmReleaseKind: {
		gvk:             helmv2.GroupVersion.WithKind(helmv2.HelmReleaseKind),
		crossNamespaced: true,
		otherRefs: func(namespace, name string) []string {
			return []string{fmt.Sprintf("%s/%s-%s", sourcev1b2.HelmChartKind, namespace, name)}
		},
		field: []string{"spec", "chart", "spec", "sourceRef"},
	},
	notificationv1b3.AlertKind: {
		gvk:             notificationv1b3.GroupVersion.WithKind(notificationv1b3.AlertKind),
		kind:            notificationv1b3.ProviderKind,
		crossNamespaced: false,
		field:           []string{"spec", "providerRef"},
	},
	notificationv1.ReceiverKind:   {gvk: notificationv1.GroupVersion.WithKind(notificationv1.ReceiverKind)},
	notificationv1b3.ProviderKind: {gvk: notificationv1b3.GroupVersion.WithKind(notificationv1b3.ProviderKind)},
	imagev1.ImagePolicyKind: {
		gvk:             imagev1.GroupVersion.WithKind(imagev1.ImagePolicyKind),
		kind:            imagev1.ImageRepositoryKind,
		crossNamespaced: true,
		field:           []string{"spec", "imageRepositoryRef"},
	},
	sourcev1b2.HelmChartKind: {
		gvk:             sourcev1b2.GroupVersion.WithKind(sourcev1b2.HelmChartKind),
		crossNamespaced: true,
		field:           []string{"spec", "sourceRef"},
	},
	sourcev1.GitRepositoryKind:       {gvk: sourcev1.GroupVersion.WithKind(sourcev1.GitRepositoryKind)},
	sourcev1b2.OCIRepositoryKind:     {gvk: sourcev1b2.GroupVersion.WithKind(sourcev1b2.OCIRepositoryKind)},
	sourcev1b2.BucketKind:            {gvk: sourcev1b2.GroupVersion.WithKind(sourcev1b2.BucketKind)},
	sourcev1b2.HelmRepositoryKind:    {gvk: sourcev1b2.GroupVersion.WithKind(sourcev1b2.HelmRepositoryKind)},
	autov1.ImageUpdateAutomationKind: {gvk: autov1.GroupVersion.WithKind(autov1.ImageUpdateAutomationKind)},
	imagev1.ImageRepositoryKind:      {gvk: imagev1.GroupVersion.WithKind(imagev1.ImageRepositoryKind)},
}

func ignoreEvent(e corev1.Event) bool {
	if !fluxKindMap.hasKind(e.InvolvedObject.Kind) {
		return true
	}

	return false
}
