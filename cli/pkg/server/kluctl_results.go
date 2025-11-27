package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// KluctlDeploymentPseudoResource represents a grouped view of Kluctl command results
// for a single resource discriminator. It is rendered to a Kubernetes-style object
// with apiVersion kluctl.io/v1, kind Deployment.
type KluctlDeploymentPseudoResource struct {
	APIVersion string                   `json:"apiVersion"`
	Kind       string                   `json:"kind"`
	Metadata   KluctlDeploymentMetadata `json:"metadata"`
	Spec       KluctlDeploymentSpec     `json:"spec,omitempty"`
	Status     KluctlDeploymentStatus   `json:"status,omitempty"`
}

// KluctlDeploymentMetadata models standard Kubernetes metadata for the pseudo resource.
type KluctlDeploymentMetadata struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KluctlDeploymentSpec describes the logical project/target pair this pseudo Deployment represents.
type KluctlDeploymentSpec struct {
	Project ProjectKey `json:"project"`
	Target  TargetKey  `json:"target"`
}

// KluctlDeploymentStatus contains aggregated status and full command summaries.
type KluctlDeploymentStatus struct {
	AgeSeconds          int64                  `json:"ageSeconds"`
	LatestResult        CommandResultSummary   `json:"latestResult"`
	CommandSummaries    []CommandResultSummary `json:"commandSummaries"`
	LatestReducedResult string                 `json:"latestReducedResult,omitempty"`
	LatestCompactedJson string                 `json:"latestCompactedObjects,omitempty"`
}

// KluctlDeploymentKey is used to group CommandResultSummaries that belong
// to the same logical deployment (resource discriminator).
type KluctlDeploymentKey struct {
	// Prefer KluctlDeploymentInfo when present
	KDName      string
	KDNamespace string
	// Fallback: project + target key
	Project ProjectKey
	Target  TargetKey
}

type KluctlDeploymentGroup struct {
	Key       KluctlDeploymentKey
	Summaries []CommandResultSummary
}

// GroupCommandResultSummaries groups summaries by resource discriminator.
// If KluctlDeploymentInfo is present, that is the primary key; otherwise we fall back to Project+Target.
func GroupCommandResultSummaries(summaries []CommandResultSummary) []KluctlDeploymentGroup {
	groups := map[KluctlDeploymentKey][]CommandResultSummary{}

	for _, s := range summaries {
		key := KluctlDeploymentKey{
			Project: s.ProjectKey,
			Target:  s.TargetKey,
		}
		if s.KluctlDeployment != nil {
			key.KDName = s.KluctlDeployment.Name
			key.KDNamespace = s.KluctlDeployment.Namespace
		}
		groups[key] = append(groups[key], s)
	}

	result := make([]KluctlDeploymentGroup, 0, len(groups))
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
		result = append(result, KluctlDeploymentGroup{
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

// BuildKluctlDeploymentObject converts a grouped deployment into a Kubernetes-like object.
// NAME is derived from the resource discriminator; NAMESPACE from KluctlDeployment.Namespace when present.
// The payloads map optionally contains decoded JSON payloads for each command result
// (reducedResult and compactedObjects). When present, these are attached to every
// CommandResultSummary so that the UI can compute manifest diffs per result.
func BuildKluctlDeploymentObject(g KluctlDeploymentGroup, payloads map[string]CommandResultPayload) KluctlDeploymentPseudoResource {
	// Work on a copy of the summaries slice so we don't mutate shared data.
	summaries := make([]CommandResultSummary, len(g.Summaries))
	copy(summaries, g.Summaries)

	// Attach decoded JSON payloads (if available) to each summary.
	if payloads != nil {
		for i := range summaries {
			if p, ok := payloads[summaries[i].Id]; ok {
				summaries[i].ReducedResultJSON = p.ReducedResultJSON
				summaries[i].CompactedObjectsJSON = p.CompactedObjectsJSON
			}
		}
	}

	latest := summaries[len(summaries)-1]

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

	meta := KluctlDeploymentMetadata{
		Name:              sanitizeKluctlName(name),
		Namespace:         namespace,
		CreationTimestamp: latest.Command.StartTime.Format(time.RFC3339),
	}

	spec := KluctlDeploymentSpec{
		Project: latest.ProjectKey,
		Target:  latest.TargetKey,
	}

	status := KluctlDeploymentStatus{
		AgeSeconds:       ageSeconds,
		LatestResult:     latest,
		CommandSummaries: summaries,
	}

	// Also expose the latest decoded payloads on the status root for quick access.
	if payloads != nil {
		if p, ok := payloads[latest.Id]; ok {
			status.LatestReducedResult = p.ReducedResultJSON
			status.LatestCompactedJson = p.CompactedObjectsJSON
		}
	}

	return KluctlDeploymentPseudoResource{
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

	// Decoded JSON payloads attached for UI consumers. These are populated
	// from the Kluctl result Secret data (when available) so that the UI
	// can compute manifest diffs per command result without additional API
	// calls.
	ReducedResultJSON    string `json:"reducedResult,omitempty"`
	CompactedObjectsJSON string `json:"compactedObjects,omitempty"`
}

// CommandResultPayload holds decoded JSON payloads from the result Secret.
type CommandResultPayload struct {
	ReducedResultJSON    string `json:"reducedResult,omitempty"`
	CompactedObjectsJSON string `json:"compactedObjects,omitempty"`
}

// gunzipToString decompresses a gzip-compressed byte slice into a string.
func gunzipToString(data []byte) (string, error) {
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	defer r.Close()
	b, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ListCommandResultSummariesWithPayload lists command result summaries by reading the
// summary annotation from Secrets in the given namespace and also returning decoded
// JSON payloads from the Secret's data.
func ListCommandResultSummariesWithPayload(ctx context.Context, k8sClient *kubernetes.Client, commandResultNamespace string) ([]CommandResultSummary, map[string]CommandResultPayload, error) {
	if k8sClient == nil || k8sClient.Clientset == nil {
		return nil, nil, fmt.Errorf("kubernetes clientset not initialized")
	}
	if commandResultNamespace == "" {
		return nil, nil, fmt.Errorf("command result namespace is empty")
	}

	secretClient := k8sClient.Clientset.CoreV1().Secrets(commandResultNamespace)
	secretList, err := secretClient.List(ctx, metav1.ListOptions{
		LabelSelector: "kluctl.io/command-result-id",
	})
	if err != nil {
		return nil, nil, err
	}

	summaries := make([]CommandResultSummary, 0, len(secretList.Items))
	payloads := make(map[string]CommandResultPayload, len(secretList.Items))
	for _, s := range secretList.Items {
		ann := s.Annotations["kluctl.io/command-result-summary"]
		if ann == "" {
			continue
		}
		var summary CommandResultSummary
		log.Printf("unmarshalling command result summary: %s", ann)
		// Log secret data contents (decoded bytes as text, truncated) for debugging.
		if err := json.Unmarshal([]byte(ann), &summary); err != nil {
			log.Printf("failed to unmarshal command result summary: %v", err)
			continue
		}

		var reducedJSON, compactedJSON string
		if data, ok := s.Data["reducedResult"]; ok && len(data) > 0 {
			if txt, err := gunzipToString(data); err != nil {
				log.Printf("failed to gunzip reducedResult for %s/%s: %v", s.Namespace, s.Name, err)
			} else {
				reducedJSON = txt
			}
		}
		if data, ok := s.Data["compactedObjects"]; ok && len(data) > 0 {
			if txt, err := gunzipToString(data); err != nil {
				log.Printf("failed to gunzip compactedObjects for %s/%s: %v", s.Namespace, s.Name, err)
			} else {
				compactedJSON = txt
			}
		}
		if reducedJSON != "" || compactedJSON != "" {
			payloads[summary.Id] = CommandResultPayload{
				ReducedResultJSON:    reducedJSON,
				CompactedObjectsJSON: compactedJSON,
			}
		}

		summaries = append(summaries, summary)
	}
	return summaries, payloads, nil
}

// ListCommandResultSummaries is a compatibility wrapper that returns only summaries.
func ListCommandResultSummaries(ctx context.Context, k8sClient *kubernetes.Client, commandResultNamespace string) ([]CommandResultSummary, error) {
	summaries, _, err := ListCommandResultSummariesWithPayload(ctx, k8sClient, commandResultNamespace)
	return summaries, err
}
