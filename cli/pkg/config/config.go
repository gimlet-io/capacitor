package config

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/spf13/pflag"
)

// Config holds the main application configuration
type Config struct {
	// Server settings
	Address              string
	Port                 int
	StaticFilesDirectory string

	// UI settings
	Theme string

	// Kubernetes settings
	KubeConfigPath        string
	InCluster             bool
	InsecureSkipTLSVerify bool
}

// New returns a new configuration with sensible defaults
func New() *Config {
	return &Config{
		Address:               "0.0.0.0",
		Port:                  8080,
		StaticFilesDirectory:  "./web/static",
		KubeConfigPath:        defaultKubeConfigPath(),
		InCluster:             false,
		InsecureSkipTLSVerify: false,
		Theme:                 "light",
	}
}

// Parse processes command line arguments and environment variables
func (c *Config) Parse() {
	// Command line arguments
	pflag.StringVar(&c.Address, "address", c.Address, "Address to listen on")
	pflag.IntVar(&c.Port, "port", c.Port, "Port to listen on")
	pflag.StringVar(&c.StaticFilesDirectory, "static-dir", c.StaticFilesDirectory, "Directory containing static files to serve")
	pflag.StringVar(&c.KubeConfigPath, "kubeconfig", c.KubeConfigPath, "Path to kubeconfig file")
	pflag.BoolVar(&c.InCluster, "in-cluster", c.InCluster, "Use in-cluster configuration")
	pflag.BoolVar(&c.InsecureSkipTLSVerify, "insecure-skip-tls-verify", c.InsecureSkipTLSVerify, "Skip TLS certificate verification (insecure, use only for development)")
	pflag.StringVar(&c.Theme, "theme", c.Theme, "UI theme preset (light|dark|mallow)")

	pflag.Parse()

	// Environment variables override command line flags
	if env := os.Getenv("K8S_PROXY_ADDRESS"); env != "" {
		c.Address = env
	}
	if env := os.Getenv("K8S_PROXY_PORT"); env != "" {
		if port, err := strconv.Atoi(env); err == nil {
			c.Port = port
		}
	}
	if env := os.Getenv("K8S_PROXY_STATIC_DIR"); env != "" {
		c.StaticFilesDirectory = env
	}
	if env := os.Getenv("K8S_PROXY_KUBECONFIG"); env != "" {
		c.KubeConfigPath = env
	}
	if env := os.Getenv("K8S_PROXY_IN_CLUSTER"); env == "true" {
		c.InCluster = true
	}
	if env := os.Getenv("K8S_PROXY_INSECURE_SKIP_TLS_VERIFY"); env == "true" {
		c.InsecureSkipTLSVerify = true
	}
	if env := os.Getenv("K8S_PROXY_THEME"); env != "" {
		c.Theme = env
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
