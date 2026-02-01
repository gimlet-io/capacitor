// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package kubernetes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"k8s.io/client-go/rest"
)

// WatchEvent represents a Kubernetes watch event
type WatchEvent struct {
	Type   string          `json:"type"`
	Object json.RawMessage `json:"object"`
}

// ResourceWatcher handles watching Kubernetes resources
type ResourceWatcher struct {
	client     *Client
	httpClient *http.Client
}

// NewResourceWatcher creates a new ResourceWatcher
func NewResourceWatcher(client *Client) *ResourceWatcher {
	// Use the transport from the client config to ensure consistent TLS behavior
	transportConfig, err := rest.TransportFor(client.Config)
	var httpClient *http.Client
	if err != nil {
		// Fall back to a standard HTTP client if transport can't be created
		httpClient = &http.Client{}
	} else {
		// Use the transport from the client's config
		httpClient = &http.Client{
			Transport: transportConfig,
		}
	}

	return &ResourceWatcher{
		client:     client,
		httpClient: httpClient,
	}
}

// WatchResource watches a Kubernetes resource at the given path
// and sends events to the provided channel
func (w *ResourceWatcher) WatchResource(ctx context.Context, path string, eventsChan chan<- *WatchEvent) error {
	// Create request
	req, err := w.createWatchRequest(path)
	if err != nil {
		return fmt.Errorf("error creating watch request: %w", err)
	}

	// Add context to request
	req = req.WithContext(ctx)

	// Execute request
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("error executing watch request for path %s: %w", path, err)
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("watch request failed for path %s with status %d: %s", path, resp.StatusCode, string(body))
	}

	// Process the response stream
	return w.processWatchEvents(resp.Body, eventsChan)
}

// createWatchRequest creates an HTTP request for watching a Kubernetes resource
func (w *ResourceWatcher) createWatchRequest(path string) (*http.Request, error) {
	// Normalize the path - strip /k8s prefix if present
	if after, ok := strings.CutPrefix(path, "/k8s"); ok {
		path = after
	}

	// Ensure path has leading slash
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	// Add watch=true query parameter if not already present
	if !strings.Contains(path, "watch=true") {
		if strings.Contains(path, "?") {
			path = path + "&watch=true"
		} else {
			path = path + "?watch=true"
		}
	}

	// Combine the base URL with the path
	fullURL := w.client.Config.Host + path
	log.Printf("Watch request: context=%s url=%s", w.client.CurrentContext, fullURL)

	// Create request
	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating request for path %s: %w", path, err)
	}

	// Set up authentication
	w.setupAuth(req)

	return req, nil
}

// setupAuth adds authentication information to the request
func (w *ResourceWatcher) setupAuth(req *http.Request) {
	// Add token if present
	if w.client.Config.BearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+w.client.Config.BearerToken)
	}

	// If bearer token auth is not set, try to use certificate authentication
	if len(w.client.Config.TLSClientConfig.CertData) > 0 {
		// TLS certificate authentication is handled by the transport
		// No need to set headers here, just ensuring the transport is set
		// correctly in the client config
	}
}

// processWatchEvents reads the watch event stream and sends events to the channel
func (w *ResourceWatcher) processWatchEvents(reader io.Reader, eventsChan chan<- *WatchEvent) error {
	decoder := json.NewDecoder(reader)
	for {
		event := &WatchEvent{}
		if err := decoder.Decode(event); err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("error decoding watch event: %w", err)
		}

		// Send event to channel
		eventsChan <- event
	}
}

// WatchPath is a helper function that creates a ResourceWatcher and starts watching
func (c *Client) WatchPath(ctx context.Context, path string, eventsChan chan<- *WatchEvent) error {
	watcher := NewResourceWatcher(c)
	return watcher.WatchResource(ctx, path, eventsChan)
}

// RESTClient returns a rest.Interface for making raw API calls
func (c *Client) RESTClient() (*rest.RESTClient, error) {
	return rest.RESTClientFor(c.Config)
}
