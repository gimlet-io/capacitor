// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

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

	batchv1 "k8s.io/api/batch/v1"
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

// SystemViewFilter represents a single filter entry in a system view configuration
type SystemViewFilter struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// SystemView represents a single system view configuration exposed via /api/config
type SystemView struct {
	ID       string             `json:"id"`
	Label    string             `json:"label"`
	IsSystem bool               `json:"isSystem"`
	Filters  []SystemViewFilter `json:"filters"`
}

// ControllerConfig represents configuration for a FluxCD controller
type ControllerConfig struct {
	DeploymentName string `json:"deploymentName"`
	LabelKey       string `json:"labelKey"`
	LabelValue     string `json:"labelValue"`
}

// FluxCDResponse represents the FluxCD configuration in the config response
type FluxCDResponse struct {
	Namespace           string           `json:"namespace"`
	HelmController      ControllerConfig `json:"helmController"`
	KustomizeController ControllerConfig `json:"kustomizeController"`
}

// CarvelResponse represents the Carvel kapp-controller configuration in the config response
type CarvelResponse struct {
	Namespace      string           `json:"namespace"`
	KappController ControllerConfig `json:"kappController"`
}

// ConfigResponse represents the response from the /api/config endpoint
// SystemViews is a map keyed by kube context name; the "*" key is used as a
// wildcard/default for any context that doesn't have an explicit entry.
type ConfigResponse struct {
	SystemViews map[string][]SystemView `json:"systemViews"`
	FluxCD      FluxCDResponse          `json:"fluxcd"`
	Carvel      CarvelResponse          `json:"carvel"`
}

// defaultSystemViews contains the built‑in system views that were previously hardcoded in ViewBar.tsx.
// They are now served from the backend so they can be centrally controlled and customized.
var defaultSystemViews = []SystemView{
	{
		ID:       "pods",
		Label:    "Pods",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "core/Pod"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
	{
		ID:       "services",
		Label:    "Services",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "core/Service"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
	{
		ID:       "helm",
		Label:    "Helm",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "helm.sh/Release"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
	{
		ID:       "fluxcd/kustomizations",
		Label:    "FluxCD/Kustomizations",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "kustomize.toolkit.fluxcd.io/Kustomization"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
	{
		ID:       "fluxcd/helmreleases",
		Label:    "FluxCD/HelmReleases",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "helm.toolkit.fluxcd.io/HelmRelease"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
	{
		ID:       "carvel/apps",
		Label:    "Carvel/Apps",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "kappctrl.k14s.io/App"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
	{
		ID:       "carvel/pkgi",
		Label:    "Carvel/PackageInstall",
		IsSystem: true,
		Filters: []SystemViewFilter{
			{Name: "ResourceType", Value: "packaging.carvel.dev/PackageInstall"},
			{Name: "Namespace", Value: "all-namespaces"},
		},
	},
}

// defaultSystemViewMap exposes the built‑in system views under the "*"
// wildcard key so that all contexts share the same defaults unless
// explicitly overridden by a context‑specific configuration.
var defaultSystemViewMap = map[string][]SystemView{
	"*": defaultSystemViews,
}

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
				// URL decode the context name to handle special characters like @
				ctxName, err := url.PathUnescape(ctxName)
				if err != nil {
					return c.JSON(http.StatusBadRequest, map[string]string{
						"error": fmt.Sprintf("failed to decode context name: %v", err),
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

		// URL decode the context name to handle special characters like @
		ctxName, err := url.PathUnescape(ctxName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("failed to decode context name: %v", err),
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

	// App configuration endpoint (exposes UI options like system views)
	s.echo.GET("/api/config", func(c echo.Context) error {
		return c.JSON(http.StatusOK, ConfigResponse{
			SystemViews: defaultSystemViewMap,
			FluxCD: FluxCDResponse{
				Namespace: s.config.FluxCD.Namespace,
				HelmController: ControllerConfig{
					DeploymentName: s.config.FluxCD.HelmControllerDeploymentName,
					LabelKey:       s.config.FluxCD.HelmControllerLabelKey,
					LabelValue:     s.config.FluxCD.HelmControllerLabelValue,
				},
				KustomizeController: ControllerConfig{
					DeploymentName: s.config.FluxCD.KustomizeControllerDeploymentName,
					LabelKey:       s.config.FluxCD.KustomizeControllerLabelKey,
					LabelValue:     s.config.FluxCD.KustomizeControllerLabelValue,
				},
			},
			Carvel: CarvelResponse{
				Namespace: s.config.Carvel.Namespace,
				KappController: ControllerConfig{
					DeploymentName: s.config.Carvel.KappControllerDeploymentName,
					LabelKey:       s.config.Carvel.KappControllerLabelKey,
					LabelValue:     s.config.Carvel.KappControllerLabelValue,
				},
			},
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

		// Discover Flux API paths dynamically
		resourceAPIs, err := proxy.discoverFluxAPIPaths()
		if err != nil {
			log.Printf("Error discovering Flux API paths: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to discover Flux API paths: %v", err),
			})
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
		_, err = clientset.
			RESTClient().
			Patch(types.MergePatchType).
			AbsPath(fmt.Sprintf(apiPath, resourceNamespace, resourceName)).
			Body([]byte(patchData)).
			DoRaw(ctx)

		if err != nil {
			log.Printf("Error reconciling Flux resource: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error":     fmt.Sprintf("Failed to reconcile resource: %v", err),
				"kind":      kind,
				"name":      resourceName,
				"namespace": resourceNamespace,
			})
		}

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

			// HelmRelease has sourceRef at spec.chart.spec.sourceRef or via spec.chartRef
			// (either a HelmChart resource which in turn has spec.sourceRef, or directly an OCIRepository).
			// while Kustomization and Terraform have it at spec.sourceRef
			var sourceRef map[string]interface{}
			if kind == "HelmRelease" {
				// Try inline chart first (spec.chart.spec.sourceRef)
				if chart, ok := spec["chart"].(map[string]interface{}); ok {
					if chartSpec, ok := chart["spec"].(map[string]interface{}); ok {
						if srcRef, ok := chartSpec["sourceRef"].(map[string]interface{}); ok {
							sourceRef = srcRef
						}
					}
				}

				// If no inline chart sourceRef, try chartRef (HelmChart or OCIRepository resource)
				if sourceRef == nil {
					if chartRef, ok := spec["chartRef"].(map[string]interface{}); ok {
						chartRefKind, _ := chartRef["kind"].(string)
						chartRefName, _ := chartRef["name"].(string)
						chartRefNamespace := resourceNamespace
						if ns, ok := chartRef["namespace"].(string); ok && ns != "" {
							chartRefNamespace = ns
						}

						if chartRefName != "" {
							switch chartRefKind {
							case "HelmChart":
								// Get the HelmChart resource to find its sourceRef
								helmChartAPIPath, err := proxy.getFluxAPIPath(ctx, "HelmChart")
								if err != nil {
									log.Printf("Error discovering HelmChart API path: %v", err)
									return c.JSON(http.StatusInternalServerError, map[string]string{
										"error": fmt.Sprintf("Failed to discover HelmChart API path: %v", err),
									})
								}

								helmChartPath := fmt.Sprintf(helmChartAPIPath, chartRefNamespace, chartRefName)
								helmChartData, err := clientset.RESTClient().Get().AbsPath(helmChartPath).DoRaw(ctx)
								if err != nil {
									log.Printf("Error getting HelmChart resource: %v", err)
									return c.JSON(http.StatusInternalServerError, map[string]string{
										"error": fmt.Sprintf("Failed to get HelmChart resource: %v", err),
									})
								}

								var helmChartObj map[string]interface{}
								if err := json.Unmarshal(helmChartData, &helmChartObj); err != nil {
									log.Printf("Error parsing HelmChart data: %v", err)
									return c.JSON(http.StatusInternalServerError, map[string]string{
										"error": fmt.Sprintf("Failed to parse HelmChart data: %v", err),
									})
								}

								if helmChartSpec, ok := helmChartObj["spec"].(map[string]interface{}); ok {
									if srcRef, ok := helmChartSpec["sourceRef"].(map[string]interface{}); ok {
										sourceRef = srcRef
									}
								}
							case "OCIRepository":
								// When chartRef points directly at an OCIRepository, the repository itself is the source.
								srcRef := map[string]interface{}{
									"kind": "OCIRepository",
									"name": chartRefName,
								}
								if chartRefNamespace != "" {
									srcRef["namespace"] = chartRefNamespace
								}
								sourceRef = srcRef
							}
						}
					}
				}

				if sourceRef == nil {
					log.Printf("HelmRelease does not have a sourceRef (neither in chart.spec.sourceRef nor via chartRef)")
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "HelmRelease does not have a sourceRef field in chart.spec.sourceRef or via chartRef",
					})
				}
			} else {
				sourceRef, ok = spec["sourceRef"].(map[string]interface{})
				if !ok {
					log.Printf("Resource does not have a sourceRef field")
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "Resource does not have a sourceRef field",
					})
				}
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

		// Discover Flux API paths dynamically
		resourceAPIs, err := proxy.discoverFluxAPIPaths()
		if err != nil {
			log.Printf("Error discovering Flux API paths: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to discover Flux API paths: %v", err),
			})
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
		_, err = clientset.
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

		// Discover Flux API paths dynamically
		resourceAPIs, err := proxy.discoverFluxAPIPaths()
		if err != nil {
			log.Printf("Error discovering Flux API paths: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to discover Flux API paths: %v", err),
			})
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

		// Discover Flux API path for Kustomization
		kustomizationAPIPath, err := proxy.getFluxAPIPath(ctx, "Kustomization")
		if err != nil {
			log.Printf("Error discovering Kustomization API path: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to discover Kustomization API path: %v", err),
			})
		}

		// Get the Kustomization resource
		kustomizationPath := fmt.Sprintf(kustomizationAPIPath, req.Namespace, req.Name)
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

	// Add endpoint for inspecting Flux source artifacts (GitRepository, OCIRepository, Bucket, etc.)
	// This downloads the artifact from source-controller (using port-forward when needed),
	// extracts it to a temporary directory, walks the files, and returns a lightweight file listing.
	s.echo.GET("/api/:context/flux/source-artifact/:kind/:namespace/:name", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}

		kindParam := c.Param("kind")
		namespace := c.Param("namespace")
		name := c.Param("name")

		if strings.TrimSpace(kindParam) == "" || strings.TrimSpace(namespace) == "" || strings.TrimSpace(name) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "kind, namespace, and name are required path parameters",
			})
		}

		client := proxy.k8sClient
		ctx := context.Background()

		// Load the source resource based on kind
		var (
			sourceResource map[string]interface{}
			err            error
		)

		switch strings.ToLower(kindParam) {
		case "gitrepository":
			sourceResource, err = s.getGitRepository(ctx, client, name, namespace)
		case "ocirepository":
			sourceResource, err = s.getOCIRepository(ctx, client, name, namespace)
		case "bucket":
			sourceResource, err = s.getBucket(ctx, client, name, namespace)
		case "helmrepository":
			sourceResource, err = s.getHelmRepository(ctx, client, name, namespace)
		case "helmchart":
			sourceResource, err = s.getHelmChart(ctx, client, name, namespace)
		default:
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("unsupported source kind for artifact inspection: %s", kindParam),
			})
		}

		if err != nil {
			log.Printf("Error getting source resource %s/%s (%s): %v", namespace, name, kindParam, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to get source resource: %v", err),
			})
		}

		status, ok := sourceResource["status"].(map[string]interface{})
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "source resource has no status",
			})
		}

		artifact, ok := status["artifact"].(map[string]interface{})
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "source resource has no artifact",
			})
		}

		artifactURL, ok := artifact["url"].(string)
		if !ok || strings.TrimSpace(artifactURL) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "artifact has no URL",
			})
		}

		tempDir, err := DownloadAndExtractArtifact(ctx, client, artifactURL)
		if err != nil {
			log.Printf("Error downloading source artifact for %s/%s (%s): %v", namespace, name, kindParam, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to download and extract artifact: %v", err),
			})
		}
		defer os.RemoveAll(tempDir)

		files, err := ListArtifactFiles(tempDir)
		if err != nil {
			log.Printf("Error listing files in artifact for %s/%s (%s): %v", namespace, name, kindParam, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("failed to list artifact files: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"files":     files,
			"kind":      kindParam,
			"name":      name,
			"namespace": namespace,
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

	// Add endpoint for running a CronJob immediately by creating a one-off Job (context-aware)
	// Equivalent to: kubectl create job --from=cronjob/<name> <generated-name>
	s.echo.POST("/api/:context/cronjob/run", func(c echo.Context) error {
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

		if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Namespace) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Name and namespace are required fields",
			})
		}

		clientset := proxy.k8sClient.Clientset
		ctx := context.Background()

		cronJob, err := clientset.BatchV1().CronJobs(req.Namespace).Get(ctx, req.Name, metav1.GetOptions{})
		if err != nil {
			log.Printf("Error getting CronJob %s/%s: %v", req.Namespace, req.Name, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get CronJob: %v", err),
			})
		}

		// Generate a job name that clearly indicates a manual run
		timestamp := time.Now().Format("20060102150405")
		jobName := fmt.Sprintf("%s-manual-%s", cronJob.Name, timestamp)

		job := &batchv1.Job{
			ObjectMeta: metav1.ObjectMeta{
				Name:        jobName,
				Namespace:   cronJob.Namespace,
				Labels:      cronJob.Spec.JobTemplate.Labels,
				Annotations: cronJob.Spec.JobTemplate.Annotations,
			},
			Spec: *cronJob.Spec.JobTemplate.Spec.DeepCopy(),
		}

		// Set controller reference back to the CronJob (matches what kubectl does)
		if ownerRef := metav1.NewControllerRef(cronJob, batchv1.SchemeGroupVersion.WithKind("CronJob")); ownerRef != nil {
			job.OwnerReferences = []metav1.OwnerReference{*ownerRef}
		}

		created, err := clientset.BatchV1().Jobs(req.Namespace).Create(ctx, job, metav1.CreateOptions{})
		if err != nil {
			log.Printf("Error creating Job from CronJob %s/%s: %v", req.Namespace, req.Name, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to create Job from CronJob: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Job %s created from CronJob %s/%s", created.Name, req.Namespace, req.Name),
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

	// Add endpoints for listing Helm releases (context-aware) with optional Table response
	// Support trailing resource segment to match client list path construction
	s.echo.GET("/api/:context/helm/releases/releases", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		return s.handleHelmReleasesList(c, proxy, "")
	})

	// Support trailing resource segment for namespaced path as well
	s.echo.GET("/api/:context/helm/releases/namespaces/:namespace/releases", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		ns := c.Param("namespace")
		if strings.EqualFold(ns, "all-namespaces") {
			ns = ""
		}
		return s.handleHelmReleasesList(c, proxy, ns)
	})

	// Add endpoints for listing Kluctl Deployments (context-aware) backed by Kluctl result secrets.
	// Pseudo resource: apiVersion kluctl.io/v1, kind Deployment.
	s.echo.GET("/api/:context/kluctl/deployments/deployments", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		return s.handleKluctlDeploymentsList(c, proxy, "")
	})

	s.echo.GET("/api/:context/kluctl/deployments/namespaces/:namespace/deployments", func(c echo.Context) error {
		proxy, ok := getProxyFromContext(c)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing proxy in context"})
		}
		ns := c.Param("namespace")
		if strings.EqualFold(ns, "all-namespaces") {
			ns = ""
		}
		return s.handleKluctlDeploymentsList(c, proxy, ns)
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

	// NOTE: Carvel diagrams are now generated client-side using the Kubernetes apiserver proxy (`/k8s/:context/*`).

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

// handleHelmReleasesList lists Helm releases and returns either a Kubernetes Table or a plain List
func (s *Server) handleHelmReleasesList(c echo.Context, proxy *KubernetesProxy, namespace string) error {
	hc, err := helm.NewClient(proxy.k8sClient.Config, "")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("failed to create helm client: %v", err),
		})
	}

	releases, err := hc.ListReleases(c.Request().Context(), namespace)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to list Helm releases: %v", err),
		})
	}

	accept := c.Request().Header.Get("Accept")
	if strings.Contains(accept, "as=Table;g=meta.k8s.io;v=v1") {
		table := buildHelmReleasesTable(releases)
		return c.JSON(http.StatusOK, table)
	}

	// Default JSON list fallback
	items := make([]map[string]interface{}, 0, len(releases))
	for _, rel := range releases {
		items = append(items, buildHelmReleaseObject(rel))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"kind":       "List",
		"apiVersion": "v1",
		"items":      items,
	})
}

// handleKluctlDeploymentsList lists Kluctl Deployments (pseudo resources) using Kluctl result secrets.
// It returns either a Kubernetes Table or a plain List, similar to handleHelmReleasesList.
func (s *Server) handleKluctlDeploymentsList(c echo.Context, proxy *KubernetesProxy, namespace string) error {
	ctx := c.Request().Context()

	// For now, read command results from the same namespace used by the Kluctl CLI by default,
	// but allow overriding via environment variable CAPACITOR_KLUCTL_RESULTS_NAMESPACE.
	commandResultNamespace := os.Getenv("CAPACITOR_KLUCTL_RESULTS_NAMESPACE")
	if commandResultNamespace == "" {
		commandResultNamespace = "kluctl-results"
	}

	summaries, payloads, err := ListCommandResultSummariesWithPayload(ctx, proxy.k8sClient, commandResultNamespace)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("failed to list kluctl command results: %v", err),
		})
	}

	groups := GroupCommandResultSummaries(summaries)

	// Build pseudo Deployment objects, optionally filtering by namespace.
	items := make([]map[string]interface{}, 0, len(groups))
	rows := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		obj := BuildKluctlDeploymentObject(g, payloads)
		// Ensure every pseudo Deployment has a namespace; default to the command result namespace
		// when KluctlDeploymentInfo.Namespace is not available.
		if obj.Metadata.Namespace == "" {
			obj.Metadata.Namespace = commandResultNamespace
		}
		if namespace != "" && obj.Metadata.Namespace != namespace {
			continue
		}
		item := map[string]interface{}{
			"apiVersion": obj.APIVersion,
			"kind":       obj.Kind,
			"metadata":   obj.Metadata,
			"spec":       obj.Spec,
			"status":     obj.Status,
		}
		items = append(items, item)
		rows = append(rows, map[string]interface{}{
			"cells": []interface{}{
				obj.Metadata.Name,
				obj.Metadata.Namespace,
			},
			"object": item,
		})
	}

	accept := c.Request().Header.Get("Accept")
	if strings.Contains(accept, "as=Table;g=meta.k8s.io;v1") {
		// Minimal Table response; columns are resolved client-side, so we only need rows with object references.
		table := map[string]interface{}{
			"kind":       "Table",
			"apiVersion": "meta.k8s.io/v1",
			"columnDefinitions": []map[string]interface{}{
				{"name": "Name", "type": "string", "format": "name"},
				{"name": "Namespace", "type": "string"},
			},
			"rows": rows,
		}
		return c.JSON(http.StatusOK, table)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"kind":       "List",
		"apiVersion": "v1",
		"items":      items,
	})
}

// buildHelmReleaseObject converts a Helm release to a Kubernetes-like object
func buildHelmReleaseObject(release *helm.Release) map[string]interface{} {
	return map[string]interface{}{
		"apiVersion": "helm.sh/v3",
		"kind":       "Release",
		"metadata": map[string]interface{}{
			"name":              release.Name,
			"namespace":         release.Namespace,
			"creationTimestamp": release.Updated.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{
			"chart":        release.Chart,
			"chartVersion": release.ChartVersion,
			"values":       release.Values,
		},
		"status": map[string]interface{}{
			"status":     release.Status,
			"revision":   release.Revision,
			"appVersion": release.AppVersion,
			"notes":      release.Notes,
		},
	}
}

// buildHelmReleasesTable constructs a meta.k8s.io/v1 Table response for Helm releases
func buildHelmReleasesTable(releases []*helm.Release) map[string]interface{} {
	columnDefinitions := []map[string]interface{}{
		{"name": "Name", "type": "string", "format": "name"},
		{"name": "Chart", "type": "string"},
		{"name": "App Version", "type": "string"},
		{"name": "Status", "type": "string"},
		{"name": "Revision", "type": "string"},
		{"name": "Age", "type": "string"},
	}

	rows := make([]map[string]interface{}, 0, len(releases))
	now := time.Now()
	for _, rel := range releases {
		age := humanizeDuration(now.Sub(rel.Updated))
		chart := rel.Chart
		if rel.ChartVersion != "" {
			chart = fmt.Sprintf("%s (%s)", rel.Chart, rel.ChartVersion)
		}
		cells := []interface{}{
			rel.Name,
			chart,
			rel.AppVersion,
			rel.Status,
			fmt.Sprintf("%d", rel.Revision),
			age,
		}
		rows = append(rows, map[string]interface{}{
			"cells":  cells,
			"object": buildHelmReleaseObject(rel),
		})
	}

	return map[string]interface{}{
		"kind":              "Table",
		"apiVersion":        "meta.k8s.io/v1",
		"columnDefinitions": columnDefinitions,
		"rows":              rows,
	}
}

// humanizeDuration returns a short human-readable duration like 5m, 2h, 3d
func humanizeDuration(d time.Duration) string {
	if d < time.Minute {
		s := int(d.Seconds())
		if s <= 0 {
			return "0s"
		}
		return fmt.Sprintf("%ds", s)
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	days := int(d.Hours()) / 24
	return fmt.Sprintf("%dd", days)
}

// DownloadAndExtractArtifact downloads and extracts a Flux source artifact using the provided Kubernetes client.
// It is exported so that external backends (like onurl) can reuse the same implementation without duplication.
func DownloadAndExtractArtifact(ctx context.Context, client *kubernetes.Client, artifactURL string) (string, error) {
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

		localURL, cleanup, err := SetupSourceControllerPortForward(ctx, client, artifactURL)
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

	contentType := resp.Header.Get("Content-Type")
	log.Printf("Downloaded artifact: %d bytes, content-type: %s", len(data), contentType)

	if len(data) == 0 {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("downloaded artifact is empty")
	}

	// Check if this is a compressed archive or plain content
	// HelmRepository artifacts are plain YAML (index.yaml), not tar.gz
	isGzip := strings.Contains(contentType, "gzip") ||
		strings.Contains(contentType, "x-tar") ||
		(len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b) // gzip magic bytes

	if isGzip {
		// Extract the tar.gz archive
		extractedCount, err := ExtractTarGz(data, tempDir)
		if err != nil {
			os.RemoveAll(tempDir)
			return "", fmt.Errorf("failed to extract artifact: %w", err)
		}
		log.Printf("Extracted %d files/directories from artifact", extractedCount)
	} else {
		// Plain content (e.g., HelmRepository index.yaml)
		// Determine filename from URL or use default
		filename := "index.yaml"
		if u, err := url.Parse(artifactURL); err == nil {
			base := filepath.Base(u.Path)
			if base != "" && base != "." && base != "/" {
				filename = base
			}
		}
		destPath := filepath.Join(tempDir, filename)
		if err := os.WriteFile(destPath, data, 0644); err != nil {
			os.RemoveAll(tempDir)
			return "", fmt.Errorf("failed to write artifact file: %w", err)
		}
		log.Printf("Saved plain artifact as %s (%d bytes)", filename, len(data))
	}

	return tempDir, nil
}

// ExtractTarGz extracts a tar.gz archive to the specified directory.
// Returns the number of files/directories extracted.
func ExtractTarGz(data []byte, destDir string) (int, error) {
	// Create a gzip reader
	gzReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return 0, fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzReader.Close()

	// Create a tar reader
	tarReader := tar.NewReader(gzReader)

	extractedCount := 0

	// Extract files
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return extractedCount, fmt.Errorf("failed to read tar header: %w", err)
		}

		// Skip the root directory entry "." - it's just the tar root and adds no value
		if header.Name == "." {
			continue
		}

		// Construct the full path
		path := filepath.Join(destDir, header.Name)

		// Ensure the path is within the destination directory (security check)
		if !strings.HasPrefix(path, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return extractedCount, fmt.Errorf("invalid file path: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			// Create directory
			log.Printf("Extracting directory: %s", header.Name)
			err := os.MkdirAll(path, 0755)
			if err != nil {
				return extractedCount, fmt.Errorf("failed to create directory %s: %w", path, err)
			}
			extractedCount++
		case tar.TypeReg:
			// Create file
			log.Printf("Extracting file: %s (%d bytes)", header.Name, header.Size)
			err := os.MkdirAll(filepath.Dir(path), 0755)
			if err != nil {
				return extractedCount, fmt.Errorf("failed to create parent directory for %s: %w", path, err)
			}

			file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, os.FileMode(header.Mode))
			if err != nil {
				return extractedCount, fmt.Errorf("failed to create file %s: %w", path, err)
			}

			_, err = io.Copy(file, tarReader)
			file.Close()
			if err != nil {
				return extractedCount, fmt.Errorf("failed to write file %s: %w", path, err)
			}
			extractedCount++
		default:
			log.Printf("Skipping unsupported tar entry type %d for %s", header.Typeflag, header.Name)
		}
	}

	return extractedCount, nil
}

// ListArtifactFiles walks the extracted artifact directory and returns a shallow
// file listing including file contents (intended for source artifacts). Paths are
// returned relative to the artifact root.
// It is exported so that external backends can reuse the same serialization shape.
func ListArtifactFiles(root string) ([]map[string]interface{}, error) {
	files := []map[string]interface{}{}

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		// Skip the root directory entry itself
		if path == root {
			return nil
		}

		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}

		info, err := d.Info()
		if err != nil {
			return err
		}

		entry := map[string]interface{}{
			"path": rel,
			"size": info.Size(),
			"dir":  d.IsDir(),
		}
		// Include file contents for regular files (best-effort; errors bubble up)
		if !d.IsDir() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			entry["content"] = string(data)
		}
		files = append(files, entry)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return files, nil
}

// Helper function to discover Flux API path for a resource kind using a client
func (s *Server) discoverFluxAPIPathForClient(ctx context.Context, client *kubernetes.Client, kind string) (string, error) {
	// Create a temporary proxy for discovery (or we could extract discovery logic)
	proxy, err := NewKubernetesProxy(client)
	if err != nil {
		return "", fmt.Errorf("failed to create proxy for discovery: %w", err)
	}
	return proxy.getFluxAPIPath(ctx, kind)
}

// Helper functions to get source resources
func (s *Server) getGitRepository(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	apiPath, err := s.discoverFluxAPIPathForClient(ctx, client, "GitRepository")
	if err != nil {
		return nil, fmt.Errorf("failed to discover GitRepository API path: %w", err)
	}
	path := fmt.Sprintf(apiPath, namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getOCIRepository(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	apiPath, err := s.discoverFluxAPIPathForClient(ctx, client, "OCIRepository")
	if err != nil {
		return nil, fmt.Errorf("failed to discover OCIRepository API path: %w", err)
	}
	path := fmt.Sprintf(apiPath, namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getBucket(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	apiPath, err := s.discoverFluxAPIPathForClient(ctx, client, "Bucket")
	if err != nil {
		return nil, fmt.Errorf("failed to discover Bucket API path: %w", err)
	}
	path := fmt.Sprintf(apiPath, namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getHelmRepository(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	apiPath, err := s.discoverFluxAPIPathForClient(ctx, client, "HelmRepository")
	if err != nil {
		return nil, fmt.Errorf("failed to discover HelmRepository API path: %w", err)
	}
	path := fmt.Sprintf(apiPath, namespace, name)
	data, err := client.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getHelmChart(ctx context.Context, client *kubernetes.Client, name, namespace string) (map[string]interface{}, error) {
	apiPath, err := s.discoverFluxAPIPathForClient(ctx, client, "HelmChart")
	if err != nil {
		return nil, fmt.Errorf("failed to discover HelmChart API path: %w", err)
	}
	path := fmt.Sprintf(apiPath, namespace, name)
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

// SetupSourceControllerPortForward sets up port-forwarding to the source-controller
// for the given artifact URL. It is exported so that external backends can reuse
// the same behavior when inspecting Flux source artifacts.
func SetupSourceControllerPortForward(ctx context.Context, client *kubernetes.Client, artifactURL string) (string, func(), error) {
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
	requestedContainer := c.QueryParam("container")

	log.Printf("Setting up exec WebSocket for pod %s/%s with auto shell detection (context: %s, container: %s)", namespace, podname, client.CurrentContext, requestedContainer)

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
	var containerName string

	ctx := c.Request().Context()

	// Fetch pod to discover available containers
	pod, err := client.Clientset.CoreV1().Pods(namespace).Get(ctx, podname, metav1.GetOptions{})
	if err != nil {
		log.Printf("Failed to get pod %s/%s for exec: %v", namespace, podname, err)
		errorMsg := map[string]interface{}{
			"type":  "error",
			"error": fmt.Sprintf("failed to get pod %s/%s: %v", namespace, podname, err),
		}
		ws.WriteJSON(errorMsg)
		return err
	}

	// Build list of containers to try
	var containersToTry []string
	if requestedContainer != "" && requestedContainer != "all" {
		// Verify requested container exists in pod spec
		found := false
		for _, ctn := range pod.Spec.Containers {
			if ctn.Name == requestedContainer {
				found = true
				break
			}
		}
		if !found {
			errorMsg := map[string]interface{}{
				"type":  "error",
				"error": fmt.Sprintf("requested container %q not found in pod %s/%s", requestedContainer, namespace, podname),
			}
			ws.WriteJSON(errorMsg)
			return fmt.Errorf("requested container %q not found in pod %s/%s", requestedContainer, namespace, podname)
		}
		containersToTry = []string{requestedContainer}
	} else {
		for _, ctn := range pod.Spec.Containers {
			containersToTry = append(containersToTry, ctn.Name)
		}
	}

	if len(containersToTry) == 0 {
		errorMsg := map[string]interface{}{
			"type":  "error",
			"error": "pod has no containers to exec into",
		}
		ws.WriteJSON(errorMsg)
		return fmt.Errorf("pod %s/%s has no containers", namespace, podname)
	}

	// Try each container and shell combination until one works
	for _, tryContainer := range containersToTry {
		for _, tryShell := range shells {
			log.Printf("Trying shell %s in container %s for pod %s/%s", tryShell, tryContainer, namespace, podname)

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
						Container: tryContainer,
						Command:   testCmd,
						Stdin:     false,
						Stdout:    true,
						Stderr:    true,
						TTY:       false,
					}, scheme.ParameterCodec)

				testExec, err := remotecommand.NewSPDYExecutor(client.Config, "POST", testReq.URL())
				if err != nil {
					continue
				}

				var testOut, testErr bytes.Buffer
				err = testExec.StreamWithContext(ctx, remotecommand.StreamOptions{
					Stdout: &testOut,
					Stderr: &testErr,
				})

				if err == nil {
					shellExists = true
					log.Printf("Shell %s found in container %s using test: %v", tryShell, tryContainer, testCmd)
					break
				}
			}

			if !shellExists {
				log.Printf("Shell %s not found in container %s", tryShell, tryContainer)
				continue
			}

			execCmd = []string{tryShell}
			req := client.Clientset.CoreV1().RESTClient().Post().
				Resource("pods").
				Name(podname).
				Namespace(namespace).
				SubResource("exec").
				VersionedParams(&corev1.PodExecOptions{
					Container: tryContainer,
					Command:   execCmd,
					Stdin:     true,
					Stdout:    true,
					Stderr:    true,
					TTY:       true,
				}, scheme.ParameterCodec)

			exec, err := remotecommand.NewSPDYExecutor(client.Config, "POST", req.URL())
			if err != nil {
				log.Printf("Failed to create interactive executor for shell %s in container %s: %v", tryShell, tryContainer, err)
				continue
			}

			executor = exec
			shell = tryShell
			containerName = tryContainer
			shellFound = true
			break
		}

		if shellFound {
			break
		}
	}

	if !shellFound {
		errorMsg := map[string]interface{}{
			"type":  "error",
			"error": "no suitable shell found in any container in pod",
		}
		ws.WriteJSON(errorMsg)
		return fmt.Errorf("no suitable shell found in any container in pod %s/%s", namespace, podname)
	}

	log.Printf("Using shell: %s (container: %s)", shell, containerName)

	connectedMsg := map[string]interface{}{
		"type":    "connected",
		"message": fmt.Sprintf("Connected to %s/%s (container %s) with shell %s", namespace, podname, containerName, shell),
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
	tempDir, err := DownloadAndExtractArtifact(ctx, client, artifactURL)
	if err != nil {
		return "", fmt.Errorf("failed to download and extract artifact: %w", err)
	}

	return tempDir, nil
}
