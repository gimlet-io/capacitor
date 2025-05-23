package helm

import (
	"context"
	"fmt"
	"log"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
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
	log.Printf("ListReleases called with namespace=%v", namespace)

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

	log.Printf("Helm list client configured: All=%v, AllNamespaces=%v, Namespace=%s",
		client.All, client.AllNamespaces, namespace)

	// Execute the list action
	releases, err := client.Run()
	if err != nil {
		log.Printf("Error listing Helm releases: %v", err)
		return nil, fmt.Errorf("failed to list Helm releases: %w", err)
	}

	log.Printf("Found %d Helm releases", len(releases))
	for i, rel := range releases {
		log.Printf("Release %d: name=%s, namespace=%s, status=%s", i, rel.Name, rel.Namespace, rel.Info.Status.String())
	}

	// Convert to our Release format
	result := make([]*Release, 0, len(releases))
	for _, rel := range releases {
		helmRelease := convertRelease(rel)
		result = append(result, helmRelease)
	}

	log.Printf("Returning %d converted releases", len(result))
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
