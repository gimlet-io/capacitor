package server

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gimlet-io/capacitor/pkg/config"
	"github.com/gimlet-io/capacitor/pkg/helm"
	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/kubectl/pkg/describe"
	"k8s.io/kubectl/pkg/scheme"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/transport/spdy"

	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	runclient "github.com/fluxcd/pkg/runtime/client"

	// Import the FluxCD packages
	"github.com/gimlet-io/capacitor/pkg/flux/build"
	"github.com/gimlet-io/capacitor/pkg/flux/utils"
)

// Server represents the API server
type Server struct {
	echo         *echo.Echo
	config       *config.Config
	k8sProxies   map[string]*KubernetesProxy
	k8sProxiesMu sync.RWMutex
	embedFS      fs.FS // embedded file system for static files
	version      string
}

// proxyContextKey is the type used to store the KubernetesProxy in the request context
type proxyContextKey struct{}

var proxyCtxKey = &proxyContextKey{}

// Removed per-route withK8sProxy wrapper; using global middleware to attach proxies

// getProxyFromContext fetches the KubernetesProxy previously attached by middleware
func getProxyFromContext(c echo.Context) (*KubernetesProxy, bool) {
	v := c.Request().Context().Value(proxyCtxKey)
	if v == nil {
		return nil, false
	}
	proxy, ok := v.(*KubernetesProxy)
	return proxy, ok
}

// New creates a new server instance
func New(cfg *config.Config, k8sClient *kubernetes.Client, version string) (*Server, error) {
	// Create the echo instance
	e := echo.New()

	// Initialize proxy cache and seed with current context
	proxyCache := make(map[string]*KubernetesProxy)
	initialProxy, err := NewKubernetesProxy(k8sClient)
	if err != nil {
		return nil, fmt.Errorf("error creating kubernetes proxy: %w", err)
	}
	proxyCache[k8sClient.CurrentContext] = initialProxy

	return &Server{
		echo:       e,
		config:     cfg,
		k8sProxies: proxyCache,
		version:    version,
	}, nil
}

// Setup configures and sets up the server routes
func (s *Server) Setup() {
	// Add middleware
	s.echo.Use(middleware.Logger())
	s.echo.Use(middleware.Recover())
	s.echo.Use(middleware.CORS())

	// Attach Kubernetes proxy automatically for any route that includes a :context param
	// This ensures handlers under /api/:context/... have access to the proxy without
	// explicitly wrapping every route with withK8sProxy().
	s.echo.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctxName := c.Param("context")
			if strings.TrimSpace(ctxName) != "" {
				proxy, err := s.getOrCreateK8sProxyForContext(ctxName)
				if err != nil {
					status := http.StatusInternalServerError
					if strings.Contains(strings.ToLower(err.Error()), "not found") {
						status = http.StatusBadRequest
					}
					return c.JSON(status, map[string]string{
						"error": fmt.Sprintf("failed to get proxy for context '%s': %v", ctxName, err),
					})
				}

				req := c.Request()
				ctx := context.WithValue(req.Context(), proxyCtxKey, proxy)
				c.SetRequest(req.WithContext(ctx))
			}
			return next(c)
		}
	})

	// Serve embedded static files if available
	if s.embedFS != nil {
		// Try to use the embedded file system
		fsys, err := fs.Sub(s.embedFS, "public")
		if err == nil {
			assetHandler := http.FileServer(http.FS(fsys))
			s.echo.GET("/*", echo.WrapHandler(assetHandler))
			s.echo.GET("/", echo.WrapHandler(assetHandler))
		} else {
			s.echo.Logger.Warn("Failed to create sub-filesystem from embedded files:", err)
		}
	} else if s.config.StaticFilesDirectory != "" {
		// Fall back to directory on the filesystem
		s.echo.Static("/", s.config.StaticFilesDirectory)
	}

	// WebSocket endpoint with context
	s.echo.GET("/ws/:context", func(c echo.Context) error {
		ctxName := c.Param("context")
		if strings.TrimSpace(ctxName) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "context parameter is required",
			})
		}

		proxy, err := s.getOrCreateK8sProxyForContext(ctxName)
		if err != nil {
			status := http.StatusInternalServerError
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusBadRequest
			}
			return c.JSON(status, map[string]string{
				"error": fmt.Sprintf("failed to get proxy for context '%s': %v", ctxName, err),
			})
		}

		hc, err := helm.NewClient(proxy.k8sClient.Config, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to create helm client: %v", err),
			})
		}

		// Create a per-connection handler so it uses the context-specific clients
		h := NewWebSocketHandler(proxy.k8sClient, hc)
		return h.HandleWebSocket(c)
	})

	// Version endpoint
	s.echo.GET("/api/version", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{
			"version": s.version,
		})
	})

	// App configuration endpoint (exposes UI options like theme)
	s.echo.GET("/api/config", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"theme": s.config.Theme,
		})
	})

	// Add endpoint for getting kubeconfig contexts
	s.echo.GET("/api/contexts", func(c echo.Context) error {
		tmpClient, err := kubernetes.NewClient(s.config.KubeConfigPath, s.config.InsecureSkipTLSVerify)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to create kubernetes client: %v", err),
			})
		}
		contexts := tmpClient.GetContexts()
		return c.JSON(http.StatusOK, map[string]interface{}{
			"contexts": contexts,
			"current":  tmpClient.CurrentContext,
		})
	})

	// Add endpoint for reconciling Flux resources (context-aware)
	s.echo.POST("/api/:context/flux/reconcile", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		var req struct {
			Kind        string `json:"kind"`
			Name        string `json:"name"`
			Namespace   string `json:"namespace"`
			WithSources bool   `json:"withSources,omitempty"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Verify required fields
		if req.Kind == "" || req.Name == "" || req.Namespace == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Kind, name, and namespace are required fields",
			})
		}

		// Get the Kubernetes client
		clientset := proxy.k8sClient.Clientset

		// Create a context
		ctx := context.Background()

		// Generate the resource name and namespace
		resourceName := req.Name
		resourceNamespace := req.Namespace

		// Request immediate reconciliation by adding/updating the reconcile annotation
		// This is what the Flux CLI does behind the scenes
		var patchData string

		// Format the current time in RFC3339Nano format
		currentTime := metav1.Now().Format(time.RFC3339Nano)

		patchData = fmt.Sprintf(`{"metadata":{"annotations":{"reconcile.fluxcd.io/requestedAt":"%s"}}}`, currentTime)

		var output string

		// Normalize kind to lowercase for case-insensitive comparison
		kind := req.Kind

		// Map of supported Flux resource kinds to their API path
		resourceAPIs := map[string]string{
			"Kustomization":   "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/%s/kustomizations/%s",
			"HelmRelease":     "/apis/helm.toolkit.fluxcd.io/v2beta1/namespaces/%s/helmreleases/%s",
			"GitRepository":   "/apis/source.toolkit.fluxcd.io/v1/namespaces/%s/gitrepositories/%s",
			"HelmRepository":  "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/helmrepositories/%s",
			"HelmChart":       "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/helmcharts/%s",
			"OCIRepository":   "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/ocirepositories/%s",
			"Bucket":          "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/buckets/%s",
			"Alert":           "/apis/notification.toolkit.fluxcd.io/v1beta2/namespaces/%s/alerts/%s",
			"Provider":        "/apis/notification.toolkit.fluxcd.io/v1beta2/namespaces/%s/providers/%s",
			"Receiver":        "/apis/notification.toolkit.fluxcd.io/v1beta2/namespaces/%s/receivers/%s",
			"ImagePolicy":     "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imagepolicies/%s",
			"ImageRepository": "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imagerepositories/%s",
			"ImageUpdate":     "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imageupdateautomations/%s",
			"Terraform":       "/apis/infra.contrib.fluxcd.io/v1alpha2/namespaces/%s/terraforms/%s",
		}

		// Direct lookup with the exact kind name
		apiPath, found := resourceAPIs[kind]
		if !found {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":          fmt.Sprintf("Unsupported Flux resource kind: %s", req.Kind),
				"supportedKinds": "Supported kinds: Kustomization, HelmRelease, GitRepository, HelmRepository, etc.",
			})
		}

		// Patch the resource to trigger reconciliation
		_, err := clientset.
			RESTClient().
			Patch(types.MergePatchType).
			AbsPath(fmt.Sprintf(apiPath, resourceNamespace, resourceName)).
			Body([]byte(patchData)).
			DoRaw(ctx)

		// err would have been handled earlier; keep block removed to avoid redundant check

		// If WithSources is true, we need to find and patch the source reference
		if req.WithSources && (kind == "Kustomization" || kind == "HelmRelease" || kind == "Terraform") {
			// Get the resource to find its sourceRef
			resourceData, err := clientset.
				RESTClient().
				Get().
				AbsPath(fmt.Sprintf(apiPath, resourceNamespace, resourceName)).
				DoRaw(ctx)
			if err != nil {
				log.Printf("Error getting resource for source reconciliation: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to get resource for source reconciliation: %v", err),
				})
			}

			// Parse the resource to extract sourceRef
			var resourceObj map[string]interface{}
			if err := json.Unmarshal(resourceData, &resourceObj); err != nil {
				log.Printf("Error parsing resource data: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to parse resource data: %v", err),
				})
			}

			// Extract sourceRef from the spec
			spec, ok := resourceObj["spec"].(map[string]interface{})
			if !ok {
				log.Printf("Resource does not have a spec field")
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Resource does not have a spec field",
				})
			}

			sourceRef, ok := spec["sourceRef"].(map[string]interface{})
			if !ok {
				log.Printf("Resource does not have a sourceRef field")
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Resource does not have a sourceRef field",
				})
			}

			// Extract sourceRef details
			sourceKind, ok := sourceRef["kind"].(string)
			if !ok {
				log.Printf("SourceRef does not have a kind field")
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "SourceRef does not have a kind field",
				})
			}

			sourceName, ok := sourceRef["name"].(string)
			if !ok {
				log.Printf("SourceRef does not have a name field")
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "SourceRef does not have a name field",
				})
			}

			// Get sourceRef namespace (default to resource namespace if not specified)
			sourceNamespace := resourceNamespace
			if sourceRefNamespace, ok := sourceRef["namespace"].(string); ok && sourceRefNamespace != "" {
				sourceNamespace = sourceRefNamespace
			}

			// Get the API path for the source kind
			sourceAPIPath, found := resourceAPIs[sourceKind]
			if !found {
				log.Printf("Unsupported source kind: %s", sourceKind)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Unsupported source kind: %s", sourceKind),
				})
			}

			// Create patch data for the source
			sourcePatchData := fmt.Sprintf(`{"metadata":{"annotations":{"reconcile.fluxcd.io/requestedAt":"%s"}}}`, currentTime)

			// Patch the source resource
			_, err = clientset.
				RESTClient().
				Patch(types.MergePatchType).
				AbsPath(fmt.Sprintf(sourceAPIPath, sourceNamespace, sourceName)).
				Body([]byte(sourcePatchData)).
				DoRaw(ctx)

			if err != nil {
				log.Printf("Error reconciling source resource: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to reconcile source resource: %v", err),
				})
			}

			output = fmt.Sprintf("%s %s/%s reconciliation requested with source %s %s/%s",
				kind, resourceNamespace, resourceName,
				sourceKind, sourceNamespace, sourceName)
		} else {
			output = fmt.Sprintf("%s %s/%s reconciliation requested", kind, resourceNamespace, resourceName)
		}

		if err != nil {
			log.Printf("Error reconciling Flux resource: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error":     fmt.Sprintf("Failed to reconcile resource: %v", err),
				"kind":      kind,
				"name":      resourceName,
				"namespace": resourceNamespace,
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Successfully reconciled %s/%s", kind, resourceName),
			"output":  output,
		})
	})

	// Add endpoint for suspending Flux resources (context-aware)
	s.echo.POST("/api/:context/flux/suspend", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		var req struct {
			Kind      string `json:"kind"`
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
			Suspend   bool   `json:"suspend"` // true to suspend, false to resume
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Verify required fields
		if req.Kind == "" || req.Name == "" || req.Namespace == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Kind, name, and namespace are required fields",
			})
		}

		// Get the Kubernetes client
		clientset := proxy.k8sClient.Clientset

		// Create a context
		ctx := context.Background()

		// Set the suspend field via patch operation
		suspendValue := "true"
		if !req.Suspend {
			suspendValue = "false"
		}

		patchData := fmt.Sprintf(`{"spec":{"suspend":%s}}`, suspendValue)

		var output string

		// Normalize kind to lowercase for case-insensitive comparison
		kind := req.Kind

		// Map of supported Flux resource kinds to their API path
		resourceAPIs := map[string]string{
			"Kustomization":   "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/%s/kustomizations/%s",
			"HelmRelease":     "/apis/helm.toolkit.fluxcd.io/v2beta1/namespaces/%s/helmreleases/%s",
			"GitRepository":   "/apis/source.toolkit.fluxcd.io/v1/namespaces/%s/gitrepositories/%s",
			"HelmRepository":  "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/helmrepositories/%s",
			"HelmChart":       "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/helmcharts/%s",
			"OCIRepository":   "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/ocirepositories/%s",
			"Bucket":          "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/buckets/%s",
			"ImagePolicy":     "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imagepolicies/%s",
			"ImageRepository": "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imagerepositories/%s",
			"ImageUpdate":     "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imageupdateautomations/%s",
			"Terraform":       "/apis/infra.contrib.fluxcd.io/v1alpha2/namespaces/%s/terraforms/%s",
		}

		// Direct lookup with the exact kind name
		apiPath, found := resourceAPIs[kind]
		if !found {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":          fmt.Sprintf("Unsupported Flux resource kind: %s", req.Kind),
				"supportedKinds": "Supported kinds: Kustomization, HelmRelease, GitRepository, HelmRepository, etc.",
			})
		}

		// Patch the resource to suspend or resume it
		_, err := clientset.
			RESTClient().
			Patch(types.MergePatchType).
			AbsPath(fmt.Sprintf(apiPath, req.Namespace, req.Name)).
			Body([]byte(patchData)).
			DoRaw(ctx)

		if req.Suspend {
			output = fmt.Sprintf("%s %s/%s suspended", kind, req.Namespace, req.Name)
		} else {
			output = fmt.Sprintf("%s %s/%s resumed", kind, req.Namespace, req.Name)
		}

		if err != nil {
			log.Printf("Error suspending/resuming Flux resource: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error":     fmt.Sprintf("Failed to suspend/resume resource: %v", err),
				"kind":      kind,
				"name":      req.Name,
				"namespace": req.Namespace,
			})
		}

		actionType := "suspended"
		if !req.Suspend {
			actionType = "resumed"
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Successfully %s %s/%s", actionType, kind, req.Name),
			"output":  output,
		})
	})

	// Add endpoint for approving Terraform plans (Flux Tofu Controller) (context-aware)
	s.echo.POST("/api/:context/flux/approve", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		var req struct {
			Kind      string `json:"kind"`
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Verify required fields
		if req.Kind == "" || req.Name == "" || req.Namespace == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Kind, name, and namespace are required fields",
			})
		}

		// Only Terraform supports approve flow
		if req.Kind != "Terraform" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("Unsupported kind for approve: %s. Only Terraform is supported", req.Kind),
			})
		}

		clientset := proxy.k8sClient.Clientset
		ctx := context.Background()

		// API paths for supported kinds
		resourceAPIs := map[string]string{
			"Terraform": "/apis/infra.contrib.fluxcd.io/v1alpha2/namespaces/%s/terraforms/%s",
		}

		apiPath, found := resourceAPIs[req.Kind]
		if !found {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("Unsupported Flux resource kind: %s", req.Kind),
			})
		}

		// Read current resource to get pending plan identifier
		resourceData, err := clientset.
			RESTClient().
			Get().
			AbsPath(fmt.Sprintf(apiPath, req.Namespace, req.Name)).
			DoRaw(ctx)
		if err != nil {
			log.Printf("Error getting Terraform resource for approve: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Terraform resource: %v", err),
			})
		}

		var resourceObj map[string]interface{}
		if err := json.Unmarshal(resourceData, &resourceObj); err != nil {
			log.Printf("Error parsing Terraform resource: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to parse Terraform resource: %v", err),
			})
		}

		pendingPlan := ""
		if status, ok := resourceObj["status"].(map[string]interface{}); ok {
			if plan, ok := status["plan"].(map[string]interface{}); ok {
				if p, ok := plan["pending"].(string); ok {
					pendingPlan = p
				}
			}
		}

		if strings.TrimSpace(pendingPlan) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "No pending plan to approve",
			})
		}

		// Patch spec.approvePlan with the pending plan identifier
		patchData := fmt.Sprintf(`{"spec":{"approvePlan":"%s"}}`, pendingPlan)

		_, err = clientset.
			RESTClient().
			Patch(types.MergePatchType).
			AbsPath(fmt.Sprintf(apiPath, req.Namespace, req.Name)).
			Body([]byte(patchData)).
			DoRaw(ctx)
		if err != nil {
			log.Printf("Error approving Terraform plan: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to approve plan: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Successfully approved plan for Terraform %s/%s", req.Namespace, req.Name),
		})
	})

	// Add endpoint for diffing Flux Kustomization resources (context-aware)
	s.echo.POST("/api/:context/flux/diff", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		var req struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Verify required fields
		if req.Name == "" || req.Namespace == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Name, and namespace are required fields",
			})
		}

		clientset := proxy.k8sClient.Clientset
		ctx := context.Background()

		// Get the Kustomization resource
		kustomizationPath := fmt.Sprintf("/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/%s/kustomizations/%s", req.Namespace, req.Name)
		kustomizationData, err := clientset.
			RESTClient().
			Get().
			AbsPath(kustomizationPath).
			DoRaw(ctx)
		if err != nil {
			log.Printf("Error getting Kustomization resource: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Kustomization resource: %v", err),
			})
		}

		// Parse the Kustomization resource
		var kustomization kustomizev1.Kustomization
		if err := json.Unmarshal(kustomizationData, &kustomization); err != nil {
			log.Printf("Error parsing Kustomization resource: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to parse Kustomization resource: %v", err),
			})
		}

		fluxDiffResult, err := s.generateKustomizationDiffWithFluxStyle(ctx, proxy.k8sClient, &kustomization)
		if err != nil {
			log.Printf("Error generating FluxCD-style diff: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to generate FluxCD-style diff: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"fluxResult": fluxDiffResult,
		})

	})

	// Add endpoint for scaling Kubernetes resources (context-aware)
	s.echo.POST("/api/:context/scale", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		var req struct {
			Kind      string `json:"kind"`
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
			Replicas  int32  `json:"replicas"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Verify required fields
		if req.Kind == "" || req.Name == "" || req.Namespace == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Kind, name, and namespace are required fields",
			})
		}

		// Create a context
		ctx := context.Background()

		var output string

		// Normalize kind to lowercase for case-insensitive comparison
		kind := req.Kind

		// Get the Kubernetes client
		clientset := proxy.k8sClient.Clientset

		switch strings.ToLower(kind) {
		case "deployment", "deployments":
			// Scale deployment
			scale, err := clientset.
				AppsV1().
				Deployments(req.Namespace).
				GetScale(ctx, req.Name, metav1.GetOptions{})
			if err != nil {
				log.Printf("Error getting deployment scale: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to get deployment scale: %v", err),
				})
			}

			// Update replicas
			scale.Spec.Replicas = req.Replicas
			_, err = clientset.
				AppsV1().
				Deployments(req.Namespace).
				UpdateScale(ctx, req.Name, scale, metav1.UpdateOptions{})
			if err != nil {
				log.Printf("Error scaling deployment: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to scale deployment: %v", err),
				})
			}

			output = fmt.Sprintf("Deployment %s/%s scaled to %d replicas", req.Namespace, req.Name, req.Replicas)

		case "statefulset", "statefulsets":
			// Scale statefulset
			scale, err := clientset.
				AppsV1().
				StatefulSets(req.Namespace).
				GetScale(ctx, req.Name, metav1.GetOptions{})
			if err != nil {
				log.Printf("Error getting statefulset scale: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to get statefulset scale: %v", err),
				})
			}

			// Update replicas
			scale.Spec.Replicas = req.Replicas
			_, err = clientset.
				AppsV1().
				StatefulSets(req.Namespace).
				UpdateScale(ctx, req.Name, scale, metav1.UpdateOptions{})
			if err != nil {
				log.Printf("Error scaling statefulset: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to scale statefulset: %v", err),
				})
			}

			output = fmt.Sprintf("StatefulSet %s/%s scaled to %d replicas", req.Namespace, req.Name, req.Replicas)

		default:
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("Unsupported resource kind for scaling: %s. Only Deployment and StatefulSet are supported", req.Kind),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Successfully scaled %s/%s to %d replicas", kind, req.Name, req.Replicas),
			"output":  output,
		})
	})

	// Add endpoint for rollout restart of Kubernetes resources (context-aware)
	s.echo.POST("/api/:context/rollout-restart", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		var req struct {
			Kind      string `json:"kind"`
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Verify required fields
		if req.Kind == "" || req.Name == "" || req.Namespace == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Kind, name, and namespace are required fields",
			})
		}

		// Create a context
		ctx := context.Background()

		var output string

		// Normalize kind to lowercase for case-insensitive comparison
		kind := req.Kind

		// Get the Kubernetes client
		clientset := proxy.k8sClient.Clientset

		switch strings.ToLower(kind) {
		case "deployment", "deployments":
			// Restart deployment rollout by patching the pod template with a restart annotation
			deployment, err := clientset.
				AppsV1().
				Deployments(req.Namespace).
				Get(ctx, req.Name, metav1.GetOptions{})
			if err != nil {
				log.Printf("Error getting deployment: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to get deployment: %v", err),
				})
			}

			// Add or update the restart annotation
			if deployment.Spec.Template.Annotations == nil {
				deployment.Spec.Template.Annotations = make(map[string]string)
			}
			deployment.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)

			_, err = clientset.
				AppsV1().
				Deployments(req.Namespace).
				Update(ctx, deployment, metav1.UpdateOptions{})
			if err != nil {
				log.Printf("Error restarting deployment rollout: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to restart deployment rollout: %v", err),
				})
			}

			output = fmt.Sprintf("Deployment %s/%s rollout restarted", req.Namespace, req.Name)

		case "statefulset", "statefulsets":
			// Restart statefulset rollout by patching the pod template with a restart annotation
			statefulset, err := clientset.
				AppsV1().
				StatefulSets(req.Namespace).
				Get(ctx, req.Name, metav1.GetOptions{})
			if err != nil {
				log.Printf("Error getting statefulset: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to get statefulset: %v", err),
				})
			}

			// Add or update the restart annotation
			if statefulset.Spec.Template.Annotations == nil {
				statefulset.Spec.Template.Annotations = make(map[string]string)
			}
			statefulset.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)

			_, err = clientset.
				AppsV1().
				StatefulSets(req.Namespace).
				Update(ctx, statefulset, metav1.UpdateOptions{})
			if err != nil {
				log.Printf("Error restarting statefulset rollout: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to restart statefulset rollout: %v", err),
				})
			}

			output = fmt.Sprintf("StatefulSet %s/%s rollout restarted", req.Namespace, req.Name)

		case "daemonset", "daemonsets":
			// Restart daemonset rollout by patching the pod template with a restart annotation
			daemonset, err := clientset.
				AppsV1().
				DaemonSets(req.Namespace).
				Get(ctx, req.Name, metav1.GetOptions{})
			if err != nil {
				log.Printf("Error getting daemonset: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to get daemonset: %v", err),
				})
			}

			// Add or update the restart annotation
			if daemonset.Spec.Template.Annotations == nil {
				daemonset.Spec.Template.Annotations = make(map[string]string)
			}
			daemonset.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)

			_, err = clientset.
				AppsV1().
				DaemonSets(req.Namespace).
				Update(ctx, daemonset, metav1.UpdateOptions{})
			if err != nil {
				log.Printf("Error restarting daemonset rollout: %v", err)
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": fmt.Sprintf("Failed to restart daemonset rollout: %v", err),
				})
			}

			output = fmt.Sprintf("DaemonSet %s/%s rollout restarted", req.Namespace, req.Name)

		default:
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("Unsupported resource kind for rollout restart: %s. Only Deployment, StatefulSet, and DaemonSet are supported", req.Kind),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Successfully restarted rollout for %s/%s", kind, req.Name),
			"output":  output,
		})
	})

	// Add endpoint for describing Kubernetes resources using kubectl describe (context-aware)
	s.echo.GET("/api/:context/describe/:namespace/:kind/:name", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		namespace := c.Param("namespace")
		kind := c.Param("kind")
		name := c.Param("name")
		apiVersion := c.QueryParam("apiVersion")

		log.Printf("Describing resource: %s/%s in namespace %s with apiVersion '%s'", kind, name, namespace, apiVersion)

		output, err := s.describeResourceWithKubectl(proxy.k8sClient, namespace, kind, name, apiVersion)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to describe resource: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"output": output,
		})
	})

	// Add endpoint for Helm release history (context-aware)
	s.echo.GET("/api/:context/helm/history/:namespace/:name", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		namespace := c.Param("namespace")
		name := c.Param("name")

		hc, err := helm.NewClient(proxy.k8sClient.Config, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to create helm client: %v", err),
			})
		}

		// Get the Helm release history
		releases, err := hc.GetHistory(c.Request().Context(), name, namespace)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Helm release history: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"releases": releases,
		})
	})

	// Add endpoint for Helm release values (context-aware)
	s.echo.GET("/api/:context/helm/values/:namespace/:name", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		namespace := c.Param("namespace")
		name := c.Param("name")

		// Parse the allValues query parameter (default to false if not provided)
		allValues := false
		if c.QueryParam("allValues") == "true" {
			allValues = true
		}

		// Parse the revision query parameter if provided
		revision := 0
		if revStr := c.QueryParam("revision"); revStr != "" {
			if rev, err := strconv.Atoi(revStr); err == nil && rev > 0 {
				revision = rev
			}
		}

		hc, err := helm.NewClient(proxy.k8sClient.Config, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to create helm client: %v", err),
			})
		}

		// Get the Helm release values
		values, err := hc.GetValues(c.Request().Context(), name, namespace, allValues, revision)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Helm release values: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"values": values,
		})
	})

	// Add endpoint for Helm release manifest (context-aware)
	s.echo.GET("/api/:context/helm/manifest/:namespace/:name", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		namespace := c.Param("namespace")
		name := c.Param("name")

		// Parse the revision query parameter if provided
		revision := 0
		if revStr := c.QueryParam("revision"); revStr != "" {
			if rev, err := strconv.Atoi(revStr); err == nil && rev > 0 {
				revision = rev
			}
		}

		hc, err := helm.NewClient(proxy.k8sClient.Config, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to create helm client: %v", err),
			})
		}

		// Get the Helm release manifest
		manifest, err := hc.GetManifest(c.Request().Context(), name, namespace, revision)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Helm release manifest: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"manifest": manifest,
		})
	})

	// Add endpoint for Helm release rollback (context-aware)
	s.echo.POST("/api/:context/helm/rollback/:namespace/:name/:revision", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		namespace := c.Param("namespace")
		name := c.Param("name")
		revisionStr := c.Param("revision")

		// Parse the revision parameter
		revision, err := strconv.Atoi(revisionStr)
		if err != nil || revision <= 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("Invalid revision number: %s", revisionStr),
			})
		}

		hc, err := helm.NewClient(proxy.k8sClient.Config, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to create helm client: %v", err),
			})
		}

		// Perform the rollback
		err = hc.Rollback(c.Request().Context(), name, namespace, revision)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to rollback Helm release: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Successfully rolled back %s to revision %d", name, revision),
		})
	})

	// Kubernetes API proxy endpoints
	// New: match routes with explicit context: /k8s/:context/*
	s.echo.Any("/k8s/:context/*", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		return proxy.HandleAPIRequest(c)
	})

	// Add endpoint for kubectl exec WebSocket connections with context
	s.echo.GET("/api/:context/exec/:namespace/:podname", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		return s.handleExecWebSocketWithClient(c, proxy.k8sClient)
	})

	// Health check endpoint
	s.echo.GET("/healthz", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
}

// getOrCreateK8sProxyForContext returns a cached proxy for the given context,
// or creates and caches a new one if missing.
func (s *Server) getOrCreateK8sProxyForContext(contextName string) (*KubernetesProxy, error) {
	// Fast path: read lock then return if exists
	s.k8sProxiesMu.RLock()
	if proxy, ok := s.k8sProxies[contextName]; ok {
		s.k8sProxiesMu.RUnlock()
		return proxy, nil
	}
	s.k8sProxiesMu.RUnlock()

	// Build a new client for the requested context
	client, err := kubernetes.NewClient(s.config.KubeConfigPath, s.config.InsecureSkipTLSVerify)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	// Switch to requested context (validates existence)
	if client.CurrentContext != contextName {
		if err := client.SwitchContext(contextName, s.config.KubeConfigPath); err != nil {
			return nil, fmt.Errorf("failed to switch to context '%s': %w", contextName, err)
		}
	}

	// Create proxy for this context
	proxy, err := NewKubernetesProxy(client)
	if err != nil {
		return nil, fmt.Errorf("failed to create proxy for context '%s': %w", contextName, err)
	}

	// Cache it with write lock
	s.k8sProxiesMu.Lock()
	// Initialize map if nil (defensive)
	if s.k8sProxies == nil {
		s.k8sProxies = make(map[string]*KubernetesProxy)
	}
	s.k8sProxies[contextName] = proxy
	s.k8sProxiesMu.Unlock()

	return proxy, nil
}

// downloadAndExtractArtifact downloads and extracts a Flux source artifact
func (s *Server) downloadAndExtractArtifact(ctx context.Context, client *kubernetes.Client, artifactURL string) (string, error) {
	// Create a temporary directory
	tempDir, err := os.MkdirTemp("", "flux-artifact-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	// Check if this is an internal cluster URL that needs port-forwarding
	var actualURL string
	var portForwardCleanup func()

	// Look for typical source-controller internal URLs
	isInternalSourceController := false

	// Common source-controller URL patterns
	patterns := []string{
		"source-controller.flux-system.svc",
		"source-controller.flux-system.svc.cluster.local",
		"source-controller.flux-system",
	}

	for _, pattern := range patterns {
		if strings.Contains(artifactURL, pattern) {
			isInternalSourceController = true
			break
		}
	}

	if isInternalSourceController {
		// This is an internal cluster URL, we need to set up port-forwarding
		log.Printf("Detected internal cluster URL, setting up port-forwarding to source-controller")

		localURL, cleanup, err := s.setupSourceControllerPortForward(ctx, client, artifactURL)
		if err != nil {
			os.RemoveAll(tempDir)
			return "", fmt.Errorf("failed to setup port-forwarding: %w", err)
		}
		actualURL = localURL
		portForwardCleanup = cleanup
		defer portForwardCleanup()
	} else {
		actualURL = artifactURL
	}

	log.Printf("Downloading artifact from URL: %s", actualURL)

	// Download the artifact
	req, err := http.NewRequestWithContext(ctx, "GET", actualURL, nil)
	if err != nil {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to download artifact: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to download artifact: HTTP %d", resp.StatusCode)
	}

	// Read the response body
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to read artifact data: %w", err)
	}

	// Extract the tar.gz archive
	err = s.extractTarGz(data, tempDir)
	if err != nil {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to extract artifact: %w", err)
	}

	return tempDir, nil
}

// extractTarGz extracts a tar.gz archive to the specified directory
func (s *Server) extractTarGz(data []byte, destDir string) error {
	// Create a gzip reader
	gzReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzReader.Close()

	// Create a tar reader
	tarReader := tar.NewReader(gzReader)

	// Extract files
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		// Construct the full path
		path := filepath.Join(destDir, header.Name)

		if header.Name != "." {
			// Ensure the path is within the destination directory (security check)
			if !strings.HasPrefix(path, filepath.Clean(destDir)+string(os.PathSeparator)) {
				return fmt.Errorf("invalid file path: %s", header.Name)
			}
		}

		switch header.Typeflag {
		case tar.TypeDir:
			// Create directory
			err := os.MkdirAll(path, 0755)
			if err != nil {
				return fmt.Errorf("failed to create directory %s: %w", path, err)
			}
		case tar.TypeReg:
			// Create file
			err := os.MkdirAll(filepath.Dir(path), 0755)
			if err != nil {
				return fmt.Errorf("failed to create parent directory for %s: %w", path, err)
			}

			file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, os.FileMode(header.Mode))
			if err != nil {
				return fmt.Errorf("failed to create file %s: %w", path, err)
			}

			_, err = io.Copy(file, tarReader)
			file.Close()
			if err != nil {
				return fmt.Errorf("failed to write file %s: %w", path, err)
			}
		}
	}

	return nil
}

// Helper functions to get source resources
func (s *Server) getGitRepository(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/apis/source.toolkit.fluxcd.io/v1/namespaces/%s/gitrepositories/%s", namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getOCIRepository(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/ocirepositories/%s", namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getBucket(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/buckets/%s", namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

// getResourceGVK gets the GroupVersionKind for a resource
func (s *Server) getResourceGVK(kind, apiVersion string) (schema.GroupVersionKind, error) {
	// Create a GVK with the provided apiVersion
	if apiVersion != "" {
		gv, err := schema.ParseGroupVersion(apiVersion)
		if err != nil {
			return schema.GroupVersionKind{}, fmt.Errorf("invalid apiVersion '%s': %w", apiVersion, err)
		}

		return schema.GroupVersionKind{
			Group:   gv.Group,
			Version: gv.Version,
			Kind:    kind,
		}, nil
	}

	// If no apiVersion provided, assume it's a core resource
	return schema.GroupVersionKind{
		Group:   "",
		Version: "v1",
		Kind:    kind,
	}, nil
}

// describeResourceWithKubectl describes a Kubernetes resource using the official kubectl describe package
func (s *Server) describeResourceWithKubectl(client *kubernetes.Client, namespace, kind, name, apiVersion string) (string, error) {
	// Create a ConfigFlags struct from the current Kubernetes client config
	configFlags := genericclioptions.NewConfigFlags(true)

	// Set the namespace
	if namespace != "" {
		configFlags.Namespace = &namespace
	}

	// Set other config parameters from provided client
	configFlags.Context = &client.CurrentContext
	configFlags.APIServer = &client.Config.Host
	configFlags.BearerToken = &client.Config.BearerToken
	if client.Config.CAFile != "" {
		configFlags.CAFile = &client.Config.CAFile
	}
	configFlags.Insecure = &client.Config.Insecure

	// Set the kubeconfig path from the server's config
	if s.config.KubeConfigPath != "" {
		configFlags.KubeConfig = &s.config.KubeConfigPath
	}

	// Create a discovery client
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(client.Config)
	if err != nil {
		return "", fmt.Errorf("failed to create discovery client: %w", err)
	}

	// Get the resource mapping
	groupResources, err := restmapper.GetAPIGroupResources(discoveryClient)
	if err != nil {
		return "", fmt.Errorf("failed to get API group resources: %w", err)
	}

	mapper := restmapper.NewDiscoveryRESTMapper(groupResources)

	// Get the exact GVK
	gvk, err := s.getResourceGVK(kind, apiVersion)
	if err != nil {
		return "", err
	}

	// Get the REST mapping
	mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		return "", fmt.Errorf("failed to get REST mapping: %w", err)
	}

	// Get the appropriate describer for this resource
	describer, err := describe.Describer(configFlags, mapping)
	if err != nil {
		return "", fmt.Errorf("failed to create describer: %w", err)
	}

	// Set the describe settings
	settings := describe.DescriberSettings{
		ShowEvents: true,
		ChunkSize:  500,
	}

	// Call the describer
	result, err := describer.Describe(namespace, name, settings)
	if err != nil {
		return "", fmt.Errorf("error describing resource: %w", err)
	}

	return result, nil
}

// Start starts the server
func (s *Server) Start() error {
	address := fmt.Sprintf("%s:%d", s.config.Address, s.config.Port)
	return s.echo.Start(address)
}

// Shutdown gracefully shuts down the server
func (s *Server) Shutdown(ctx context.Context) error {
	return s.echo.Shutdown(ctx)
}

// setupSourceControllerPortForward sets up port-forwarding to the source-controller
func (s *Server) setupSourceControllerPortForward(ctx context.Context, client *kubernetes.Client, artifactURL string) (string, func(), error) {
	// Parse the original URL to extract the path
	u, err := url.Parse(artifactURL)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse URL: %w", err)
	}

	// Find an available local port
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		return "", nil, fmt.Errorf("failed to find available port: %w", err)
	}
	localPort := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	// Get the source-controller pod
	pods, err := client.Clientset.CoreV1().Pods("flux-system").List(ctx, metav1.ListOptions{
		LabelSelector: "app=source-controller",
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to list source-controller pods: %w", err)
	}

	if len(pods.Items) == 0 {
		return "", nil, fmt.Errorf("no source-controller pods found")
	}

	podName := pods.Items[0].Name
	log.Printf("Setting up port-forward to pod %s in namespace flux-system", podName)

	// Create the port-forward request
	req := client.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace("flux-system").
		Name(podName).
		SubResource("portforward")

		// Create SPDY transport
	transport, upgrader, err := spdy.RoundTripperFor(client.Config)
	if err != nil {
		return "", nil, fmt.Errorf("failed to create SPDY transport: %w", err)
	}

	// Create dialer
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, "POST", req.URL())

	// Create channels for port-forwarding
	stopChan := make(chan struct{}, 1)
	readyChan := make(chan struct{}, 1)

	// Create port-forwarder
	ports := []string{fmt.Sprintf("%d:9090", localPort)} // Forward local port to source-controller port 9090
	pf, err := portforward.New(dialer, ports, stopChan, readyChan, os.Stdout, os.Stderr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to create port-forwarder: %w", err)
	}

	// Start port-forwarding in a goroutine
	go func() {
		if err := pf.ForwardPorts(); err != nil {
			log.Printf("Port-forwarding error: %v", err)
		}
	}()

	// Wait for port-forwarding to be ready
	select {
	case <-readyChan:
		log.Printf("Port-forwarding ready on localhost:%d", localPort)
	case <-time.After(10 * time.Second):
		close(stopChan)
		return "", nil, fmt.Errorf("timeout waiting for port-forwarding to be ready")
	}

	// Extract the artifact path from the URL - this is everything after the hostname and port
	// Example: "/gitrepository/flux-system/podinfo/b07046644566291cf282070670ba0f99e76e9a7e.tar.gz"
	artifactPath := u.Path

	// Ensure we have all query parameters
	queryString := ""
	if u.RawQuery != "" {
		queryString = "?" + u.RawQuery
	}

	// Create the local URL
	localURL := fmt.Sprintf("http://localhost:%d%s%s", localPort, artifactPath, queryString)
	log.Printf("Transformed URL from %s to %s", artifactURL, localURL)

	// Return cleanup function
	cleanup := func() {
		log.Printf("Stopping port-forward to source-controller")
		close(stopChan)
	}

	return localURL, cleanup, nil
}

// handleExecWebSocketWithClient handles WebSocket connections for kubectl exec using a specific k8s client
func (s *Server) handleExecWebSocketWithClient(c echo.Context, client *kubernetes.Client) error {
	namespace := c.Param("namespace")
	podname := c.Param("podname")

	log.Printf("Setting up exec WebSocket for pod %s/%s with auto shell detection (context: %s)", namespace, podname, client.CurrentContext)

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Printf("Failed to upgrade to websocket: %v", err)
		return fmt.Errorf("failed to upgrade to websocket: %w", err)
	}
	defer ws.Close()

	shells := []string{"bash", "sh", "ash"}

	var executor remotecommand.Executor
	var execCmd []string
	var shell string
	var shellFound bool

	for _, tryShell := range shells {
		log.Printf("Trying shell: %s", tryShell)

		var shellExists bool
		testMethods := [][]string{
			{tryShell, "--version"},
			{tryShell, "--help"},
			{tryShell, "-c", "exit 0"},
		}

		for _, testCmd := range testMethods {
			testReq := client.Clientset.CoreV1().RESTClient().Post().
				Resource("pods").
				Name(podname).
				Namespace(namespace).
				SubResource("exec").
				VersionedParams(&corev1.PodExecOptions{
					Command: testCmd,
					Stdin:   false,
					Stdout:  true,
					Stderr:  true,
					TTY:     false,
				}, scheme.ParameterCodec)

			testExec, err := remotecommand.NewSPDYExecutor(client.Config, "POST", testReq.URL())
			if err != nil {
				continue
			}

			var testOut, testErr bytes.Buffer
			err = testExec.StreamWithContext(c.Request().Context(), remotecommand.StreamOptions{
				Stdout: &testOut,
				Stderr: &testErr,
			})

			if err == nil {
				shellExists = true
				log.Printf("Shell %s found using test: %v", tryShell, testCmd)
				break
			}
		}

		if !shellExists {
			log.Printf("Shell %s not found in container", tryShell)
			continue
		}

		execCmd = []string{tryShell}
		req := client.Clientset.CoreV1().RESTClient().Post().
			Resource("pods").
			Name(podname).
			Namespace(namespace).
			SubResource("exec").
			VersionedParams(&corev1.PodExecOptions{
				Command: execCmd,
				Stdin:   true,
				Stdout:  true,
				Stderr:  true,
				TTY:     true,
			}, scheme.ParameterCodec)

		exec, err := remotecommand.NewSPDYExecutor(client.Config, "POST", req.URL())
		if err != nil {
			log.Printf("Failed to create interactive executor for shell %s: %v", tryShell, err)
			continue
		}

		executor = exec
		shell = tryShell
		shellFound = true
		break
	}

	if !shellFound {
		errorMsg := map[string]interface{}{
			"type":  "error",
			"error": "no suitable shell found in container",
		}
		ws.WriteJSON(errorMsg)
		return fmt.Errorf("no suitable shell found in container")
	}

	log.Printf("Using shell: %s", shell)

	connectedMsg := map[string]interface{}{
		"type":    "connected",
		"message": fmt.Sprintf("Connected to %s/%s with shell %s", namespace, podname, shell),
	}
	if err := ws.WriteJSON(connectedMsg); err != nil {
		log.Printf("Error sending connected message: %v", err)
		return err
	}

	stdinReader, stdinWriter := io.Pipe()
	stdoutReader, stdoutWriter := io.Pipe()
	stderrReader, stderrWriter := io.Pipe()

	done := make(chan struct{})

	go func() {
		defer func() {
			stdinWriter.Close()
			select {
			case <-done:
			default:
				close(done)
			}
		}()

		for {
			var msg map[string]interface{}
			if err := ws.ReadJSON(&msg); err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket read error: %v", err)
				} else {
					log.Printf("WebSocket closed by client")
				}
				return
			}

			if msgType, ok := msg["type"].(string); ok {
				switch msgType {
				case "input":
					if data, ok := msg["data"].(string); ok {
						if _, err := stdinWriter.Write([]byte(data)); err != nil {
							log.Printf("Error writing to stdin: %v", err)
							return
						}
					}
				case "resize":
					if cols, ok := msg["cols"].(float64); ok {
						if rows, ok := msg["rows"].(float64); ok {
							log.Printf("Terminal resize: %dx%d", int(cols), int(rows))
						}
					}
				}
			}
		}
	}()

	go func() {
		defer stdoutWriter.Close()
		buf := make([]byte, 1024)
		for {
			select {
			case <-done:
				return
			default:
				n, err := stdoutReader.Read(buf)
				if err != nil {
					if err != io.EOF {
						log.Printf("Error reading stdout: %v", err)
					}
					return
				}

				data := string(buf[:n])
				outputMsg := map[string]interface{}{
					"type": "data",
					"data": data,
				}

				if err := ws.WriteJSON(outputMsg); err != nil {
					log.Printf("Error sending stdout to WebSocket: %v", err)
					return
				}
			}
		}
	}()

	go func() {
		defer stderrWriter.Close()
		buf := make([]byte, 1024)
		for {
			select {
			case <-done:
				return
			default:
				n, err := stderrReader.Read(buf)
				if err != nil {
					if err != io.EOF {
						log.Printf("Error reading stderr: %v", err)
					}
					return
				}

				data := string(buf[:n])
				outputMsg := map[string]interface{}{
					"type": "data",
					"data": data,
				}

				if err := ws.WriteJSON(outputMsg); err != nil {
					log.Printf("Error sending stderr to WebSocket: %v", err)
					return
				}
			}
		}
	}()

	execDone := make(chan error, 1)
	go func() {
		log.Printf("Starting exec stream for %s/%s with shell %s", namespace, podname, shell)
		err := executor.StreamWithContext(c.Request().Context(), remotecommand.StreamOptions{
			Stdin:  stdinReader,
			Stdout: stdoutWriter,
			Stderr: stderrWriter,
			Tty:    true,
		})
		log.Printf("Exec stream finished for %s/%s (shell: %s) with error: %v", namespace, podname, shell, err)
		execDone <- err
	}()

	select {
	case err := <-execDone:
		if err != nil {
			log.Printf("Exec stream error: %v", err)
			errorMsg := map[string]interface{}{
				"type":  "error",
				"error": fmt.Sprintf("Exec stream error: %v", err),
			}
			ws.WriteJSON(errorMsg)
		} else {
			log.Printf("Exec stream completed successfully")
		}
	case <-done:
		log.Printf("WebSocket closed, terminating exec session")
	}

	select {
	case <-done:
	default:
		close(done)
	}

	return nil
}

// generateKustomizationDiffWithFluxStyle generates a diff using the actual FluxCD Builder and Diff functionality
func (s *Server) generateKustomizationDiffWithFluxStyle(ctx context.Context, client *kubernetes.Client, kustomization *kustomizev1.Kustomization) ([]FluxDiffResult, error) {
	log.Printf("Generating FluxCD diff for Kustomization %s/%s using actual FluxCD Builder",
		kustomization.ObjectMeta.Namespace,
		kustomization.ObjectMeta.Name,
	)

	sourceNamespace := kustomization.ObjectMeta.Namespace
	if kustomization.Spec.SourceRef.Namespace != "" {
		sourceNamespace = kustomization.Spec.SourceRef.Namespace
	}

	// Step 1: Download and extract the source artifact to a temporary directory
	tempDir, err := s.getSourceArtifactDirectory(ctx, client, kustomization, sourceNamespace)
	if err != nil {
		return nil, fmt.Errorf("failed to get source artifact: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Step 2: Create ConfigFlags from our Kubernetes client
	configFlags := &genericclioptions.ConfigFlags{
		APIServer:   &client.Config.Host,
		BearerToken: &client.Config.BearerToken,
		Context:     &client.CurrentContext,
	}
	if client.Config.CAFile != "" {
		configFlags.CAFile = &client.Config.CAFile
	}
	configFlags.Insecure = &client.Config.Insecure

	// Set the kubeconfig path from the server's config
	if s.config.KubeConfigPath != "" {
		configFlags.KubeConfig = &s.config.KubeConfigPath
	}

	namespace := kustomization.ObjectMeta.Namespace
	configFlags.Namespace = &namespace

	// Step 3: Create FluxCD client options
	clientOpts := &runclient.Options{
		QPS:   100,
		Burst: 300,
	}

	// Step 4: Build the resources path
	resourcesPath := filepath.Join(tempDir, kustomization.Spec.Path)

	// Step 5: Create the FluxCD Builder with the exact same options FluxCD uses
	builder, err := build.NewBuilder(
		kustomization.ObjectMeta.Name,
		resourcesPath,
		build.WithClientConfig(configFlags, clientOpts),
		build.WithNamespace(kustomization.ObjectMeta.Namespace),
		build.WithTimeout(80*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create FluxCD builder: %w", err)
	}

	// Step 6: Use FluxCD's actual Diff method - this is the real FluxCD diff!
	kubeClient, err := utils.KubeClient(configFlags, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kubernetes client: %w", err)
	}
	fluxDiffResult, err := fluxDiff(kubeClient, builder, kustomization)
	if err != nil {
		return nil, fmt.Errorf("FluxCD diff failed: %w", err)
	}

	// Step 7: Return FluxCD-style result structure
	return fluxDiffResult, nil
}

// getSourceArtifactDirectory downloads and extracts the source artifact, returning the temporary directory path
func (s *Server) getSourceArtifactDirectory(ctx context.Context, client *kubernetes.Client, kustomization *kustomizev1.Kustomization, sourceNamespace string) (string, error) {
	// Get the source resource to find the artifact
	var sourceResource map[string]interface{}
	var err error

	switch strings.ToLower(kustomization.Spec.SourceRef.Kind) {
	case "gitrepository":
		sourceResource, err = s.getGitRepository(ctx, client, kustomization.Spec.SourceRef.Name, sourceNamespace)
	case "ocirepository":
		sourceResource, err = s.getOCIRepository(ctx, client, kustomization.Spec.SourceRef.Name, sourceNamespace)
	case "bucket":
		sourceResource, err = s.getBucket(ctx, client, kustomization.Spec.SourceRef.Name, sourceNamespace)
	default:
		return "", fmt.Errorf("unsupported source kind: %s", kustomization.Spec.SourceRef.Kind)
	}

	if err != nil {
		return "", fmt.Errorf("failed to get source resource: %w", err)
	}

	// Extract artifact information
	status, ok := sourceResource["status"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("source resource has no status")
	}

	artifact, ok := status["artifact"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("source resource has no artifact")
	}

	artifactURL, ok := artifact["url"].(string)
	if !ok {
		return "", fmt.Errorf("artifact has no URL")
	}

	// Download and extract the artifact
	tempDir, err := s.downloadAndExtractArtifact(ctx, client, artifactURL)
	if err != nil {
		return "", fmt.Errorf("failed to download and extract artifact: %w", err)
	}

	return tempDir, nil
}
