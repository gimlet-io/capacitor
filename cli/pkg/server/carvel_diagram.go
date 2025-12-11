// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// CarvelResourceNode represents a node in the resource tree
type CarvelResourceNode struct {
	Kind              string                 `json:"kind"`
	Name              string                 `json:"name"`
	Namespace         string                 `json:"namespace"`
	Group             string                 `json:"group"`
	Version           string                 `json:"version"`
	StatusInfo        *CarvelStatusInfo      `json:"status_info,omitempty"`
	SpecInfo          *CarvelSpecInfo        `json:"spec_info,omitempty"`
	RunningLocation   string                 `json:"running_location"`
	TargetCluster     *string                `json:"target_cluster,omitempty"`
	Annotations       map[string]interface{} `json:"-"` // Not exported to JSON, used for sorting
	Children          []CarvelResourceNode   `json:"children"`
}

// CarvelStatusInfo contains complete status information from the resource
type CarvelStatusInfo struct {
	// Common fields
	FriendlyDescription          string                 `json:"friendlyDescription,omitempty"`
	UsefulErrorMessage           string                 `json:"usefulErrorMessage,omitempty"`
	ObservedGeneration           int64                  `json:"observedGeneration,omitempty"`
	Conditions                   []interface{}          `json:"conditions,omitempty"`
	ConsecutiveReconcileSuccesses int                   `json:"consecutiveReconcileSuccesses,omitempty"`
	ConsecutiveReconcileFailures int                   `json:"consecutiveReconcileFailures,omitempty"`
	
	// Phase information for Apps and PackageInstalls
	Deploy   *CarvelPhaseInfo       `json:"deploy,omitempty"`
	Fetch    *CarvelPhaseInfo       `json:"fetch,omitempty"`
	Template *CarvelPhaseInfo       `json:"template,omitempty"`
	Inspect  *CarvelPhaseInfo       `json:"inspect,omitempty"`
	
	// PackageInstall specific
	Version              string                 `json:"version,omitempty"`
	LastAttemptedVersion string                 `json:"lastAttemptedVersion,omitempty"`
	
	// Capture any additional fields that might exist
	AdditionalFields     map[string]interface{} `json:"additionalFields,omitempty"`
}

// CarvelPhaseInfo contains information about a specific phase (deploy, fetch, template, inspect)
type CarvelPhaseInfo struct {
	ExitCode  int                    `json:"exitCode,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Finished  bool                   `json:"finished,omitempty"`
	StartedAt string                 `json:"startedAt,omitempty"`
	UpdatedAt string                 `json:"updatedAt,omitempty"`
	Stdout    string                 `json:"stdout,omitempty"`
	Stderr    string                 `json:"stderr,omitempty"`
	
	// Deploy-specific: kapp information
	Kapp              *CarvelKappInfo        `json:"kapp,omitempty"`
	
	// Capture any additional fields
	AdditionalFields  map[string]interface{} `json:"additionalFields,omitempty"`
}

// CarvelKappInfo contains kapp-specific information from deploy phase
type CarvelKappInfo struct {
	AssociatedResources *CarvelAssociatedResources `json:"associatedResources,omitempty"`
	AdditionalFields    map[string]interface{}     `json:"additionalFields,omitempty"`
}

// CarvelAssociatedResources contains information about resources managed by kapp
type CarvelAssociatedResources struct {
	GroupKinds       []map[string]interface{} `json:"groupKinds,omitempty"`
	Label            string                   `json:"label,omitempty"`
	Namespaces       []string                 `json:"namespaces,omitempty"`
	AdditionalFields map[string]interface{}   `json:"additionalFields,omitempty"`
}

// CarvelSpecInfo contains spec information from the resource
type CarvelSpecInfo struct {
	Paused     *bool   `json:"paused,omitempty"`
	Canceled   *bool   `json:"canceled,omitempty"`
	SyncPeriod *string `json:"syncPeriod,omitempty"`
}

// CarvelJSONNode represents the JSON output format
type CarvelJSONNode struct {
	Kind                string            `json:"kind"`
	Name                string            `json:"name"`
	Namespace           string            `json:"namespace"`
	APIVersion          string            `json:"apiVersion"`
	Cluster             string            `json:"cluster"`
	FriendlyDescription string            `json:"friendlyDescription"`
	SinceDeploy         string            `json:"since_deploy"`
	SpecInfo            *CarvelSpecInfo   `json:"spec_info,omitempty"`
	StatusInfo          *CarvelStatusInfo `json:"status_info,omitempty"`
	ChildObjects        []CarvelJSONNode  `json:"child_objects"`
}

// CarvelClients holds Kubernetes clients for a specific cluster
type CarvelClients struct {
	DynamicClient dynamic.Interface
	Clientset     kubernetes.Interface
	RestConfig    *rest.Config
}

// getNestedString safely retrieves a nested string value from a map
func getNestedString(obj map[string]interface{}, fields ...string) string {
	current := obj
	for i, field := range fields {
		if i == len(fields)-1 {
			if val, ok := current[field].(string); ok {
				return val
			}
			return ""
		}
		if next, ok := current[field].(map[string]interface{}); ok {
			current = next
		} else {
			return ""
		}
	}
	return ""
}

// getNestedMap safely retrieves a nested map value
func getNestedMap(obj map[string]interface{}, fields ...string) map[string]interface{} {
	current := obj
	for i, field := range fields {
		if i == len(fields)-1 {
			if val, ok := current[field].(map[string]interface{}); ok {
				return val
			}
			return nil
		}
		if next, ok := current[field].(map[string]interface{}); ok {
			current = next
		} else {
			return nil
		}
	}
	return nil
}

// getNestedSlice safely retrieves a nested slice value
func getNestedSlice(obj map[string]interface{}, fields ...string) []interface{} {
	current := obj
	for i, field := range fields {
		if i == len(fields)-1 {
			if val, ok := current[field].([]interface{}); ok {
				return val
			}
			return nil
		}
		if next, ok := current[field].(map[string]interface{}); ok {
			current = next
		} else {
			return nil
		}
	}
	return nil
}

// getNestedBool safely retrieves a nested bool value from a map
func getNestedBool(obj map[string]interface{}, fields ...string) (bool, bool) {
	current := obj
	for i, field := range fields {
		if i == len(fields)-1 {
			if val, ok := current[field].(bool); ok {
				return val, true
			}
			return false, false
		}
		if next, ok := current[field].(map[string]interface{}); ok {
			current = next
		} else {
			return false, false
		}
	}
	return false, false
}

// getKubeconfigFromSecret retrieves kubeconfig content from a Kubernetes secret
func getKubeconfigFromSecret(ctx context.Context, clientset kubernetes.Interface, secretName, secretKey, namespace string) (string, error) {
	secret, err := clientset.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get secret %s: %w", secretName, err)
	}

	// Try specified key first
	if data, ok := secret.Data[secretKey]; ok {
		return string(data), nil
	}

	// Fallback to 'value' key
	if data, ok := secret.Data["value"]; ok {
		return string(data), nil
	}

	return "", fmt.Errorf("neither '%s' nor 'value' key found in secret %s", secretKey, secretName)
}

// createClientsForCluster creates Kubernetes clients for a remote cluster based on kubeconfig secret
func createClientsForCluster(ctx context.Context, resource map[string]interface{}, namespace string, baseClientset kubernetes.Interface) (*CarvelClients, string, error) {
	resourceName := getNestedString(resource, "metadata", "name")
	log.Printf("[Debug] Creating clients for resource %s in namespace %s", resourceName, namespace)

	clusterSpec := getNestedMap(resource, "spec", "cluster")
	if clusterSpec == nil {
		return nil, "", nil
	}

	kubeconfigRef := getNestedMap(clusterSpec, "kubeconfigSecretRef")
	if kubeconfigRef == nil {
		return nil, "", nil
	}

	secretName := getNestedString(kubeconfigRef, "name")
	if secretName == "" {
		return nil, "", nil
	}

	secretKey := getNestedString(kubeconfigRef, "key")
	if secretKey == "" {
		secretKey = "value" // default
	}

	log.Printf("[Debug] Using secret %s with key %s for remote cluster config", secretName, secretKey)

	// Get kubeconfig from secret
	kubeconfigContent, err := getKubeconfigFromSecret(ctx, baseClientset, secretName, secretKey, namespace)
	if err != nil {
		log.Printf("[Debug] Failed to get kubeconfig content from secret %s: %v", secretName, err)
		return nil, "", err
	}

	// Load kubeconfig using clientcmd which properly handles the standard kubeconfig format
	kubeConfigData, err := clientcmd.Load([]byte(kubeconfigContent))
	if err != nil {
		log.Printf("[Debug] Error loading kubeconfig: %v", err)
		return nil, "", fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	// Log cluster information
	clusterURLs := []string{}
	for clusterName, cluster := range kubeConfigData.Clusters {
		clusterURLs = append(clusterURLs, cluster.Server)
		log.Printf("[Debug] Found cluster '%s' with server: %s", clusterName, cluster.Server)
	}
	log.Printf("[Debug] Kubeconfig contains cluster URLs: %v", clusterURLs)
	log.Printf("[Debug] Kubeconfig current context: %s", kubeConfigData.CurrentContext)

	// Build REST config directly from the loaded config
	clientConfig := clientcmd.NewDefaultClientConfig(*kubeConfigData, &clientcmd.ConfigOverrides{})
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, "", fmt.Errorf("failed to build REST config from kubeconfig: %w", err)
	}

	// Create clients
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create dynamic client: %w", err)
	}

	// Test connection
	namespaces, err := clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{TimeoutSeconds: int64Ptr(5)})
	if err != nil {
		log.Printf("[Debug] Remote cluster connection test failed: %v", err)
	} else {
		log.Printf("[Debug] Successfully connected to remote cluster - found %d namespaces", len(namespaces.Items))
	}

	// Determine cluster name from secret
	clusterName := secretName
	if strings.HasSuffix(clusterName, "-kubeconfig") {
		clusterName = strings.TrimSuffix(clusterName, "-kubeconfig") + "-ns"
	}

	return &CarvelClients{
		DynamicClient: dynamicClient,
		Clientset:     clientset,
		RestConfig:    restConfig,
	}, clusterName, nil
}

// ResourceInfo holds discovered information about a Kubernetes resource
type ResourceInfo struct {
	GVR        schema.GroupVersionResource
	Namespaced bool
}

// discoverResource dynamically discovers a resource's GVR and whether it's namespaced
// This is equivalent to Python's: resources = dynamic_client.resources.search(kind=kind, group=group)
func discoverResource(restConfig *rest.Config, group, kind string) (*ResourceInfo, error) {
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create discovery client: %w", err)
	}

	// Get all API resources
	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil {
		// Partial errors are acceptable (some API groups might be unavailable)
		log.Printf("[Debug] Warning during resource discovery: %v", err)
	}

	// Search for the resource
	for _, apiResourceList := range apiResourceLists {
		// Parse group and version from GroupVersion (e.g., "apps/v1" or "v1")
		gv, err := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if err != nil {
			continue
		}

		// Skip if group doesn't match
		if gv.Group != group {
			continue
		}

		// Search for the kind in this API group
		for _, apiResource := range apiResourceList.APIResources {
			if apiResource.Kind == kind {
				return &ResourceInfo{
					GVR: schema.GroupVersionResource{
						Group:    gv.Group,
						Version:  gv.Version,
						Resource: apiResource.Name,
					},
					Namespaced: apiResource.Namespaced,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("resource %s in group %s not found", kind, group)
}

// getResourcesByKappLabelInNamespaces queries resources matching a kapp label across specified group/kinds in multiple namespaces
func getResourcesByKappLabelInNamespaces(ctx context.Context, dynamicClient dynamic.Interface, restConfig *rest.Config, kappLabel string, groupKinds []interface{}, namespaces []interface{}) ([]map[string]interface{}, error) {
	resources := []map[string]interface{}{}
	processed := make(map[string]bool)

	labelSelector := fmt.Sprintf("kapp.k14s.io/app=%s", kappLabel)

	// Convert namespace slice to string slice
	namespacesToQuery := []string{}
	for _, ns := range namespaces {
		if nsStr, ok := ns.(string); ok {
			namespacesToQuery = append(namespacesToQuery, nsStr)
		}
	}

	log.Printf("[Debug] Querying resources in namespaces: %v", namespacesToQuery)

	for _, gk := range groupKinds {
		gkMap, ok := gk.(map[string]interface{})
		if !ok {
			continue
		}

		group := getNestedString(gkMap, "group")
		kind := getNestedString(gkMap, "kind")
		if kind == "" {
			continue
		}

		// Dynamically discover the resource (equivalent to Python's dynamic_client.resources.search)
		resourceInfo, err := discoverResource(restConfig, group, kind)
		if err != nil {
			log.Printf("[Debug] Could not discover resource %s/%s: %v", group, kind, err)
			continue
		}

		// Use discovered GVR and namespaced status
		gvr := resourceInfo.GVR
		isNamespaced := resourceInfo.Namespaced

		if !isNamespaced {
			// Cluster-scoped resources: only query if "(cluster)" is in namespaces list
			hasClusterScope := false
			for _, ns := range namespacesToQuery {
				if ns == "(cluster)" {
					hasClusterScope = true
					break
				}
			}

			if !hasClusterScope {
				continue
			}

			// Query cluster-scoped resources
			list, err := dynamicClient.Resource(gvr).List(ctx, metav1.ListOptions{
				LabelSelector: labelSelector,
			})

			if err != nil {
				log.Printf("[Debug] Could not list cluster-scoped %s: %v", kind, err)
				continue
			}

			for _, item := range list.Items {
				itemMap := item.Object
				resName := getNestedString(itemMap, "metadata", "name")
				resourceID := fmt.Sprintf("%s/%s//%s", group, kind, resName)

				if !processed[resourceID] {
					processed[resourceID] = true
					resources = append(resources, map[string]interface{}{
						"kind":       kind,
						"group":      group,
						"name":       resName,
						"namespace":  "",
						"raw":        itemMap,
						"apiVersion": item.GetAPIVersion(),
					})
				}
			}
		} else {
			// Namespaced resources: query each actual namespace (skip "(cluster)")
			for _, ns := range namespacesToQuery {
				if ns == "(cluster)" {
					continue
				}

				list, err := dynamicClient.Resource(gvr).Namespace(ns).List(ctx, metav1.ListOptions{
					LabelSelector: labelSelector,
				})

				if err != nil {
					log.Printf("[Debug] Could not list %s in namespace %s: %v", kind, ns, err)
					continue
				}

				for _, item := range list.Items {
					itemMap := item.Object
					resName := getNestedString(itemMap, "metadata", "name")
					resNamespace := getNestedString(itemMap, "metadata", "namespace")
					resourceID := fmt.Sprintf("%s/%s/%s/%s", group, kind, resNamespace, resName)

					if !processed[resourceID] {
						processed[resourceID] = true
						resources = append(resources, map[string]interface{}{
							"kind":       kind,
							"group":      group,
							"name":       resName,
							"namespace":  resNamespace,
							"raw":        itemMap,
							"apiVersion": item.GetAPIVersion(),
						})
					}
				}
			}
		}
	}

	log.Printf("[Debug] Found %d resources with kapp label %s", len(resources), kappLabel)
	return resources, nil
}

// getChangeGroups extracts all change-group annotations from a resource
func getChangeGroups(annotations map[string]interface{}) []string {
	groups := []string{}
	for key, value := range annotations {
		if key == "kapp.k14s.io/change-group" || strings.HasPrefix(key, "kapp.k14s.io/change-group.") {
			if strValue, ok := value.(string); ok && strValue != "" {
				groups = append(groups, strValue)
			}
		}
	}
	return groups
}

// changeRule represents a parsed kapp change rule
type changeRule struct {
	Action         string // "upsert" or "delete"
	Timing         string // "after" or "before"
	DependencyType string // "upserting" or "deleting"
	DependencyName string // the change-group name
}

// parseChangeRule parses a kapp change rule annotation value
func parseChangeRule(rule string) *changeRule {
	// Format: (upsert|delete) (after|before) (upserting|deleting) <name>
	parts := strings.Fields(rule)
	if len(parts) < 4 {
		return nil
	}

	return &changeRule{
		Action:         parts[0],
		Timing:         parts[1],
		DependencyType: parts[2],
		DependencyName: parts[3],
	}
}

// getChangeRules extracts all change-rule annotations from a resource
func getChangeRules(annotations map[string]interface{}) []*changeRule {
	rules := []*changeRule{}
	for key, value := range annotations {
		if key == "kapp.k14s.io/change-rule" || strings.HasPrefix(key, "kapp.k14s.io/change-rule.") {
			if strValue, ok := value.(string); ok && strValue != "" {
				if rule := parseChangeRule(strValue); rule != nil {
					rules = append(rules, rule)
				}
			}
		}
	}
	return rules
}

// sortChildrenByApplyOrder sorts children based on kapp change-group and change-rule annotations
func sortChildrenByApplyOrder(children []CarvelResourceNode) []CarvelResourceNode {
	if len(children) == 0 {
		return children
	}

	// Build maps for sorting
	groupToNodes := make(map[string][]int)    // group name -> node indices
	nodeToGroups := make(map[int][]string)    // node index -> group names
	nodeDeps := make(map[int][]string)        // node index -> dependency group names
	allGroups := make(map[string]bool)        // all unique groups

	// First pass: collect groups and dependencies
	for i, child := range children {
		// Only process App and PackageInstall resources
		if child.Kind != "App" && child.Kind != "PackageInstall" {
			continue
		}

		if child.Annotations == nil {
			continue
		}

		// Extract change-groups
		groups := getChangeGroups(child.Annotations)
		if len(groups) == 0 {
			// No change-group, treat as independent node
			continue
		}

		nodeToGroups[i] = groups
		for _, group := range groups {
			groupToNodes[group] = append(groupToNodes[group], i)
			allGroups[group] = true
		}

		// Extract change-rules and build dependencies
		rules := getChangeRules(child.Annotations)
		deps := []string{}
		for _, rule := range rules {
			// For now, focus on "upsert after upserting" rules
			if rule.Action == "upsert" && rule.Timing == "after" && rule.DependencyType == "upserting" {
				deps = append(deps, rule.DependencyName)
				allGroups[rule.DependencyName] = true
			}
		}
		if len(deps) > 0 {
			nodeDeps[i] = deps
		}
	}

	// Build dependency graph at group level
	groupDeps := make(map[string][]string)
	for nodeIdx, deps := range nodeDeps {
		nodeGroups := nodeToGroups[nodeIdx]
		for _, nodeGroup := range nodeGroups {
			for _, dep := range deps {
				if !contains(groupDeps[nodeGroup], dep) {
					groupDeps[nodeGroup] = append(groupDeps[nodeGroup], dep)
				}
			}
		}
	}

	// Topological sort using Kahn's algorithm
	// In-degree = number of dependencies a group has
	inDegree := make(map[string]int)
	for group := range allGroups {
		inDegree[group] = 0
	}
	for group, deps := range groupDeps {
		inDegree[group] = len(deps)
	}

	// Find groups with no dependencies
	queue := []string{}
	for group := range allGroups {
		if inDegree[group] == 0 {
			queue = append(queue, group)
		}
	}

	// Sort groups
	sortedGroups := []string{}
	for len(queue) > 0 {
		group := queue[0]
		queue = queue[1:]
		sortedGroups = append(sortedGroups, group)

		// Reduce in-degree for dependent groups
		for depGroup, deps := range groupDeps {
			if contains(deps, group) {
				inDegree[depGroup]--
				if inDegree[depGroup] == 0 {
					queue = append(queue, depGroup)
				}
			}
		}
	}

	// Build sorted children array
	sorted := []CarvelResourceNode{}
	processed := make(map[int]bool)

	// Add nodes in group order
	for _, group := range sortedGroups {
		if nodeIndices, ok := groupToNodes[group]; ok {
			for _, idx := range nodeIndices {
				if !processed[idx] {
					sorted = append(sorted, children[idx])
					processed[idx] = true
				}
			}
		}
	}

	// Add remaining nodes that weren't in any group
	for i, child := range children {
		if !processed[i] {
			sorted = append(sorted, child)
		}
	}

	return sorted
}

// contains checks if a string slice contains a string
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// extractSpecInfo extracts spec information for Carvel App and PackageInstall
func extractSpecInfo(resource map[string]interface{}, kind string) *CarvelSpecInfo {
	// Only extract spec info for App and PackageInstall
	if kind != "App" && kind != "PackageInstall" {
		return nil
	}

	resourceName := getNestedString(resource, "metadata", "name")
	log.Printf("[Debug] Extracting spec info for %s: %s", kind, resourceName)

	specInfo := &CarvelSpecInfo{}
	hasAnyField := false

	// Extract spec.paused
	if paused, ok := getNestedBool(resource, "spec", "paused"); ok {
		log.Printf("[Debug] Found spec.paused=%v for %s/%s", paused, kind, resourceName)
		specInfo.Paused = &paused
		hasAnyField = true
	}

	// Extract spec.canceled
	if canceled, ok := getNestedBool(resource, "spec", "canceled"); ok {
		log.Printf("[Debug] Found spec.canceled=%v for %s/%s", canceled, kind, resourceName)
		specInfo.Canceled = &canceled
		hasAnyField = true
	}

	// Extract spec.syncPeriod
	if syncPeriod := getNestedString(resource, "spec", "syncPeriod"); syncPeriod != "" {
		log.Printf("[Debug] Found spec.syncPeriod=%s for %s/%s", syncPeriod, kind, resourceName)
		specInfo.SyncPeriod = &syncPeriod
		hasAnyField = true
	}

	if !hasAnyField {
		log.Printf("[Debug] No spec info fields found for %s/%s", kind, resourceName)
		return nil
	}

	log.Printf("[Debug] Returning spec info for %s/%s with %d fields", kind, resourceName, 
		map[bool]int{true: 1, false: 0}[specInfo.Paused != nil] +
		map[bool]int{true: 1, false: 0}[specInfo.Canceled != nil] +
		map[bool]int{true: 1, false: 0}[specInfo.SyncPeriod != nil])

	return specInfo
}

// extractStatusInfo extracts complete status information for Carvel App and PackageInstall
func extractStatusInfo(resource map[string]interface{}, kind string) *CarvelStatusInfo {
	// Only extract status info for App and PackageInstall
	if kind != "App" && kind != "PackageInstall" {
		return nil
	}

	status := getNestedMap(resource, "status")
	if status == nil {
		return nil
	}

	resourceName := getNestedString(resource, "metadata", "name")
	log.Printf("[Debug] Extracting status info for %s: %s", kind, resourceName)

	statusInfo := &CarvelStatusInfo{}
	
	// Extract common fields
	statusInfo.FriendlyDescription = getNestedString(resource, "status", "friendlyDescription")
	statusInfo.UsefulErrorMessage = getNestedString(resource, "status", "usefulErrorMessage")
	
	if observedGen, ok := status["observedGeneration"].(float64); ok {
		statusInfo.ObservedGeneration = int64(observedGen)
	} else if observedGen, ok := status["observedGeneration"].(int64); ok {
		statusInfo.ObservedGeneration = observedGen
	}
	
	statusInfo.Conditions = getNestedSlice(resource, "status", "conditions")
	
	if consecutiveSuccesses, ok := status["consecutiveReconcileSuccesses"].(float64); ok {
		statusInfo.ConsecutiveReconcileSuccesses = int(consecutiveSuccesses)
	} else if consecutiveSuccesses, ok := status["consecutiveReconcileSuccesses"].(int); ok {
		statusInfo.ConsecutiveReconcileSuccesses = consecutiveSuccesses
	}
	
	if consecutiveFailures, ok := status["consecutiveReconcileFailures"].(float64); ok {
		statusInfo.ConsecutiveReconcileFailures = int(consecutiveFailures)
	} else if consecutiveFailures, ok := status["consecutiveReconcileFailures"].(int); ok {
		statusInfo.ConsecutiveReconcileFailures = consecutiveFailures
	}
	
	// Extract phase information
	statusInfo.Deploy = extractPhaseInfo(resource, "deploy")
	statusInfo.Fetch = extractPhaseInfo(resource, "fetch")
	statusInfo.Template = extractPhaseInfo(resource, "template")
	statusInfo.Inspect = extractPhaseInfo(resource, "inspect")
	
	// Extract PackageInstall specific fields
	statusInfo.Version = getNestedString(resource, "status", "version")
	statusInfo.LastAttemptedVersion = getNestedString(resource, "status", "lastAttemptedVersion")
	
	// Extract any additional fields not covered above
	statusInfo.AdditionalFields = extractAdditionalFields(status, []string{
		"friendlyDescription", "observedGeneration", "conditions",
		"consecutiveReconcileSuccesses", "consecutiveReconcileFailures",
		"deploy", "fetch", "template", "inspect",
		"version", "lastAttemptedVersion",
	})
	
	return statusInfo
}

// extractPhaseInfo extracts phase information (deploy, fetch, template, inspect)
func extractPhaseInfo(resource map[string]interface{}, phaseName string) *CarvelPhaseInfo {
	phase := getNestedMap(resource, "status", phaseName)
	if phase == nil {
		return nil
	}

	phaseInfo := &CarvelPhaseInfo{}
	
	// Extract basic fields
	if exitCode, ok := phase["exitCode"].(float64); ok {
		phaseInfo.ExitCode = int(exitCode)
	} else if exitCode, ok := phase["exitCode"].(int); ok {
		phaseInfo.ExitCode = exitCode
	}
	
	phaseInfo.Error = getNestedString(resource, "status", phaseName, "error")
	
	if finished, ok := phase["finished"].(bool); ok {
		phaseInfo.Finished = finished
	}
	
	phaseInfo.StartedAt = getNestedString(resource, "status", phaseName, "startedAt")
	phaseInfo.UpdatedAt = getNestedString(resource, "status", phaseName, "updatedAt")
	phaseInfo.Stdout = getNestedString(resource, "status", phaseName, "stdout")
	phaseInfo.Stderr = getNestedString(resource, "status", phaseName, "stderr")
	
	// Extract kapp info for deploy phase
	if phaseName == "deploy" {
		phaseInfo.Kapp = extractKappInfo(resource)
	}
	
	// Extract additional fields
	phaseInfo.AdditionalFields = extractAdditionalFields(phase, []string{
		"exitCode", "error", "finished", "startedAt", "updatedAt",
		"stdout", "stderr", "kapp",
	})
	
	return phaseInfo
}

// extractKappInfo extracts kapp-specific information from deploy phase
func extractKappInfo(resource map[string]interface{}) *CarvelKappInfo {
	kapp := getNestedMap(resource, "status", "deploy", "kapp")
	if kapp == nil {
		return nil
	}

	kappInfo := &CarvelKappInfo{}
	
	// Extract associatedResources
	associatedResources := getNestedMap(resource, "status", "deploy", "kapp", "associatedResources")
	if associatedResources != nil {
		kappInfo.AssociatedResources = &CarvelAssociatedResources{
			Label:      getNestedString(resource, "status", "deploy", "kapp", "associatedResources", "label"),
			Namespaces: getNestedStringSlice(resource, "status", "deploy", "kapp", "associatedResources", "namespaces"),
		}
		
		// Extract groupKinds
		if groupKinds := getNestedSlice(resource, "status", "deploy", "kapp", "associatedResources", "groupKinds"); groupKinds != nil {
			gkList := make([]map[string]interface{}, 0, len(groupKinds))
			for _, gk := range groupKinds {
				if gkMap, ok := gk.(map[string]interface{}); ok {
					gkList = append(gkList, gkMap)
				}
			}
			kappInfo.AssociatedResources.GroupKinds = gkList
		}
		
		// Extract additional fields from associatedResources
		kappInfo.AssociatedResources.AdditionalFields = extractAdditionalFields(associatedResources, []string{
			"groupKinds", "label", "namespaces",
		})
	}
	
	// Extract additional fields from kapp
	kappInfo.AdditionalFields = extractAdditionalFields(kapp, []string{
		"associatedResources",
	})
	
	return kappInfo
}

// extractAdditionalFields extracts any fields not in the excludeKeys list
func extractAdditionalFields(obj map[string]interface{}, excludeKeys []string) map[string]interface{} {
	if obj == nil {
		return nil
	}
	
	excludeMap := make(map[string]bool)
	for _, key := range excludeKeys {
		excludeMap[key] = true
	}
	
	additional := make(map[string]interface{})
	for key, value := range obj {
		if !excludeMap[key] {
			additional[key] = value
		}
	}
	
	if len(additional) == 0 {
		return nil
	}
	
	return additional
}

// getNestedStringSlice safely retrieves a nested string slice from a map
func getNestedStringSlice(obj map[string]interface{}, fields ...string) []string {
	current := obj
	for i, field := range fields {
		if i == len(fields)-1 {
			if slice, ok := current[field].([]interface{}); ok {
				result := make([]string, 0, len(slice))
				for _, item := range slice {
					if str, ok := item.(string); ok {
						result = append(result, str)
					}
				}
				return result
			}
			return nil
		}
		if next, ok := current[field].(map[string]interface{}); ok {
			current = next
		} else {
			return nil
		}
	}
	return nil
}

// createLeafNode creates a non-recursive leaf node for non-Carvel resources
func createLeafNode(resource map[string]interface{}, runningLocation string) *CarvelResourceNode {
	resourceName := getNestedString(resource, "metadata", "name")
	resourceNamespace := getNestedString(resource, "metadata", "namespace")
	kind := getNestedString(resource, "kind")
	apiVersion := getNestedString(resource, "apiVersion")

	// Extract group and version from apiVersion
	group := "core"
	version := "v1"
	if strings.Contains(apiVersion, "/") {
		parts := strings.Split(apiVersion, "/")
		group = parts[0]
		if len(parts) > 1 {
			version = parts[1]
		}
	} else if apiVersion != "" {
		version = apiVersion
	}

	// Extract spec info for Carvel resources
	specInfo := extractSpecInfo(resource, kind)

	// Extract status info for Carvel resources
	statusInfo := extractStatusInfo(resource, kind)

	// Extract annotations for apply order sorting
	annotations := getNestedMap(resource, "metadata", "annotations")

	return &CarvelResourceNode{
		Kind:            kind,
		Name:            resourceName,
		Namespace:       resourceNamespace,
		Group:           group,
		Version:         version,
		StatusInfo:      statusInfo,
		SpecInfo:        specInfo,
		RunningLocation: runningLocation,
		TargetCluster:   nil,
		Annotations:     annotations,
		Children:        []CarvelResourceNode{}, // Leaf node, no children
	}
}

// buildResourceTree recursively builds a tree of Carvel resources
// If allResources is true, includes all Kubernetes resources
// If onlyCarvel is true (and allResources is false), includes only Apps and PackageInstalls
// Otherwise, returns only the root resource without children
func buildResourceTree(ctx context.Context, resource map[string]interface{}, clients *CarvelClients, baseClients *CarvelClients, parentClusterName string, allResources bool, onlyCarvel bool) (*CarvelResourceNode, error) {
	resourceName := getNestedString(resource, "metadata", "name")
	resourceNamespace := getNestedString(resource, "metadata", "namespace")
	kind := getNestedString(resource, "kind")
	apiVersion := getNestedString(resource, "apiVersion")

	// Determine resource's running location
	runningLocation := parentClusterName

	// Determine target cluster (where this resource deploys to)
	var targetCluster *string
	clusterSpec := getNestedMap(resource, "spec", "cluster")
	if clusterSpec != nil {
		kubeconfigRef := getNestedMap(clusterSpec, "kubeconfigSecretRef")
		if kubeconfigRef != nil {
			secretName := getNestedString(kubeconfigRef, "name")
			if secretName != "" {
				clusterName := secretName
				if strings.HasSuffix(clusterName, "-kubeconfig") {
					clusterName = strings.TrimSuffix(clusterName, "-kubeconfig") + "-ns"
				}
				targetCluster = &clusterName
				log.Printf("[Debug] Resource %s has remote cluster configuration for cluster %s", resourceName, clusterName)
			}
		}
	}

	// Extract group and version from apiVersion
	group := "core"
	version := "v1"
	if strings.Contains(apiVersion, "/") {
		parts := strings.Split(apiVersion, "/")
		group = parts[0]
		if len(parts) > 1 {
			version = parts[1]
		}
	} else if apiVersion != "" {
		version = apiVersion
	}

	// Extract spec info for Carvel resources
	specInfo := extractSpecInfo(resource, kind)

	// Extract status info for Carvel resources
	statusInfo := extractStatusInfo(resource, kind)

	// Extract annotations for apply order sorting
	annotations := getNestedMap(resource, "metadata", "annotations")

	tree := &CarvelResourceNode{
		Kind:            kind,
		Name:            resourceName,
		Namespace:       resourceNamespace,
		Group:           group,
		Version:         version,
		StatusInfo:      statusInfo,
		SpecInfo:        specInfo,
		RunningLocation: runningLocation,
		TargetCluster:   targetCluster,
		Annotations:     annotations,
		Children:        []CarvelResourceNode{},
	}

	// Determine working clients
	workingClients := clients

	// Create remote clients if resource targets a remote cluster
	if targetCluster != nil {
		remoteClients, remoteClusterName, err := createClientsForCluster(ctx, resource, resourceNamespace, baseClients.Clientset)
		if err == nil && remoteClients != nil {
			workingClients = remoteClients
			log.Printf("[Debug] Successfully created remote clients for cluster %s", remoteClusterName)
		}
	}

	// Process based on resource type
	if kind == "App" {
		// Query resources based on flags:
		// - allResources=true: include all Kubernetes resources
		// - onlyCarvel=true: include only Carvel Apps and PackageInstalls
		if allResources || onlyCarvel {
			// Get kapp label from status
			kappLabelFull := getNestedString(resource, "status", "deploy", "kapp", "associatedResources", "label")
			if kappLabelFull == "" {
				return tree, nil
			}

			parts := strings.Split(kappLabelFull, "=")
			if len(parts) != 2 {
				return tree, nil
			}
			kappLabel := parts[1]

			groupKinds := getNestedSlice(resource, "status", "deploy", "kapp", "associatedResources", "groupKinds")
			if groupKinds == nil {
				return tree, nil
			}

			// Get the list of namespaces to search in
			namespaces := getNestedSlice(resource, "status", "deploy", "kapp", "associatedResources", "namespaces")
			
			// Query resources by kapp label across all namespaces
			resources, err := getResourcesByKappLabelInNamespaces(ctx, workingClients.DynamicClient, workingClients.RestConfig, kappLabel, groupKinds, namespaces)
			if err != nil {
				log.Printf("[Debug] Error getting resources by kapp label: %v", err)
				return tree, nil
			}

			// Determine next location for child resources
			nextLocation := runningLocation
			if targetCluster != nil {
				nextLocation = *targetCluster
			}

			// Process all resources
			for _, res := range resources {
				resKind := res["kind"].(string)
				resGroup := res["group"].(string)
				rawMap := res["raw"].(map[string]interface{})
				
				isCarvelResource := (resKind == "App" && resGroup == "kappctrl.k14s.io") || (resKind == "PackageInstall" && resGroup == "packaging.carvel.dev")
				
				// If onlyCarvel=true (and allResources=false), skip non-Carvel resources
				if onlyCarvel && !allResources && !isCarvelResource {
					continue
				}
				
				// For App and PackageInstall, recurse; for other resources, create leaf nodes
				if isCarvelResource {
					childTree, err := buildResourceTree(ctx, rawMap, workingClients, baseClients, nextLocation, allResources, onlyCarvel)
					if err == nil && childTree != nil {
						tree.Children = append(tree.Children, *childTree)
					}
				} else {
					// For non-Carvel resources, create a leaf node (no recursion)
					leafNode := createLeafNode(rawMap, nextLocation)
					if leafNode != nil {
						tree.Children = append(tree.Children, *leafNode)
					}
				}
			}
		}
		// When allResources=false, don't query any child resources - return App node only
	} else if kind == "PackageInstall" {
		packageRef := getNestedString(resource, "spec", "packageRef", "refName")
		log.Printf("[Debug] Processing PackageInstall %s with package %s", resourceName, packageRef)

		// Try to find associated App (same name as PackageInstall)
		var app map[string]interface{}

		// First check in original cluster if we have a target cluster
		if targetCluster != nil {
			log.Printf("[Debug] Checking if App %s exists in the original in-cluster", resourceName)
			appGVR := schema.GroupVersionResource{
				Group:    "kappctrl.k14s.io",
				Version:  "v1alpha1",
				Resource: "apps",
			}

			appUnstructured, err := baseClients.DynamicClient.Resource(appGVR).Namespace(resourceNamespace).Get(ctx, resourceName, metav1.GetOptions{})
			if err == nil {
				log.Printf("[Debug] Found App %s in the ORIGINAL in-cluster!", resourceName)
				app = appUnstructured.Object
				// Use original clients for further processing
				workingClients = baseClients
			} else {
				log.Printf("[Debug] App %s not found in original in-cluster. Continuing with remote cluster search.", resourceName)
			}
		}

		// If not found in original cluster, try working cluster
		if app == nil {
			appGVR := schema.GroupVersionResource{
				Group:    "kappctrl.k14s.io",
				Version:  "v1alpha1",
				Resource: "apps",
			}

			appUnstructured, err := workingClients.DynamicClient.Resource(appGVR).Namespace(resourceNamespace).Get(ctx, resourceName, metav1.GetOptions{})
			if err == nil {
				log.Printf("[Debug] Found App for PackageInstall %s", resourceName)
				app = appUnstructured.Object
			} else {
				log.Printf("[Debug] App not found for PackageInstall %s: %v", resourceName, err)
			}
		}

		// Add app to tree if found
		if app != nil {
			log.Printf("[Debug] Processing App %s associated with PackageInstall %s", getNestedString(app, "metadata", "name"), resourceName)
			childTree, err := buildResourceTree(ctx, app, baseClients, baseClients, parentClusterName, allResources, onlyCarvel)
			if err == nil && childTree != nil {
				tree.Children = append(tree.Children, *childTree)
			}
		} else {
			log.Printf("[Debug] No App found for PackageInstall %s after exhaustive search", resourceName)
		}
	}

	// Sort children by kapp apply order before returning
	tree.Children = sortChildrenByApplyOrder(tree.Children)

	return tree, nil
}

// getSinceDeploy calculates time since deployment
func getSinceDeploy(node *CarvelResourceNode) string {
	if node.StatusInfo == nil || node.StatusInfo.Deploy == nil {
		return "default"
	}

	updatedAtStr := node.StatusInfo.Deploy.UpdatedAt
	if updatedAtStr == "" {
		return "default"
	}

	// Parse timestamp
	updatedAt, err := time.Parse(time.RFC3339, updatedAtStr)
	if err != nil {
		log.Printf("[Debug] Error parsing updatedAt timestamp: %v", err)
		return "default"
	}

	duration := time.Since(updatedAt)
	hours := int(duration.Hours())
	minutes := int(duration.Minutes()) % 60
	seconds := int(duration.Seconds()) % 60

	if hours > 0 {
		return fmt.Sprintf("%dh%dm%ds", hours, minutes, seconds)
	}
	return fmt.Sprintf("%dm%ds", minutes, seconds)
}

// buildJSONTree converts the resource tree to JSON output format
func buildJSONTree(tree *CarvelResourceNode) *CarvelJSONNode {
	// Determine API version
	apiVersion := "v1"
	if tree.Group != "core" && tree.Group != "" {
		// Use the actual version from the resource, not hardcoded "v1"
		version := tree.Version
		if version == "" {
			version = "v1"
		}
		apiVersion = tree.Group + "/" + version
	} else if tree.Version != "" {
		// For core resources, use the version if available
		apiVersion = tree.Version
	}

	// Get friendly description
	friendlyDescription := "Unknown"
	if tree.StatusInfo != nil && tree.StatusInfo.FriendlyDescription != "" {
		friendlyDescription = tree.StatusInfo.FriendlyDescription
	}

	// Calculate since deploy
	sinceDeploy := getSinceDeploy(tree)

	// Build child objects
	childObjects := []CarvelJSONNode{}
	for _, child := range tree.Children {
		childJSON := buildJSONTree(&child)
		if childJSON != nil {
			childObjects = append(childObjects, *childJSON)
		}
	}

	return &CarvelJSONNode{
		Kind:                tree.Kind,
		Name:                tree.Name,
		Namespace:           tree.Namespace,
		APIVersion:          apiVersion,
		Cluster:             tree.RunningLocation,
		FriendlyDescription: friendlyDescription,
		SinceDeploy:         sinceDeploy,
		SpecInfo:            tree.SpecInfo,
		StatusInfo:          tree.StatusInfo,
		ChildObjects:        childObjects,
	}
}

// handleCarvelAppDiagram handles the Carvel App diagram API endpoint
func handleCarvelAppDiagram(c echo.Context, proxy *KubernetesProxy) error {
	ctx := c.Request().Context()
	namespace := c.Param("namespace")
	name := c.Param("name")

	// Parse query parameters (default to false)
	allResources := c.QueryParam("allResources") == "true"
	onlyCarvel := c.QueryParam("onlyCarvel") == "true"
	
	// Priority logic: allResources takes precedence over onlyCarvel
	if allResources && onlyCarvel {
		onlyCarvel = false // allResources=true means include everything
	}

	log.Printf("[Debug] Fetching Carvel App: namespace=%s, name=%s, allResources=%v, onlyCarvel=%v", namespace, name, allResources, onlyCarvel)

	// Create base clients
	baseClients := &CarvelClients{
		DynamicClient: proxy.dynamicClient,
		Clientset:     proxy.k8sClient.Clientset,
		RestConfig:    proxy.k8sClient.Config,
	}

	// Get the App resource
	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	appUnstructured, err := baseClients.DynamicClient.Resource(appGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]interface{}{
			"error":  fmt.Sprintf("App '%s' not found in namespace '%s'", name, namespace),
			"status": 404,
		})
	}

	app := appUnstructured.Object

	// Determine cluster name
	clusterName := "in-cluster"

	// Build resource tree with allResources and onlyCarvel flags
	tree, err := buildResourceTree(ctx, app, baseClients, baseClients, clusterName, allResources, onlyCarvel)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": fmt.Sprintf("Failed to build resource tree: %v", err),
		})
	}

	// Convert to JSON format
	jsonTree := buildJSONTree(tree)

	return c.JSON(http.StatusOK, jsonTree)
}

// handleCarvelPkgiDiagram handles the Carvel PackageInstall diagram API endpoint
func handleCarvelPkgiDiagram(c echo.Context, proxy *KubernetesProxy) error {
	ctx := c.Request().Context()
	namespace := c.Param("namespace")
	name := c.Param("name")

	// Parse query parameters (default to false)
	allResources := c.QueryParam("allResources") == "true"
	onlyCarvel := c.QueryParam("onlyCarvel") == "true"
	
	// Priority logic: allResources takes precedence over onlyCarvel
	if allResources && onlyCarvel {
		onlyCarvel = false // allResources=true means include everything
	}

	log.Printf("[Debug] Fetching Carvel PackageInstall: namespace=%s, name=%s, allResources=%v, onlyCarvel=%v", namespace, name, allResources, onlyCarvel)

	// Create base clients
	baseClients := &CarvelClients{
		DynamicClient: proxy.dynamicClient,
		Clientset:     proxy.k8sClient.Clientset,
		RestConfig:    proxy.k8sClient.Config,
	}

	// Get the PackageInstall resource
	pkgiGVR := schema.GroupVersionResource{
		Group:    "packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packageinstalls",
	}

	pkgiUnstructured, err := baseClients.DynamicClient.Resource(pkgiGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]interface{}{
			"error":  fmt.Sprintf("PackageInstall '%s' not found in namespace '%s'", name, namespace),
			"status": 404,
		})
	}

	pkgi := pkgiUnstructured.Object

	// Determine cluster name
	clusterName := "in-cluster"

	// Build the PackageInstall node
	pkgiName := getNestedString(pkgi, "metadata", "name")
	pkgiNamespace := getNestedString(pkgi, "metadata", "namespace")

	// Extract spec info for PackageInstall
	specInfo := extractSpecInfo(pkgi, "PackageInstall")

	// Extract status info for PackageInstall
	statusInfo := extractStatusInfo(pkgi, "PackageInstall")

	// Extract annotations for apply order sorting
	annotations := getNestedMap(pkgi, "metadata", "annotations")

	// Extract group and version from apiVersion
	apiVersion := getNestedString(pkgi, "apiVersion")
	group := "core"
	version := "v1"
	if strings.Contains(apiVersion, "/") {
		parts := strings.Split(apiVersion, "/")
		group = parts[0]
		if len(parts) > 1 {
			version = parts[1]
		}
	} else if apiVersion != "" {
		version = apiVersion
	}

	// Create PackageInstall root node
	pkgiNode := &CarvelResourceNode{
		Kind:            "PackageInstall",
		Name:            pkgiName,
		Namespace:       pkgiNamespace,
		Group:           group,
		Version:         version,
		StatusInfo:      statusInfo,
		SpecInfo:        specInfo,
		Annotations: annotations,
		Children:    []CarvelResourceNode{},
	}

	// Get the associated App resource (same name as PackageInstall)
	appGVR := schema.GroupVersionResource{
		Group:    "kappctrl.k14s.io",
		Version:  "v1alpha1",
		Resource: "apps",
	}

	appUnstructured, err := baseClients.DynamicClient.Resource(appGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		log.Printf("[Debug] Associated App '%s' not found in namespace '%s': %v", name, namespace, err)
		// Return PackageInstall without App child if App not found
		jsonTree := buildJSONTree(pkgiNode)
		return c.JSON(http.StatusOK, jsonTree)
	}

	app := appUnstructured.Object

	// Build resource tree for the App with allResources and onlyCarvel flags
	appTree, err := buildResourceTree(ctx, app, baseClients, baseClients, clusterName, allResources, onlyCarvel)
	if err != nil {
		log.Printf("[Debug] Failed to build App resource tree: %v", err)
		// Return PackageInstall without App child if tree building fails
		jsonTree := buildJSONTree(pkgiNode)
		return c.JSON(http.StatusOK, jsonTree)
	}

	// Add App as child of PackageInstall
	pkgiNode.Children = append(pkgiNode.Children, *appTree)

	// Convert to JSON format
	jsonTree := buildJSONTree(pkgiNode)

	return c.JSON(http.StatusOK, jsonTree)
}

// handleCarvelPackage handles requests for Carvel Package details
func handleCarvelPackage(c echo.Context, proxy *KubernetesProxy) error {
	namespace := c.Param("namespace")
	packageName := c.Param("packageName")

	log.Printf("[Debug] Fetching Package: namespace=%s, packageName=%s", namespace, packageName)

	ctx := c.Request().Context()

	// Package GVR
	packageGVR := schema.GroupVersionResource{
		Group:    "data.packaging.carvel.dev",
		Version:  "v1alpha1",
		Resource: "packages",
	}

	// Get Package
	packageUnstructured, err := proxy.dynamicClient.Resource(packageGVR).Namespace(namespace).Get(ctx, packageName, metav1.GetOptions{})
	if err != nil {
		log.Printf("[Error] Failed to get Package '%s' in namespace '%s': %v", packageName, namespace, err)
		return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Package not found: %v", err)})
	}

	pkg := packageUnstructured.Object

	// Determine cluster name
	clusterName := "in-cluster"

	// Extract Package details
	packageDetails := map[string]interface{}{
		"apiVersion": getNestedString(pkg, "apiVersion"),
		"kind":       getNestedString(pkg, "kind"),
		"metadata": map[string]interface{}{
			"name":              getNestedString(pkg, "metadata", "name"),
			"namespace":         getNestedString(pkg, "metadata", "namespace"),
			"creationTimestamp": getNestedString(pkg, "metadata", "creationTimestamp"),
			"annotations":       getNestedMap(pkg, "metadata", "annotations"),
			"labels":            getNestedMap(pkg, "metadata", "labels"),
		},
		"spec": map[string]interface{}{
			"refName":                         getNestedString(pkg, "spec", "refName"),
			"version":                         getNestedString(pkg, "spec", "version"),
			"releasedAt":                      getNestedString(pkg, "spec", "releasedAt"),
			"releaseNotes":                    getNestedString(pkg, "spec", "releaseNotes"),
			"capacityRequirementsDescription": getNestedString(pkg, "spec", "capacityRequirementsDescription"),
			"licenses":                        getNestedSlice(pkg, "spec", "licenses"),
			"includedSoftware":                getNestedSlice(pkg, "spec", "includedSoftware"),
			"template":                        getNestedMap(pkg, "spec", "template"),
			"valuesSchema":                    getNestedMap(pkg, "spec", "valuesSchema"),
		},
		"cluster": clusterName,
	}

	return c.JSON(http.StatusOK, packageDetails)
}

// Helper function
func int64Ptr(i int64) *int64 {
	return &i
}
