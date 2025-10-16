// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package kubernetes

import (
	"fmt"
	"log"
	"path/filepath"
	"sort"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/client-go/util/homedir"
)

// Client wraps the Kubernetes client with additional functionality
type Client struct {
	Clientset         *kubernetes.Clientset
	Config            *rest.Config
	CurrentContext    string
	ContextConfig     *api.Context
	AvailableContexts map[string]*api.Context
}

// NewClient creates a new Kubernetes client
func NewClient(kubeconfig string, insecureSkipTLSVerify bool) (*Client, error) {
	var config *rest.Config
	var err error
	var currentContext string
	var contextConfig *api.Context
	var availableContexts map[string]*api.Context

	// Out-of-cluster configuration
	if kubeconfig == "" {
		if home := homedir.HomeDir(); home != "" {
			kubeconfig = filepath.Join(home, ".kube", "config")
		} else {
			return nil, fmt.Errorf("kubeconfig not provided and home directory not found")
		}
	}

	// Load the kubeconfig file directly to access context information
	apiConfig, err := clientcmd.LoadFromFile(kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("error loading kubeconfig file: %w", err)
	}

	// Get current context
	currentContext = apiConfig.CurrentContext
	contextConfig = apiConfig.Contexts[currentContext]
	// Get available contexts
	availableContexts = apiConfig.Contexts

	// Log details about the current context
	log.Printf("Using kubeconfig context: %s", currentContext)
	log.Printf("Cluster: %s, Namespace: %s, User: %s",
		contextConfig.Cluster,
		contextConfig.Namespace,
		contextConfig.AuthInfo)

	// Get the cluster config to check if there's a certificate authority
	clusterConfig := apiConfig.Clusters[contextConfig.Cluster]
	if clusterConfig != nil {
		if clusterConfig.CertificateAuthority != "" {
			log.Printf("Using certificate authority file: %s", clusterConfig.CertificateAuthority)
		} else if len(clusterConfig.CertificateAuthorityData) > 0 {
			log.Printf("Using embedded certificate authority data from kubeconfig")
		}
	}

	// Create config with existing context and optional TLS settings
	configOverrides := &clientcmd.ConfigOverrides{
		CurrentContext: currentContext,
	}

	// Only override TLS verification if explicitly requested
	if insecureSkipTLSVerify {
		configOverrides.ClusterInfo.InsecureSkipTLSVerify = true
	}

	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfig},
		configOverrides,
	)

	// Get namespace from current context
	namespace, _, err := clientConfig.Namespace()
	if err != nil {
		log.Printf("Warning: could not determine namespace from context: %v", err)
	} else {
		log.Printf("Default namespace from context: %s", namespace)
	}

	// Build REST config
	config, err = clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("error building config from kubeconfig: %w", err)
	}

	// Log TLS settings
	log.Printf("TLS Settings - Insecure: %v, CAFile: %s, CAData length: %d",
		config.TLSClientConfig.Insecure,
		config.TLSClientConfig.CAFile,
		len(config.TLSClientConfig.CAData))

	// Create the clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("error creating clientset: %w", err)
	}

	return &Client{
		Clientset:         clientset,
		Config:            config,
		CurrentContext:    currentContext,
		ContextConfig:     contextConfig,
		AvailableContexts: availableContexts,
	}, nil
}

// GetContexts returns the available contexts from the kubeconfig file
// and marks the current active context
type ContextInfo struct {
	Name        string `json:"name"`
	IsCurrent   bool   `json:"isCurrent"`
	Namespace   string `json:"namespace,omitempty"`
	ClusterName string `json:"clusterName,omitempty"`
	User        string `json:"user,omitempty"`
}

func (c *Client) GetContexts() []ContextInfo {
	contexts := make([]ContextInfo, 0, len(c.AvailableContexts))

	for name, ctx := range c.AvailableContexts {
		contextInfo := ContextInfo{
			Name:      name,
			IsCurrent: name == c.CurrentContext,
		}

		if ctx != nil {
			contextInfo.Namespace = ctx.Namespace
			contextInfo.ClusterName = ctx.Cluster
			contextInfo.User = ctx.AuthInfo
		}

		contexts = append(contexts, contextInfo)
	}

	// Order contexts by name for deterministic output
	sort.Slice(contexts, func(i, j int) bool {
		return contexts[i].Name < contexts[j].Name
	})

	return contexts
}

// SwitchContext switches to a different Kubernetes context
func (c *Client) SwitchContext(contextName, kubeConfigPath string) error {
	// Check if the context exists
	ctx, exists := c.AvailableContexts[contextName]
	if !exists {
		return fmt.Errorf("context %s not found", contextName)
	}

	// If we're in-cluster, we can't switch contexts
	if c.CurrentContext == "in-cluster" {
		return fmt.Errorf("cannot switch context when running in-cluster")
	}

	// Create config with new context
	configOverrides := &clientcmd.ConfigOverrides{
		CurrentContext: contextName,
	}

	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeConfigPath},
		configOverrides,
	)

	// Build new REST config
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return fmt.Errorf("error building config from kubeconfig: %w", err)
	}

	// Create new clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("error creating clientset: %w", err)
	}

	// Update client
	c.Clientset = clientset
	c.Config = config
	c.CurrentContext = contextName
	c.ContextConfig = ctx

	log.Printf("Switched to context: %s", contextName)
	if ctx != nil {
		log.Printf("Cluster: %s, Namespace: %s, User: %s",
			ctx.Cluster,
			ctx.Namespace,
			ctx.AuthInfo)
	}

	return nil
}
