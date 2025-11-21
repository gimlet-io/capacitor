package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// kluctlDeploymentPseudoResource represents a grouped view of Kluctl command results
// for a single resource discriminator. It is rendered to a Kubernetes-style object
// with apiVersion kluctl.io/v1, kind Deployment.
type kluctlDeploymentPseudoResource struct {
	APIVersion string                 `json:"apiVersion"`
	Kind       string                 `json:"kind"`
	Metadata   map[string]interface{} `json:"metadata"`
	Spec       map[string]interface{} `json:"spec,omitempty"`
	Status     map[string]interface{} `json:"status,omitempty"`
}

// kluctlDeploymentKey is used to group CommandResultSummaries that belong
// to the same logical deployment (resource discriminator).
type kluctlDeploymentKey struct {
	// Prefer KluctlDeploymentInfo when present
	KDName      string
	KDNamespace string
	// Fallback: project + target key
	Project ProjectKey
	Target  TargetKey
}

type kluctlDeploymentGroup struct {
	Key       kluctlDeploymentKey
	Summaries []CommandResultSummary
}

// groupCommandResultSummaries groups summaries by resource discriminator.
// If KluctlDeploymentInfo is present, that is the primary key; otherwise we fall back to Project+Target.
func groupCommandResultSummaries(summaries []CommandResultSummary) []kluctlDeploymentGroup {
	groups := map[kluctlDeploymentKey][]CommandResultSummary{}

	for _, s := range summaries {
		key := kluctlDeploymentKey{
			Project: s.ProjectKey,
			Target:  s.TargetKey,
		}
		if s.KluctlDeployment != nil {
			key.KDName = s.KluctlDeployment.Name
			key.KDNamespace = s.KluctlDeployment.Namespace
		}
		groups[key] = append(groups[key], s)
	}

	result := make([]kluctlDeploymentGroup, 0, len(groups))
	for k, list := range groups {
		// Sort summaries newest-first by Command.StartTime then EndTime, mirroring lessCommandSummary.
		sorted := make([]CommandResultSummary, len(list))
		copy(sorted, list)
		// Simple insertion sort; number of results per target is typically small.
		for i := 1; i < len(sorted); i++ {
			j := i
			for j > 0 {
				a := &sorted[j-1]
				b := &sorted[j]
				if !lessCommandSummaryForUI(a, b) {
					break
				}
				sorted[j-1], sorted[j] = sorted[j], sorted[j-1]
				j--
			}
		}
		result = append(result, kluctlDeploymentGroup{
			Key:       k,
			Summaries: sorted,
		})
	}

	return result
}

// lessCommandSummaryForUI orders summaries newest-first, based on the same
// fields used in kluctl's lessCommandSummary helper.
func lessCommandSummaryForUI(a, b *CommandResultSummary) bool {
	if !a.Command.StartTime.Equal(b.Command.StartTime) {
		return a.Command.StartTime.Before(b.Command.StartTime)
	}
	if !a.Command.EndTime.Equal(b.Command.EndTime) {
		return a.Command.EndTime.Before(b.Command.EndTime)
	}
	if a.Command.Command != b.Command.Command {
		return a.Command.Command < b.Command.Command
	}
	return a.Id < b.Id
}

// buildKluctlDeploymentObject converts a grouped deployment into a Kubernetes-like object.
// NAME is derived from the resource discriminator; NAMESPACE from KluctlDeployment.Namespace when present.
func buildKluctlDeploymentObject(g kluctlDeploymentGroup) kluctlDeploymentPseudoResource {
	latest := g.Summaries[len(g.Summaries)-1]

	// Derive name and namespace.
	name := g.Key.KDName
	namespace := g.Key.KDNamespace
	if name == "" {
		// Fallback: derive from project and target key.
		// Use project repo path or URL key plus target name as human-identifiable fields.
		name = buildKluctlDiscriminatorName(latest)
	}
	if namespace == "" && latest.KluctlDeployment != nil {
		namespace = latest.KluctlDeployment.Namespace
	}

	// Compute age from latest command start time.
	ageSeconds := int64(0)
	if !latest.Command.StartTime.IsZero() {
		ageSeconds = int64(time.Since(latest.Command.StartTime).Seconds())
		if ageSeconds < 0 {
			ageSeconds = 0
		}
	}

	// Basic status summary from latest result.
	statusSummary := map[string]interface{}{
		"id":             latest.Id,
		"command":        latest.Command.Command,
		"startTime":      latest.Command.StartTime.Format(time.RFC3339),
		"endTime":        latest.Command.EndTime.Format(time.RFC3339),
		"errors":         len(latest.Errors),
		"warnings":       len(latest.Warnings),
		"changedObjects": latest.ChangedObjects,
		"newObjects":     latest.NewObjects,
		"deletedObjects": latest.DeletedObjects,
		"orphanObjects":  latest.OrphanObjects,
		"appliedObjects": latest.AppliedObjects,
		"totalChanges":   latest.TotalChanges,
	}

	// Embed last few summaries for detailRowRenderer (the UI will slice to 5).
	summaries := make([]map[string]interface{}, len(g.Summaries))
	for i, s := range g.Summaries {
		summaries[i] = map[string]interface{}{
			"id":             s.Id,
			"command":        s.Command.Command,
			"startTime":      s.Command.StartTime.Format(time.RFC3339),
			"endTime":        s.Command.EndTime.Format(time.RFC3339),
			"errors":         len(s.Errors),
			"warnings":       len(s.Warnings),
			"changedObjects": s.ChangedObjects,
			"newObjects":     s.NewObjects,
			"deletedObjects": s.DeletedObjects,
			"orphanObjects":  s.OrphanObjects,
			"appliedObjects": s.AppliedObjects,
			"totalChanges":   s.TotalChanges,
		}
	}

	meta := map[string]interface{}{
		"name":              sanitizeKluctlName(name),
		"namespace":         namespace,
		"creationTimestamp": latest.Command.StartTime.Format(time.RFC3339),
	}

	spec := map[string]interface{}{
		"project": latest.ProjectKey,
		"target":  latest.TargetKey,
	}

	status := map[string]interface{}{
		"ageSeconds":       ageSeconds,
		"latestResult":     statusSummary,
		"commandSummaries": summaries,
	}

	return kluctlDeploymentPseudoResource{
		APIVersion: "kluctl.io/v1",
		Kind:       "Deployment",
		Metadata:   meta,
		Spec:       spec,
		Status:     status,
	}
}

// buildKluctlDiscriminatorName creates a human-readable discriminator from project and target.
func buildKluctlDiscriminatorName(s CommandResultSummary) string {
	parts := []string{}
	if s.ProjectKey.RepoKey != "" {
		parts = append(parts, s.ProjectKey.RepoKey)
	}
	if s.ProjectKey.SubDir != "" {
		parts = append(parts, s.ProjectKey.SubDir)
	}
	if s.TargetKey.TargetName != "" {
		parts = append(parts, s.TargetKey.TargetName)
	}
	if len(parts) == 0 {
		return s.Id
	}
	return strings.Join(parts, ":")
}

// sanitizeKluctlName turns an arbitrary discriminator into a DNS-compatible name.
func sanitizeKluctlName(name string) string {
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, "/", "-")
	name = strings.ReplaceAll(name, ":", "-")
	name = strings.ReplaceAll(name, "_", "-")
	// Remove invalid characters
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	out = strings.Trim(out, "-")
	if out == "" {
		return "deployment"
	}
	if len(out) > 63 {
		out = out[:63]
		out = strings.TrimRight(out, "-")
	}
	return out
}

// --- Local copies of Kluctl datatypes used for JSON summaries ---

type ProjectKey struct {
	RepoKey string `json:"repoKey,omitempty"`
	SubDir  string `json:"subDir,omitempty"`
}

type KluctlDeploymentInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	ClusterId string `json:"clusterId"`
}

type TargetKey struct {
	TargetName    string `json:"targetName,omitempty"`
	ClusterId     string `json:"clusterId"`
	Discriminator string `json:"discriminator,omitempty"`
}

type DeploymentError struct {
	Message string `json:"message"`
}

type CommandInfo struct {
	StartTime time.Time `json:"startTime"`
	EndTime   time.Time `json:"endTime"`
	Command   string    `json:"command,omitempty"`
}

type CommandResultSummary struct {
	Id               string                `json:"id"`
	ReconcileId      string                `json:"reconcileId"`
	ProjectKey       ProjectKey            `json:"projectKey"`
	TargetKey        TargetKey             `json:"targetKey"`
	Command          CommandInfo           `json:"commandInfo"`
	KluctlDeployment *KluctlDeploymentInfo `json:"kluctlDeployment,omitempty"`

	RenderedObjectsHash string `json:"renderedObjectsHash,omitempty"`

	RenderedObjects    int `json:"renderedObjects"`
	RemoteObjects      int `json:"remoteObjects"`
	AppliedObjects     int `json:"appliedObjects"`
	AppliedHookObjects int `json:"appliedHookObjects"`

	NewObjects     int `json:"newObjects"`
	ChangedObjects int `json:"changedObjects"`
	OrphanObjects  int `json:"orphanObjects"`
	DeletedObjects int `json:"deletedObjects"`

	Errors   []DeploymentError `json:"errors"`
	Warnings []DeploymentError `json:"warnings"`

	TotalChanges int `json:"totalChanges"`
}

// listCommandResultSummaries lists command result summaries by reading the
// summary annotation from Secrets in the given namespace.
func listCommandResultSummaries(ctx context.Context, k8sClient *kubernetes.Client, commandResultNamespace string) ([]CommandResultSummary, error) {
	if k8sClient == nil || k8sClient.Clientset == nil {
		return nil, fmt.Errorf("kubernetes clientset not initialized")
	}
	if commandResultNamespace == "" {
		return nil, fmt.Errorf("command result namespace is empty")
	}

	secretClient := k8sClient.Clientset.CoreV1().Secrets(commandResultNamespace)
	secretList, err := secretClient.List(ctx, metav1.ListOptions{
		LabelSelector: "kluctl.io/command-result-id",
	})
	if err != nil {
		return nil, err
	}

	summaries := make([]CommandResultSummary, 0, len(secretList.Items))
	for _, s := range secretList.Items {
		ann := s.Annotations["kluctl.io/command-result-summary"]
		if ann == "" {
			continue
		}
		var summary CommandResultSummary
		if err := json.Unmarshal([]byte(ann), &summary); err != nil {
			log.Printf("failed to unmarshal command result summary: %v", err)
			continue
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}
