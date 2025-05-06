package main

import (
	"context"
	"log"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gimlet-io/capacitor/pkg/config"
	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/gimlet-io/capacitor/pkg/server"
)

func main() {
	// Load configuration
	cfg := config.New()
	cfg.Parse()

	// Create Kubernetes client
	log.Println("Creating Kubernetes client...")
	k8sClient, err := kubernetes.NewClient(cfg.KubeConfigPath, cfg.InCluster, cfg.InsecureSkipTLSVerify)
	if err != nil {
		log.Fatalf("Error creating Kubernetes client: %v", err)
	}

	// Log information about the Kubernetes API server
	if apiURL, err := url.Parse(k8sClient.Config.Host); err == nil {
		log.Printf("Connected to Kubernetes API server: %s", apiURL.String())
	} else {
		log.Printf("Connected to Kubernetes API server: %s", k8sClient.Config.Host)
	}

	log.Printf("Using kubeconfig: %s", cfg.KubeConfigPath)
	log.Printf("Using context: %s", k8sClient.CurrentContext)

	// Create server
	log.Println("Creating proxy server...")
	srv, err := server.New(cfg, k8sClient)
	if err != nil {
		log.Fatalf("Error creating server: %v", err)
	}

	// Setup routes
	srv.Setup()

	// Start server in a goroutine
	go func() {
		log.Printf("Starting server on %s:%d...", cfg.Address, cfg.Port)
		if err := srv.Start(); err != nil {
			log.Printf("Error starting server: %v", err)
		}
	}()

	log.Printf("Server started on %s:%d", cfg.Address, cfg.Port)
	log.Printf("Kubernetes proxy available at http://%s:%d/k8s", cfg.Address, cfg.Port)
	log.Printf("WebSocket endpoint available at ws://%s:%d/ws", cfg.Address, cfg.Port)
	if cfg.InsecureSkipTLSVerify {
		log.Printf("WARNING: TLS certificate verification is disabled. This is insecure and should only be used for development.")
	}

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Create context with timeout for shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Shutdown gracefully
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Error during server shutdown: %v", err)
	}

	log.Println("Server stopped")
}
