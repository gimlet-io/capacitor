# Changelog

All notable changes to the Capacitor Server Helm chart will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-31

### Added
- Initial release of Capacitor Server Helm chart
- Support for three authentication methods: OIDC, noauth, and static
- Comprehensive RBAC configuration with impersonation support
- Built-in editor role with FluxCD permissions
- Multi-cluster support via agent configuration
- Ingress configuration with TLS support
- Azure Workload Identity support
- Configurable resource limits and requests
- Health probes (liveness and readiness)
- Service account creation and management
- Secret management for sensitive configuration
- Cluster registry configuration via values
- Support for custom node selectors, tolerations, and affinity rules

### Security
- Session encryption with configurable hash and block keys
- OIDC authentication with support for groups and custom scopes
- Service account impersonation for granular RBAC control
- TLS support for ingress

### Documentation
- Comprehensive README with installation instructions
- Example values files for common scenarios:
  - Local development (no auth)
  - OIDC authentication
  - Static user authentication
  - Multi-cluster setup
  - Azure Workload Identity
- Publishing guide for GitHub Container Registry
- Troubleshooting section

### Configuration
- 60+ configurable values via values.yaml
- Support for environment-specific configurations
- Flexible cluster registry configuration
- Customizable RBAC policies

[0.1.0]: https://github.com/gimlet-io/capacitor/releases/tag/helm-server-v0.1.0

