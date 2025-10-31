// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/labstack/echo/v4"
	"k8s.io/client-go/rest"
)

// KubernetesProxy handles proxying requests to the Kubernetes API
type KubernetesProxy struct {
	k8sClient *kubernetes.Client
	proxy     *httputil.ReverseProxy
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
		k8sClient: k8sClient,
		proxy:     proxy,
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
