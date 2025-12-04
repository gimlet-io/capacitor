// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"

	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/labstack/echo/v4"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

// KubernetesProxy handles proxying requests to the Kubernetes API
type KubernetesProxy struct {
	k8sClient        *kubernetes.Client
	proxy            *httputil.ReverseProxy
	fluxAPIPaths     map[string]string // Cache for discovered Flux API paths (kind -> API path template)
	fluxAPIPathsMu   sync.RWMutex      // Mutex for thread-safe access to fluxAPIPaths
	fluxAPIDiscovery sync.Once         // Ensures discovery happens only once
}

// NewKubernetesProxy creates a new KubernetesProxy
func NewKubernetesProxy(k8sClient *kubernetes.Client) (*KubernetesProxy, error) {
	// Get the Kubernetes API server URL from the client config
	apiServerURL, err := url.Parse(k8sClient.Config.Host)
	if err != nil {
		return nil, fmt.Errorf("error parsing API server URL: %w", err)
	}

	// Log information about the API server we're connecting to
	log.Printf("Proxying to Kubernetes API server: %s", apiServerURL.String())
	log.Printf("Using context: %s", k8sClient.CurrentContext)

	// Create a transport with the same settings as the client
	transport, err := rest.TransportFor(k8sClient.Config)
	if err != nil {
		return nil, fmt.Errorf("error creating transport from config: %w", err)
	}

	// Create a reverse proxy to the Kubernetes API server with the custom transport
	proxy := httputil.NewSingleHostReverseProxy(apiServerURL)

	// Customize the proxy director to add authentication headers and modify paths
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)

		// Check for special query parameter to include metadata.managedFields
		// We use a custom header to communicate this intent to ModifyResponse
		// while stripping the query parameter before forwarding to the API server.
		q := req.URL.Query()
		includeManaged := strings.EqualFold(q.Get("includeManagedFields"), "true") || q.Get("includeManagedFields") == "1"
		if includeManaged {
			req.Header.Set("X-Include-Managed-Fields", "true")
			q.Del("includeManagedFields")
			req.URL.RawQuery = q.Encode()
		}

		// Copy authentication headers from the client config
		if k8sClient.Config.BearerToken != "" {
			req.Header.Set("Authorization", "Bearer "+k8sClient.Config.BearerToken)
		}

		// Set host header
		req.Host = apiServerURL.Host
	}

	// Set the custom transport with TLS config
	proxy.Transport = transport

	// Strip metadata.managedFields from JSON responses
	proxy.ModifyResponse = func(resp *http.Response) error {
		// If the original request explicitly asked to include managed fields,
		// skip stripping them from the response.
		if resp != nil && resp.Request != nil {
			if val := resp.Request.Header.Get("X-Include-Managed-Fields"); strings.EqualFold(val, "true") {
				return nil
			}
		}

		// Skip if this is a watch stream; we don't buffer streaming responses here
		if resp != nil && resp.Request != nil {
			q := resp.Request.URL.Query().Get("watch")
			if strings.EqualFold(q, "true") || q == "1" {
				return nil
			}
		}

		// Skip compressed or non-JSON responses
		if enc := resp.Header.Get("Content-Encoding"); enc != "" && enc != "identity" {
			return nil
		}
		ct := resp.Header.Get("Content-Type")
		if !strings.Contains(ct, "json") {
			return nil
		}

		// Read, filter, and replace body
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		_ = resp.Body.Close()

		filtered := stripManagedFieldsFromBytes(body)

		resp.Body = io.NopCloser(bytes.NewReader(filtered))
		resp.ContentLength = int64(len(filtered))
		resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(filtered)))
		return nil
	}

	// Customize error handling
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("Error proxying request to Kubernetes API: %v", err)
		w.WriteHeader(http.StatusBadGateway)
		io.WriteString(w, fmt.Sprintf("Error proxying request to Kubernetes API: %v", err))
	}

	return &KubernetesProxy{
		k8sClient:    k8sClient,
		proxy:        proxy,
		fluxAPIPaths: make(map[string]string),
	}, nil
}

// HandleAPIRequest handles a Kubernetes API request
func (p *KubernetesProxy) HandleAPIRequest(c echo.Context) error {
	// Echo's wildcard param (*) captures everything after /k8s/:context/
	// This is the Kubernetes API path we want to proxy
	apiPath := c.Param("*")

	// Prepend slash to make it an absolute path
	path := "/" + apiPath

	// Update the request path
	c.Request().URL.Path = path

	// Log the proxied request (optional, might want to disable for production)
	log.Printf("Proxying request: %s %s", c.Request().Method, path)

	// Proxy the request
	p.proxy.ServeHTTP(c.Response().Writer, c.Request())

	return nil
}

// stripManagedFieldsFromBytes removes metadata.managedFields fields from any JSON structure.
// On error, it returns the original input.
func stripManagedFieldsFromBytes(in []byte) []byte {
	if len(in) == 0 {
		return in
	}
	var v interface{}
	if err := json.Unmarshal(in, &v); err != nil {
		return in
	}
	removeManagedFieldsFromAny(&v)
	b, err := json.Marshal(v)
	if err != nil {
		return in
	}
	return b
}

// removeManagedFieldsFromAny walks arbitrarily nested maps/slices and deletes metadata.managedFields.
func removeManagedFieldsFromAny(v *interface{}) {
	switch t := (*v).(type) {
	case map[string]interface{}:
		if meta, ok := t["metadata"].(map[string]interface{}); ok {
			delete(meta, "managedFields")
		}
		for k, child := range t {
			// Recurse into children
			c := interface{}(child)
			removeManagedFieldsFromAny(&c)
			t[k] = c
		}
	case []interface{}:
		for i, child := range t {
			c := interface{}(child)
			removeManagedFieldsFromAny(&c)
			t[i] = c
		}
	default:
		// primitives: nothing to do
	}
}

// discoverFluxAPIPaths discovers Flux API paths using Kubernetes discovery client
// Returns a map of resource kind to API path template (e.g., "Kustomization" -> "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/%s/kustomizations/%s")
// Uses sync.Once to ensure discovery happens only once per proxy instance
func (p *KubernetesProxy) discoverFluxAPIPaths() (map[string]string, error) {
	var discoveryErr error

	// Use sync.Once to ensure discovery happens only once
	p.fluxAPIDiscovery.Do(func() {
		// Create discovery client
		discoveryClient, err := discovery.NewDiscoveryClientForConfig(p.k8sClient.Config)
		if err != nil {
			discoveryErr = fmt.Errorf("failed to create discovery client: %w", err)
			return
		}

		// Get API groups
		apiGroups, err := discoveryClient.ServerGroups()
		if err != nil {
			discoveryErr = fmt.Errorf("failed to get API groups: %w", err)
			return
		}

		// Map of Flux API group prefixes to their resource kinds
		fluxGroupKinds := map[string][]string{
			"kustomize.toolkit.fluxcd.io":    {"Kustomization"},
			"helm.toolkit.fluxcd.io":         {"HelmRelease"},
			"source.toolkit.fluxcd.io":       {"GitRepository", "HelmRepository", "HelmChart", "OCIRepository", "Bucket"},
			"notification.toolkit.fluxcd.io": {"Alert", "Provider", "Receiver"},
			"image.toolkit.fluxcd.io":        {"ImagePolicy", "ImageRepository", "ImageUpdate"},
			"infra.contrib.fluxcd.io":        {"Terraform"},
		}

		// Map of resource kind to plural form
		kindToPlural := map[string]string{
			"Kustomization":   "kustomizations",
			"HelmRelease":     "helmreleases",
			"GitRepository":   "gitrepositories",
			"HelmRepository":  "helmrepositories",
			"HelmChart":       "helmcharts",
			"OCIRepository":   "ocirepositories",
			"Bucket":          "buckets",
			"Alert":           "alerts",
			"Provider":        "providers",
			"Receiver":        "receivers",
			"ImagePolicy":     "imagepolicies",
			"ImageRepository": "imagerepositories",
			"ImageUpdate":     "imageupdateautomations",
			"Terraform":       "terraforms",
		}

		discoveredPaths := make(map[string]string)

		// Iterate through API groups to find Flux groups
		for _, group := range apiGroups.Groups {
			for groupPrefix, kinds := range fluxGroupKinds {
				if strings.Contains(group.Name, groupPrefix) {
					// Find the preferred version
					preferredVersion := group.PreferredVersion.Version
					if preferredVersion == "" && len(group.Versions) > 0 {
						preferredVersion = group.Versions[0].Version
					}

					// Get resources for this group version
					groupVersion := fmt.Sprintf("%s/%s", group.Name, preferredVersion)
					resources, err := discoveryClient.ServerResourcesForGroupVersion(groupVersion)
					if err != nil {
						log.Printf("Warning: failed to get resources for %s: %v", groupVersion, err)
						continue
					}

					// Map each kind to its API path
					for _, kind := range kinds {
						plural, ok := kindToPlural[kind]
						if !ok {
							log.Printf("Warning: no plural form found for kind %s", kind)
							continue
						}

						// Check if this resource exists in the discovered resources
						found := false
						for _, resource := range resources.APIResources {
							if resource.Name == plural {
								found = true
								break
							}
						}

						if found {
							// Build API path template: /apis/{group}/{version}/namespaces/{namespace}/{plural}/{name}
							apiPath := fmt.Sprintf("/apis/%s/%s/namespaces/%%s/%s/%%s", group.Name, preferredVersion, plural)
							discoveredPaths[kind] = apiPath
						}
					}
				}
			}
		}

		// Cache the results
		p.fluxAPIPathsMu.Lock()
		p.fluxAPIPaths = discoveredPaths
		p.fluxAPIPathsMu.Unlock()
	})

	// Return error if discovery failed
	if discoveryErr != nil {
		return nil, discoveryErr
	}

	// Return cached results (thread-safe read)
	p.fluxAPIPathsMu.RLock()
	defer p.fluxAPIPathsMu.RUnlock()

	// Return a copy to prevent external modification
	result := make(map[string]string, len(p.fluxAPIPaths))
	for k, v := range p.fluxAPIPaths {
		result[k] = v
	}
	return result, nil
}

// getFluxAPIPath returns the API path for a Flux resource kind, discovering it if necessary
func (p *KubernetesProxy) getFluxAPIPath(ctx context.Context, kind string) (string, error) {
	paths, err := p.discoverFluxAPIPaths()
	if err != nil {
		return "", err
	}

	apiPath, found := paths[kind]
	if !found {
		return "", fmt.Errorf("flux resource kind %s not found in discovered API paths", kind)
	}

	return apiPath, nil
}
