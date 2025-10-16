// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

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
	InsecureSkipTLSVerify bool
}

// New returns a new configuration with sensible defaults
func New() *Config {
	return &Config{
		Address:               "0.0.0.0",
		Port:                  8080,
		StaticFilesDirectory:  "./web/static",
		KubeConfigPath:        defaultKubeConfigPath(),
		InsecureSkipTLSVerify: false,
		Theme:                 "light",
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
	pflag.StringVarP(&c.Theme, "theme", "t", c.Theme, "UI theme preset (light|dark|mallow) (CAPACITOR_NEXT_THEME)")

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
	if env := os.Getenv("CAPACITOR_NEXT_THEME"); env != "" {
		c.Theme = env
	}
	if env := os.Getenv("CAPACITOR_NEXT_STATIC_DIR"); env != "" {
		c.StaticFilesDirectory = env
	}

	if env := os.Getenv("KUBECONFIG"); env != "" {
		c.KubeConfigPath = env
	}
	if env := os.Getenv("KUBECONFIG_INSECURE_SKIP_TLS_VERIFY"); env == "true" {
		c.InsecureSkipTLSVerify = true
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
