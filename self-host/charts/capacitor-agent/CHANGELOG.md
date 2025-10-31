# Changelog

All notable changes to the Capacitor Agent Helm chart will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-31

### Added
- Initial release of Capacitor Agent Helm chart
- WebSocket-based connection to Capacitor Server
- Cluster impersonation support via RBAC
- Configurable resource limits and requests
- Service account creation and management
- Secret management for agent configuration
- Support for custom node selectors, tolerations, and affinity rules
- Automatic reconnection handling

### Security
- Shared secret authentication with server
- Service account impersonation for RBAC control
- Secure WebSocket connections (WSS)

### Configuration
- Simple 3-value configuration (URL, cluster ID, shared secret)
- Customizable resource limits
- Flexible deployment options

### Documentation
- Comprehensive README with installation instructions
- Example values file for production deployment
- Complete setup guide with server configuration
- Troubleshooting section
- Connection verification steps

[0.1.0]: https://github.com/gimlet-io/capacitor/releases/tag/helm-agent-v0.1.0

