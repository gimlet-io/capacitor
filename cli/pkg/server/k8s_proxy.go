package server

import (
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
	// Get path from request
	path := c.Request().URL.Path

	// Strip /k8s prefix if present
	if strings.HasPrefix(path, "/k8s") {
		path = strings.TrimPrefix(path, "/k8s")
	}

	// Update the path
	c.Request().URL.Path = path

	// Log the proxied request (optional, might want to disable for production)
	log.Printf("Proxying request: %s %s", c.Request().Method, path)

	// Proxy the request
	p.proxy.ServeHTTP(c.Response().Writer, c.Request())

	return nil
}
