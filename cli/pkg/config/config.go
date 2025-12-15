// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/pflag"
)

// Config holds the main application configuration
type Config struct {
	// Server settings
	Address              string
	Port                 int
	StaticFilesDirectory string
	AccessLogEnabled     bool

	// Kubernetes settings
	KubeConfigPath        string
	InsecureSkipTLSVerify bool

	// FluxCD controller settings (used for logs and controller discovery)
	FluxCD FluxCDConfig

	// Carvel kapp-controller settings (used for logs and controller discovery)
	Carvel CarvelConfig
}

// FluxCDConfig holds configuration for FluxCD controllers and namespace.
// These values can be customized via environment variables:
//   - FLUXCD_NAMESPACE
//   - FLUXCD_HELM_CONTROLLER_NAME
//   - FLUXCD_HELM_CONTROLLER_LABEL_KEY
//   - FLUXCD_HELM_CONTROLLER_LABEL_VALUE
//   - FLUXCD_KUSTOMIZE_CONTROLLER_NAME
//   - FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_KEY
//   - FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_VALUE
type FluxCDConfig struct {
	Namespace string

	HelmControllerDeploymentName      string
	HelmControllerLabelKey            string
	HelmControllerLabelValue          string
	KustomizeControllerDeploymentName string
	KustomizeControllerLabelKey       string
	KustomizeControllerLabelValue     string
}

// CarvelConfig holds configuration for Carvel kapp-controller.
// These values can be customized via environment variables:
//   - CARVEL_NAMESPACE
//   - CARVEL_KAPP_CONTROLLER_NAME
//   - CARVEL_KAPP_CONTROLLER_LABEL_KEY
//   - CARVEL_KAPP_CONTROLLER_LABEL_VALUE
type CarvelConfig struct {
	Namespace                    string
	KappControllerDeploymentName string
	KappControllerLabelKey       string
	KappControllerLabelValue     string
}

// New returns a new configuration with sensible defaults
func New() *Config {
	return &Config{
		Address:               "0.0.0.0",
		Port:                  8080,
		StaticFilesDirectory:  "./web/static",
		AccessLogEnabled:      false,
		KubeConfigPath:        defaultKubeConfigPath(),
		InsecureSkipTLSVerify: false,
		FluxCD: FluxCDConfig{
			Namespace:                         "flux-system",
			HelmControllerDeploymentName:      "helm-controller",
			HelmControllerLabelKey:            "app.kubernetes.io/component",
			HelmControllerLabelValue:          "helm-controller",
			KustomizeControllerDeploymentName: "kustomize-controller",
			KustomizeControllerLabelKey:       "app.kubernetes.io/component",
			KustomizeControllerLabelValue:     "kustomize-controller",
		},
		Carvel: CarvelConfig{
			Namespace:                    "kapp-controller",
			KappControllerDeploymentName: "kapp-controller",
			KappControllerLabelKey:       "app",
			KappControllerLabelValue:     "kapp-controller",
		},
	}
}

// Parse processes command line arguments and environment variables
func (c *Config) Parse() {
	// Command line arguments
	pflag.StringVarP(&c.Address, "host", "h", c.Address, "Host to listen on (CAPACITOR_NEXT_HOST)")
	pflag.IntVarP(&c.Port, "port", "p", c.Port, "Port to listen on (CAPACITOR_NEXT_PORT)")
	pflag.StringVar(&c.StaticFilesDirectory, "static-dir", c.StaticFilesDirectory, "Directory containing static files to serve (dev purposes only)")
	pflag.StringVar(&c.KubeConfigPath, "kubeconfig", c.KubeConfigPath, "Path to kubeconfig file (KUBECONFIG)")
	pflag.BoolVar(&c.InsecureSkipTLSVerify, "insecure-skip-tls-verify", c.InsecureSkipTLSVerify, "Skip TLS certificate verification (insecure, use only for development) (KUBECONFIG_INSECURE_SKIP_TLS_VERIFY)")
	pflag.BoolVar(&c.AccessLogEnabled, "access-log", c.AccessLogEnabled, "Enable HTTP/WebSocket access logging (ACCESS_LOG_ENABLED)")

	pflag.Parse()

	// Environment variables override command line flags
	if env := os.Getenv("CAPACITOR_NEXT_HOST"); env != "" {
		c.Address = env
	}
	if env := os.Getenv("CAPACITOR_NEXT_PORT"); env != "" {
		if port, err := strconv.Atoi(env); err == nil {
			c.Port = port
		}
	}
	if env := os.Getenv("CAPACITOR_NEXT_STATIC_DIR"); env != "" {
		c.StaticFilesDirectory = env
	}

	// Optional: access log toggle
	// ACCESS_LOG_ENABLED can be set to "false" or "0" to disable it.
	if v := os.Getenv("ACCESS_LOG_ENABLED"); v != "" {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true", "1":
			c.AccessLogEnabled = true
		default:
			c.AccessLogEnabled = false
		}
	}

	if env := os.Getenv("KUBECONFIG"); env != "" {
		c.KubeConfigPath = env
	}
	if env := os.Getenv("KUBECONFIG_INSECURE_SKIP_TLS_VERIFY"); env == "true" {
		c.InsecureSkipTLSVerify = true
	}

	// FluxCD configuration from environment variables (override defaults when set)
	if env := os.Getenv("FLUXCD_NAMESPACE"); env != "" {
		c.FluxCD.Namespace = env
	}
	if env := os.Getenv("FLUXCD_HELM_CONTROLLER_NAME"); env != "" {
		c.FluxCD.HelmControllerDeploymentName = env
	}
	if env := os.Getenv("FLUXCD_HELM_CONTROLLER_LABEL_KEY"); env != "" {
		c.FluxCD.HelmControllerLabelKey = env
	}
	if env := os.Getenv("FLUXCD_HELM_CONTROLLER_LABEL_VALUE"); env != "" {
		c.FluxCD.HelmControllerLabelValue = env
	}
	if env := os.Getenv("FLUXCD_KUSTOMIZE_CONTROLLER_NAME"); env != "" {
		c.FluxCD.KustomizeControllerDeploymentName = env
	}
	if env := os.Getenv("FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_KEY"); env != "" {
		c.FluxCD.KustomizeControllerLabelKey = env
	}
	if env := os.Getenv("FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_VALUE"); env != "" {
		c.FluxCD.KustomizeControllerLabelValue = env
	}

	// Carvel kapp-controller configuration from environment variables (override defaults when set)
	if env := os.Getenv("CARVEL_NAMESPACE"); env != "" {
		c.Carvel.Namespace = env
	}
	if env := os.Getenv("CARVEL_KAPP_CONTROLLER_NAME"); env != "" {
		c.Carvel.KappControllerDeploymentName = env
	}
	if env := os.Getenv("CARVEL_KAPP_CONTROLLER_LABEL_KEY"); env != "" {
		c.Carvel.KappControllerLabelKey = env
	}
	if env := os.Getenv("CARVEL_KAPP_CONTROLLER_LABEL_VALUE"); env != "" {
		c.Carvel.KappControllerLabelValue = env
	}
}

// defaultKubeConfigPath returns the default path to the kubeconfig file
func defaultKubeConfigPath() string {
	if home := homeDir(); home != "" {
		return filepath.Join(home, ".kube", "config")
	}
	return ""
}

// homeDir returns the user's home directory
func homeDir() string {
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return os.Getenv("USERPROFILE") // Windows
}
