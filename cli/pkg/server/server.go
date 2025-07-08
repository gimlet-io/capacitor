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
	"k8s.io/client-go/tools/portforward"
	"k8s.io/kubectl/pkg/describe"

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

		// Recreate the Helm client with the new context
		helmClient, err := helm.NewClient(s.k8sClient.Config, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Error recreating Helm client: %v", err),
			})
		}
		s.helmClient = helmClient

		// Update the WebSocket handler with the new clients
		s.wsHandler.UpdateClients(s.k8sClient, s.helmClient)

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

	// Add endpoint for suspending Flux resources
	s.echo.POST("/api/flux/suspend", func(c echo.Context) error {
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
		clientset := s.k8sClient.Clientset

		// Create a context
		ctx := context.Background()

		// Set the suspend field via patch operation
		suspendValue := "true"
		if !req.Suspend {
			suspendValue = "false"
		}

		patchData := fmt.Sprintf(`{"spec":{"suspend":%s}}`, suspendValue)

		var err error
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

	// Add endpoint for diffing Flux Kustomization resources
	s.echo.POST("/api/flux/diff", func(c echo.Context) error {
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

		clientset := s.k8sClient.Clientset
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

		fluxDiffResult, err := s.generateKustomizationDiffWithFluxStyle(ctx, &kustomization)
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

	// Add endpoint for rollout restart of Kubernetes resources
	s.echo.POST("/api/rollout-restart", func(c echo.Context) error {
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
		clientset := s.k8sClient.Clientset

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

	// Add endpoint for Helm release history
	s.echo.GET("/api/helm/history/:namespace/:name", func(c echo.Context) error {
		namespace := c.Param("namespace")
		name := c.Param("name")

		// Get the Helm release history
		releases, err := s.helmClient.GetHistory(c.Request().Context(), name, namespace)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Helm release history: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"releases": releases,
		})
	})

	// Add endpoint for Helm release values
	s.echo.GET("/api/helm/values/:namespace/:name", func(c echo.Context) error {
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

		// Get the Helm release values
		values, err := s.helmClient.GetValues(c.Request().Context(), name, namespace, allValues, revision)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Helm release values: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"values": values,
		})
	})

	// Add endpoint for Helm release manifest
	s.echo.GET("/api/helm/manifest/:namespace/:name", func(c echo.Context) error {
		namespace := c.Param("namespace")
		name := c.Param("name")

		// Parse the revision query parameter if provided
		revision := 0
		if revStr := c.QueryParam("revision"); revStr != "" {
			if rev, err := strconv.Atoi(revStr); err == nil && rev > 0 {
				revision = rev
			}
		}

		// Get the Helm release manifest
		manifest, err := s.helmClient.GetManifest(c.Request().Context(), name, namespace, revision)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("Failed to get Helm release manifest: %v", err),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"manifest": manifest,
		})
	})

	// Add endpoint for Helm release rollback
	s.echo.POST("/api/helm/rollback/:namespace/:name/:revision", func(c echo.Context) error {
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

		// Perform the rollback
		err = s.helmClient.Rollback(c.Request().Context(), name, namespace, revision)
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
	// Match all routes starting with /k8s
	s.echo.Any("/k8s*", func(c echo.Context) error {
		return s.k8sProxy.HandleAPIRequest(c)
	})

	// Health check endpoint
	s.echo.GET("/healthz", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
}

// downloadAndExtractArtifact downloads and extracts a Flux source artifact
func (s *Server) downloadAndExtractArtifact(ctx context.Context, artifactURL string) (string, error) {
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

		localURL, cleanup, err := s.setupSourceControllerPortForward(ctx, artifactURL)
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
func (s *Server) getGitRepository(ctx context.Context, name, namespace string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/apis/source.toolkit.fluxcd.io/v1/namespaces/%s/gitrepositories/%s", namespace, name)
	data, err := s.k8sClient.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getOCIRepository(ctx context.Context, name, namespace string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/ocirepositories/%s", namespace, name)
	data, err := s.k8sClient.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

func (s *Server) getBucket(ctx context.Context, name, namespace string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/%s/buckets/%s", namespace, name)
	data, err := s.k8sClient.Clientset.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	err = json.Unmarshal(data, &resource)
	return resource, err
}

// getResourceFromCluster retrieves a resource from the cluster
func (s *Server) getResourceFromCluster(ctx context.Context, namespace, name, kind string) (map[string]interface{}, error) {
	clientset := s.k8sClient.Clientset

	// Try common resource types first with hardcoded paths for performance
	var apiPath string
	switch strings.ToLower(kind) {
	case "deployment":
		apiPath = fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments/%s", namespace, name)
	case "service":
		apiPath = fmt.Sprintf("/api/v1/namespaces/%s/services/%s", namespace, name)
	case "configmap":
		apiPath = fmt.Sprintf("/api/v1/namespaces/%s/configmaps/%s", namespace, name)
	case "secret":
		apiPath = fmt.Sprintf("/api/v1/namespaces/%s/secrets/%s", namespace, name)
	case "ingress":
		apiPath = fmt.Sprintf("/apis/networking.k8s.io/v1/namespaces/%s/ingresses/%s", namespace, name)
	case "pod":
		apiPath = fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", namespace, name)
	case "replicaset":
		apiPath = fmt.Sprintf("/apis/apps/v1/namespaces/%s/replicasets/%s", namespace, name)
	case "daemonset":
		apiPath = fmt.Sprintf("/apis/apps/v1/namespaces/%s/daemonsets/%s", namespace, name)
	case "statefulset":
		apiPath = fmt.Sprintf("/apis/apps/v1/namespaces/%s/statefulsets/%s", namespace, name)
	case "job":
		apiPath = fmt.Sprintf("/apis/batch/v1/namespaces/%s/jobs/%s", namespace, name)
	case "cronjob":
		apiPath = fmt.Sprintf("/apis/batch/v1/namespaces/%s/cronjobs/%s", namespace, name)
	case "persistentvolumeclaim", "pvc":
		apiPath = fmt.Sprintf("/api/v1/namespaces/%s/persistentvolumeclaims/%s", namespace, name)
	case "serviceaccount":
		apiPath = fmt.Sprintf("/api/v1/namespaces/%s/serviceaccounts/%s", namespace, name)
	case "role":
		apiPath = fmt.Sprintf("/apis/rbac.authorization.k8s.io/v1/namespaces/%s/roles/%s", namespace, name)
	case "rolebinding":
		apiPath = fmt.Sprintf("/apis/rbac.authorization.k8s.io/v1/namespaces/%s/rolebindings/%s", namespace, name)
	case "networkpolicy":
		apiPath = fmt.Sprintf("/apis/networking.k8s.io/v1/namespaces/%s/networkpolicies/%s", namespace, name)
	default:
		// For unknown resource types, try to discover the API path
		discoveredPath, err := s.discoverResourceAPIPath(namespace, name, kind)
		if err != nil {
			return nil, fmt.Errorf("unsupported resource kind '%s' and failed to discover API path: %w", kind, err)
		}
		apiPath = discoveredPath
	}

	data, err := clientset.
		RESTClient().
		Get().
		AbsPath(apiPath).
		DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var resource map[string]interface{}
	if err := json.Unmarshal(data, &resource); err != nil {
		return nil, err
	}

	return resource, nil
}

// discoverResourceAPIPath discovers the API path for a resource using the discovery client
func (s *Server) discoverResourceAPIPath(namespace, name, kind string) (string, error) {
	// Create a discovery client
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(s.k8sClient.Config)
	if err != nil {
		return "", fmt.Errorf("failed to create discovery client: %w", err)
	}

	// Get all API resources
	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil {
		return "", fmt.Errorf("failed to get API resources: %w", err)
	}

	// Search for the resource kind
	for _, apiResourceList := range apiResourceLists {
		for _, apiResource := range apiResourceList.APIResources {
			if strings.EqualFold(apiResource.Kind, kind) {
				// Found the resource, construct the API path
				groupVersion := apiResourceList.GroupVersion

				var apiPath string
				if apiResource.Namespaced {
					if groupVersion == "v1" {
						// Core API group
						apiPath = fmt.Sprintf("/api/v1/namespaces/%s/%s/%s", namespace, apiResource.Name, name)
					} else {
						// Named API group
						apiPath = fmt.Sprintf("/apis/%s/namespaces/%s/%s/%s", groupVersion, namespace, apiResource.Name, name)
					}
				} else {
					// Cluster-scoped resource
					if groupVersion == "v1" {
						apiPath = fmt.Sprintf("/api/v1/%s/%s", apiResource.Name, name)
					} else {
						apiPath = fmt.Sprintf("/apis/%s/%s/%s", groupVersion, apiResource.Name, name)
					}
				}

				log.Printf("Discovered API path for %s: %s", kind, apiPath)
				return apiPath, nil
			}
		}
	}

	return "", fmt.Errorf("resource kind '%s' not found in cluster", kind)
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

	// Set the kubeconfig path from the server's config
	if s.config.KubeConfigPath != "" {
		configFlags.KubeConfig = &s.config.KubeConfigPath
	}

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

// setupSourceControllerPortForward sets up port-forwarding to the source-controller
func (s *Server) setupSourceControllerPortForward(ctx context.Context, artifactURL string) (string, func(), error) {
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
	pods, err := s.k8sClient.Clientset.CoreV1().Pods("flux-system").List(ctx, metav1.ListOptions{
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
	req := s.k8sClient.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace("flux-system").
		Name(podName).
		SubResource("portforward")

	// Create SPDY transport
	transport, upgrader, err := spdy.RoundTripperFor(s.k8sClient.Config)
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

// generateKustomizationDiffWithFluxStyle generates a diff using the actual FluxCD Builder and Diff functionality
func (s *Server) generateKustomizationDiffWithFluxStyle(ctx context.Context, kustomization *kustomizev1.Kustomization) ([]FluxDiffResult, error) {
	log.Printf("Generating FluxCD diff for Kustomization %s/%s using actual FluxCD Builder",
		kustomization.ObjectMeta.Namespace,
		kustomization.ObjectMeta.Name,
	)

	sourceNamespace := kustomization.ObjectMeta.Namespace
	if kustomization.Spec.SourceRef.Namespace != "" {
		sourceNamespace = kustomization.Spec.SourceRef.Namespace
	}

	// Step 1: Download and extract the source artifact to a temporary directory
	tempDir, err := s.getSourceArtifactDirectory(ctx, kustomization, sourceNamespace)
	if err != nil {
		return nil, fmt.Errorf("failed to get source artifact: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Step 2: Create ConfigFlags from our Kubernetes client
	configFlags := &genericclioptions.ConfigFlags{
		APIServer:   &s.k8sClient.Config.Host,
		BearerToken: &s.k8sClient.Config.BearerToken,
		Context:     &s.k8sClient.CurrentContext,
	}
	if s.k8sClient.Config.CAFile != "" {
		configFlags.CAFile = &s.k8sClient.Config.CAFile
	}
	configFlags.Insecure = &s.k8sClient.Config.Insecure

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
func (s *Server) getSourceArtifactDirectory(ctx context.Context, kustomization *kustomizev1.Kustomization, sourceNamespace string) (string, error) {
	// Get the source resource to find the artifact
	var sourceResource map[string]interface{}
	var err error

	switch strings.ToLower(kustomization.Spec.SourceRef.Kind) {
	case "gitrepository":
		sourceResource, err = s.getGitRepository(ctx, kustomization.Spec.SourceRef.Name, sourceNamespace)
	case "ocirepository":
		sourceResource, err = s.getOCIRepository(ctx, kustomization.Spec.SourceRef.Name, sourceNamespace)
	case "bucket":
		sourceResource, err = s.getBucket(ctx, kustomization.Spec.SourceRef.Name, sourceNamespace)
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
	tempDir, err := s.downloadAndExtractArtifact(ctx, artifactURL)
	if err != nil {
		return "", fmt.Errorf("failed to download and extract artifact: %w", err)
	}

	return tempDir, nil
}
