package server

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/gimlet-io/capacitor/pkg/config"
	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

// Server represents the API server
type Server struct {
	echo      *echo.Echo
	config    *config.Config
	k8sClient *kubernetes.Client
	wsHandler *WebSocketHandler
	k8sProxy  *KubernetesProxy
	embedFS   fs.FS // embedded file system for static files
}

// New creates a new server instance
func New(cfg *config.Config, k8sClient *kubernetes.Client) (*Server, error) {
	// Create the echo instance
	e := echo.New()

	// Create WebSocket handler
	wsHandler := NewWebSocketHandler(k8sClient)

	// Create Kubernetes proxy
	k8sProxy, err := NewKubernetesProxy(k8sClient)
	if err != nil {
		return nil, fmt.Errorf("error creating kubernetes proxy: %w", err)
	}

	return &Server{
		echo:      e,
		config:    cfg,
		k8sClient: k8sClient,
		wsHandler: wsHandler,
		k8sProxy:  k8sProxy,
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

// Start starts the server
func (s *Server) Start() error {
	address := fmt.Sprintf("%s:%d", s.config.Address, s.config.Port)
	return s.echo.Start(address)
}

// Shutdown gracefully shuts down the server
func (s *Server) Shutdown(ctx context.Context) error {
	return s.echo.Shutdown(ctx)
}
