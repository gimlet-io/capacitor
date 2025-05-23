package server

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gimlet-io/capacitor/pkg/config"
	"github.com/gimlet-io/capacitor/pkg/helm"
	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/restmapper"
	"k8s.io/kubectl/pkg/describe"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// Server represents the API server
type Server struct {
	echo       *echo.Echo
	config     *config.Config
	k8sClient  *kubernetes.Client
	helmClient *helm.Client
	wsHandler  *WebSocketHandler
	k8sProxy   *KubernetesProxy
	embedFS    fs.FS // embedded file system for static files
}

// New creates a new server instance
func New(cfg *config.Config, k8sClient *kubernetes.Client) (*Server, error) {
	// Create the echo instance
	e := echo.New()

	// Create Helm client
	helmClient, err := helm.NewClient(k8sClient.Config, "")
	if err != nil {
		return nil, fmt.Errorf("error creating helm client: %w", err)
	}

	// Create WebSocket handler
	wsHandler := NewWebSocketHandler(k8sClient, helmClient)

	// Create Kubernetes proxy
	k8sProxy, err := NewKubernetesProxy(k8sClient)
	if err != nil {
		return nil, fmt.Errorf("error creating kubernetes proxy: %w", err)
	}

	return &Server{
		echo:       e,
		config:     cfg,
		k8sClient:  k8sClient,
		helmClient: helmClient,
		wsHandler:  wsHandler,
		k8sProxy:   k8sProxy,
	}, nil
}

// Setup configures and sets up the server routes
func (s *Server) Setup() {
	// Add middleware
	s.echo.Use(middleware.Logger())
	s.echo.Use(middleware.Recover())
	s.echo.Use(middleware.CORS())

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

	// WebSocket endpoint
	s.echo.GET("/ws", func(c echo.Context) error {
		return s.wsHandler.HandleWebSocket(c)
	})

	// Add endpoint for getting kubeconfig contexts
	s.echo.GET("/api/contexts", func(c echo.Context) error {
		contexts := s.k8sClient.GetContexts()
		return c.JSON(http.StatusOK, map[string]interface{}{
			"contexts": contexts,
			"current":  s.k8sClient.CurrentContext,
		})
	})

	// Add endpoint for switching context
	s.echo.POST("/api/contexts/switch", func(c echo.Context) error {
		var req struct {
			Context string `json:"context"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid request body",
			})
		}

		// Check if context exists
		contexts := s.k8sClient.GetContexts()
		contextExists := false
		for _, ctx := range contexts {
			if ctx.Name == req.Context {
				contextExists = true
				break
			}
		}

		if !contextExists {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Context not found",
			})
		}

		// Switch context
		err := s.k8sClient.SwitchContext(req.Context)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to switch context: %v", err),
			})
		}

		// Recreate the Kubernetes proxy with the new context
		k8sProxy, err := NewKubernetesProxy(s.k8sClient)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Error recreating Kubernetes proxy: %v", err),
			})
		}
		s.k8sProxy = k8sProxy

		return c.JSON(http.StatusOK, map[string]string{
			"message": fmt.Sprintf("Switched to context %s", req.Context),
			"context": req.Context,
		})
	})

	// Add endpoint for reconciling Flux resources
	s.echo.POST("/api/flux/reconcile", func(c echo.Context) error {
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

		// Get the Kubernetes client
		clientset := s.k8sClient.Clientset

		// Create a context
		ctx := context.Background()

		// Instead of using the CLI command, we'll use the Kubernetes API to add a reconcile annotation
		// This is the same approach the Flux CLI uses under the hood

		// Generate the resource name and namespace
		resourceName := req.Name
		resourceNamespace := req.Namespace

		// Request immediate reconciliation by adding/updating the reconcile annotation
		// This is what the Flux CLI does behind the scenes
		patchData := fmt.Sprintf(`{"metadata":{"annotations":{"reconcile.fluxcd.io/requestedAt":"%s"}}}`, metav1.Now().Format(time.RFC3339Nano))

		var err error
		var output string

		// Normalize kind to lowercase for case-insensitive comparison
		kind := req.Kind

		// Map of supported Flux resource kinds to their API path
		resourceAPIs := map[string]string{
			"kustomization":   "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/%s/kustomizations/%s",
			"helmrelease":     "/apis/helm.toolkit.fluxcd.io/v2beta1/namespaces/%s/helmreleases/%s",
			"gitrepository":   "/apis/source.toolkit.fluxcd.io/v1/namespaces/%s/gitrepositories/%s",
			"helmrepository":  "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/helmrepositories/%s",
			"helmchart":       "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/helmcharts/%s",
			"ocirepository":   "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/ocirepositories/%s",
			"bucket":          "/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/buckets/%s",
			"alert":           "/apis/notification.toolkit.fluxcd.io/v1beta2/namespaces/%s/alerts/%s",
			"provider":        "/apis/notification.toolkit.fluxcd.io/v1beta2/namespaces/%s/providers/%s",
			"receiver":        "/apis/notification.toolkit.fluxcd.io/v1beta2/namespaces/%s/receivers/%s",
			"imagepolicy":     "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imagepolicies/%s",
			"imagerepository": "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imagerepositories/%s",
			"imageupdate":     "/apis/image.toolkit.fluxcd.io/v1beta1/namespaces/%s/imageupdateautomations/%s",
		}

		// Convert to lowercase for case-insensitive lookup
		apiPath, found := resourceAPIs[kind]
		if !found {
			// Try with first letter capitalized for variants like "Kustomization" vs "kustomization"
			if len(kind) > 0 {
				lowercaseKind := kind
				if 'A' <= kind[0] && kind[0] <= 'Z' {
					lowercaseKind = string(kind[0]+'a'-'A') + kind[1:]
				}

				apiPath, found = resourceAPIs[lowercaseKind]
				if !found {
					return c.JSON(http.StatusBadRequest, map[string]string{
						"error":          fmt.Sprintf("Unsupported Flux resource kind: %s", req.Kind),
						"supportedKinds": "Supported kinds: kustomization, helmrelease, gitrepository, helmrepository, etc.",
					})
				}
				kind = lowercaseKind
			}
		}

		// Patch the resource to trigger reconciliation
		_, err = clientset.
			RESTClient().
			Patch(types.MergePatchType).
			AbsPath(fmt.Sprintf(apiPath, resourceNamespace, resourceName)).
			Body([]byte(patchData)).
			DoRaw(ctx)

		output = fmt.Sprintf("%s %s/%s reconciliation requested", kind, resourceNamespace, resourceName)

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

	// Add endpoint for scaling Kubernetes resources
	s.echo.POST("/api/scale", func(c echo.Context) error {
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
		clientset := s.k8sClient.Clientset

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

	// Add endpoint for describing Kubernetes resources using kubectl describe
	s.echo.GET("/api/describe/:namespace/:kind/:name", func(c echo.Context) error {
		namespace := c.Param("namespace")
		kind := c.Param("kind")
		name := c.Param("name")
		apiVersion := c.QueryParam("apiVersion")

		log.Printf("Describing resource: %s/%s in namespace %s with apiVersion '%s'", kind, name, namespace, apiVersion)

		output, err := s.describeResourceWithKubectl(namespace, kind, name, apiVersion)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to describe resource: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]string{
			"output": output,
		})
	})

	// Kubernetes API proxy endpoints
	// Match all routes starting with /k8s
	s.echo.Any("/k8s*", func(c echo.Context) error {
		return s.k8sProxy.HandleAPIRequest(c)
	})

	// Health check endpoint
	s.echo.GET("/healthz", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
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
func (s *Server) describeResourceWithKubectl(namespace, kind, name, apiVersion string) (string, error) {
	// Create a ConfigFlags struct from the current Kubernetes client config
	configFlags := genericclioptions.NewConfigFlags(true)

	// Set the namespace
	if namespace != "" {
		configFlags.Namespace = &namespace
	}

	// Set other config parameters from our client
	configFlags.Context = &s.k8sClient.CurrentContext
	configFlags.APIServer = &s.k8sClient.Config.Host
	configFlags.BearerToken = &s.k8sClient.Config.BearerToken
	if s.k8sClient.Config.CAFile != "" {
		configFlags.CAFile = &s.k8sClient.Config.CAFile
	}
	configFlags.Insecure = &s.k8sClient.Config.Insecure

	// Create a discovery client
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(s.k8sClient.Config)
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
