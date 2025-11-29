// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package helm

import (
	"context"
	"fmt"
	"log"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
)

// Client wraps the Helm client with additional functionality
type Client struct {
	actionConfig *action.Configuration
	settings     *cli.EnvSettings
}

// Release represents a Helm release with additional metadata
type Release struct {
	Name         string                 `json:"name"`
	Namespace    string                 `json:"namespace"`
	Revision     int                    `json:"revision"`
	Updated      time.Time              `json:"updated"`
	Status       string                 `json:"status"`
	Chart        string                 `json:"chart"`
	ChartVersion string                 `json:"chartVersion"`
	AppVersion   string                 `json:"appVersion"`
	Description  string                 `json:"description"`
	Notes        string                 `json:"notes"`
	Values       map[string]interface{} `json:"values"`
}

// HistoryRelease represents a Helm release history entry
type HistoryRelease struct {
	Revision    int    `json:"revision"`
	Updated     string `json:"updated"`
	Status      string `json:"status"`
	Chart       string `json:"chart"`
	AppVersion  string `json:"app_version"`
	Description string `json:"description"`
}

// ValueSource represents a ConfigMap or Secret referenced in valuesFrom
type ValueSource struct {
	Kind       string  `json:"kind"`
	Name       string  `json:"name"`
	ValuesKey  string  `json:"valuesKey"`
	TargetPath *string `json:"targetPath,omitempty"`
	Optional   bool    `json:"optional"`
	Data       *string `json:"data,omitempty"`
	Exists     bool    `json:"exists"`
	Error      *string `json:"error,omitempty"`
}

// NewClient creates a new Helm client
func NewClient(kubeConfig *rest.Config, namespace string) (*Client, error) {
	// Create Helm settings
	settings := cli.New()

	// Override namespace if provided
	if namespace != "" {
		settings.SetNamespace(namespace)
	}

	// Create action configuration
	actionConfig := new(action.Configuration)

	// Initialize with the provided kubeconfig
	if err := actionConfig.Init(
		&restClientGetter{config: kubeConfig, namespace: namespace},
		settings.Namespace(),
		"secret",
		log.Printf,
	); err != nil {
		return nil, fmt.Errorf("failed to initialize Helm action config: %w", err)
	}

	return &Client{
		actionConfig: actionConfig,
		settings:     settings,
	}, nil
}

// ListReleases lists all Helm releases in the configured namespace
func (c *Client) ListReleases(ctx context.Context, namespace string) ([]*Release, error) {
	// Create a new action configuration for this specific request
	actionConfig := new(action.Configuration)

	// Create a client getter that uses the specified namespace
	getter := &restClientGetter{
		config:    c.actionConfig.RESTClientGetter.(*restClientGetter).config,
		namespace: namespace,
	}

	// Initialize the action config with the namespace
	err := actionConfig.Init(
		getter,
		namespace,
		"secret",
		log.Printf,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Helm action config with namespace %s: %w", namespace, err)
	}

	// Create a list action configuration using our namespace-specific action config
	client := action.NewList(actionConfig)

	// Configure list options
	client.All = true // Include all statuses
	client.AllNamespaces = namespace == "" || namespace == "all-namespaces"

	client.SetStateMask()

	// Execute the list action
	releases, err := client.Run()
	if err != nil {
		log.Printf("Error listing Helm releases: %v", err)
		return nil, fmt.Errorf("failed to list Helm releases: %w", err)
	}

	// Convert to our Release format
	result := make([]*Release, 0, len(releases))
	for _, rel := range releases {
		helmRelease := convertRelease(rel)
		result = append(result, helmRelease)
	}

	return result, nil
}

// GetRelease gets a specific Helm release
func (c *Client) GetRelease(ctx context.Context, name string) (*Release, error) {
	client := action.NewGet(c.actionConfig)

	rel, err := client.Run(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get Helm release %s: %w", name, err)
	}

	return convertRelease(rel), nil
}

// GetHistory retrieves the release history for a Helm release
func (c *Client) GetHistory(ctx context.Context, name, namespace string) ([]HistoryRelease, error) {
	// Create a new action configuration for this specific request
	actionConfig := new(action.Configuration)

	// Create a client getter that uses the specified namespace
	getter := &restClientGetter{
		config:    c.actionConfig.RESTClientGetter.(*restClientGetter).config,
		namespace: namespace,
	}

	// Initialize the action config with the namespace
	err := actionConfig.Init(
		getter,
		namespace,
		"secret",
		log.Printf,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Helm action config with namespace %s: %w", namespace, err)
	}

	// Create a history action
	client := action.NewHistory(actionConfig)
	client.Max = 20 // Limit to 20 history items

	// Get release history
	releaseHistory, err := client.Run(name)
	if err != nil {
		log.Printf("Error getting Helm release history: %v", err)
		return nil, fmt.Errorf("failed to get history for release %s: %w", name, err)
	}

	// Convert to our HistoryRelease format
	result := make([]HistoryRelease, 0, len(releaseHistory))
	for _, rel := range releaseHistory {
		history := HistoryRelease{
			Revision:    rel.Version,
			Updated:     rel.Info.LastDeployed.Format(time.RFC3339),
			Status:      rel.Info.Status.String(),
			Chart:       fmt.Sprintf("%s-%s", rel.Chart.Metadata.Name, rel.Chart.Metadata.Version),
			AppVersion:  rel.Chart.Metadata.AppVersion,
			Description: rel.Info.Description,
		}
		result = append(result, history)
	}

	return result, nil
}

// GetValues retrieves the values for a Helm release
func (c *Client) GetValues(ctx context.Context, name, namespace string, allValues bool, revision int) (map[string]interface{}, error) {
	log.Printf("GetValues called for release %s in namespace %s, allValues=%v, revision=%d", name, namespace, allValues, revision)

	// Create a new action configuration for this specific request
	actionConfig := new(action.Configuration)

	// Create a client getter that uses the specified namespace
	getter := &restClientGetter{
		config:    c.actionConfig.RESTClientGetter.(*restClientGetter).config,
		namespace: namespace,
	}

	// Initialize the action config with the namespace
	err := actionConfig.Init(
		getter,
		namespace,
		"secret",
		log.Printf,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Helm action config with namespace %s: %w", namespace, err)
	}

	// Create a get values action
	client := action.NewGetValues(actionConfig)
	client.AllValues = allValues
	client.Version = revision

	// Get values
	values, err := client.Run(name)
	if err != nil {
		log.Printf("Error getting Helm release values: %v", err)
		return nil, fmt.Errorf("failed to get values for release %s: %w", name, err)
	}

	return values, nil
}

// GetManifest retrieves the manifest for a Helm release at a specific revision
func (c *Client) GetManifest(ctx context.Context, name, namespace string, revision int) (string, error) {
	log.Printf("GetManifest called for release %s in namespace %s, revision=%d", name, namespace, revision)

	// Create a new action configuration for this specific request
	actionConfig := new(action.Configuration)

	// Create a client getter that uses the specified namespace
	getter := &restClientGetter{
		config:    c.actionConfig.RESTClientGetter.(*restClientGetter).config,
		namespace: namespace,
	}

	// Initialize the action config with the namespace
	err := actionConfig.Init(
		getter,
		namespace,
		"secret",
		log.Printf,
	)
	if err != nil {
		return "", fmt.Errorf("failed to initialize Helm action config with namespace %s: %w", namespace, err)
	}

	// Create a get manifest action
	client := action.NewGet(actionConfig)

	// Set revision if specified (if revision is 0, get the latest version)
	if revision > 0 {
		client.Version = revision
	}

	// Get the release
	rel, err := client.Run(name)
	if err != nil {
		log.Printf("Error getting Helm release: %v", err)
		return "", fmt.Errorf("failed to get release %s: %w", name, err)
	}

	// Return the manifest
	return rel.Manifest, nil
}

// GetValuesSources fetches values from ConfigMaps and Secrets referenced in valuesFrom
func (c *Client) GetValuesSources(ctx context.Context, namespace string, valuesFrom []map[string]interface{}) ([]ValueSource, error) {
	log.Printf("GetValuesSources called for namespace %s with %d sources", namespace, len(valuesFrom))

	// Get kubernetes config
	config, err := c.actionConfig.RESTClientGetter.ToRESTConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get REST config: %w", err)
	}

	// Create kubernetes clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	sources := make([]ValueSource, 0, len(valuesFrom))

	for _, ref := range valuesFrom {
		kind, _ := ref["kind"].(string)
		name, _ := ref["name"].(string)
		valuesKey := "values.yaml"
		if vk, ok := ref["valuesKey"].(string); ok && vk != "" {
			valuesKey = vk
		}

		var targetPath *string
		if tp, ok := ref["targetPath"].(string); ok && tp != "" {
			targetPath = &tp
		}

		optional := false
		if opt, ok := ref["optional"].(bool); ok {
			optional = opt
		}

		source := ValueSource{
			Kind:       kind,
			Name:       name,
			ValuesKey:  valuesKey,
			TargetPath: targetPath,
			Optional:   optional,
			Exists:     false,
		}

		var data string
		var fetchErr error

		switch kind {
		case "ConfigMap":
			cm, err := clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				fetchErr = err
			} else if cm.Data != nil {
				if val, ok := cm.Data[valuesKey]; ok {
					data = val
					source.Exists = true
				} else {
					fetchErr = fmt.Errorf("key %s not found in ConfigMap", valuesKey)
				}
			} else {
				fetchErr = fmt.Errorf("ConfigMap %s has no data", name)
			}

		case "Secret":
			secret, err := clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				fetchErr = err
			} else if secret.Data != nil {
				if val, ok := secret.Data[valuesKey]; ok {
					// Secrets are already base64 encoded in secret.Data, but we want the decoded string
					data = string(val)
					source.Exists = true
				} else {
					fetchErr = fmt.Errorf("key %s not found in Secret", valuesKey)
				}
			} else {
				fetchErr = fmt.Errorf("Secret %s has no data", name)
			}

		default:
			fetchErr = fmt.Errorf("unsupported kind: %s", kind)
		}

		if fetchErr != nil {
			if !optional {
				errMsg := fetchErr.Error()
				source.Error = &errMsg
			}
			log.Printf("Error fetching %s/%s: %v (optional=%v)", kind, name, fetchErr, optional)
		} else {
			source.Data = &data
		}

		sources = append(sources, source)
	}

	return sources, nil
}

// Rollback rolls back a Helm release to a specific revision
func (c *Client) Rollback(ctx context.Context, name, namespace string, revision int) error {
	log.Printf("Rollback called for release %s in namespace %s to revision %d", name, namespace, revision)

	// Create a new action configuration for this specific request
	actionConfig := new(action.Configuration)

	// Create a client getter that uses the specified namespace
	getter := &restClientGetter{
		config:    c.actionConfig.RESTClientGetter.(*restClientGetter).config,
		namespace: namespace,
	}

	// Initialize the action config with the namespace
	err := actionConfig.Init(
		getter,
		namespace,
		"secret",
		log.Printf,
	)
	if err != nil {
		return fmt.Errorf("failed to initialize Helm action config with namespace %s: %w", namespace, err)
	}

	// Create a rollback action
	client := action.NewRollback(actionConfig)
	client.Version = revision
	client.Wait = true
	client.Timeout = 300 * time.Second // 5 minute timeout for rollback

	// Execute the rollback
	err = client.Run(name)
	if err != nil {
		log.Printf("Error rolling back Helm release: %v", err)
		return fmt.Errorf("failed to rollback release %s to revision %d: %w", name, revision, err)
	}

	log.Printf("Successfully rolled back release %s to revision %d", name, revision)
	return nil
}

// convertRelease converts a Helm release to our Release format
func convertRelease(rel *release.Release) *Release {
	var chartVersion, appVersion string
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		chartVersion = rel.Chart.Metadata.Version
		appVersion = rel.Chart.Metadata.AppVersion
	}

	var updated time.Time
	if rel.Info != nil {
		updated = rel.Info.LastDeployed.Time
	}

	var description, notes string
	if rel.Info != nil {
		description = rel.Info.Description
		notes = rel.Info.Notes
	}

	var status string
	if rel.Info != nil {
		status = rel.Info.Status.String()
	}

	var chartName string
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		chartName = rel.Chart.Metadata.Name
	}

	return &Release{
		Name:         rel.Name,
		Namespace:    rel.Namespace,
		Revision:     rel.Version,
		Updated:      updated,
		Status:       status,
		Chart:        chartName,
		ChartVersion: chartVersion,
		AppVersion:   appVersion,
		Description:  description,
		Notes:        notes,
		Values:       rel.Config,
	}
}

// restClientGetter implements genericclioptions.RESTClientGetter
type restClientGetter struct {
	config    *rest.Config
	namespace string
}

func (r *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	return r.config, nil
}

func (r *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(r.config)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(discoveryClient), nil
}

func (r *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	discoveryClient, err := r.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(discoveryClient)
	return mapper, nil
}

func (r *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return &clientcmd.DefaultClientConfig
}
