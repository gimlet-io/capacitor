# Capacitor Server Helm Chart

This Helm chart deploys the Capacitor Next server - a Kubernetes UI for FluxCD.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.8+
- FluxCD installed in the cluster (recommended)

## Installation

### Installing from OCI Registry (GitHub Packages)

```bash
# Add credentials for GitHub Container Registry
export GITHUB_TOKEN=<your-github-token>
echo $GITHUB_TOKEN | helm registry login ghcr.io -u <github-username> --password-stdin

# Install the chart
helm upgrade -i capacitor-next oci://ghcr.io/gimlet-io/charts/capacitor-next \
  --version 2025-10.2-rc7-rc7-rc7 \
  --namespace flux-system \
  --create-namespace \
  --set license.key="your-license-key" \
  --set session.hashKey="base64:$(openssl rand -base64 32)" \
  --set session.blockKey="base64:$(openssl rand -base64 32)"
```

### Installing from Local Chart

```bash
helm upgrade -i capacitor-next ./capacitor-next \
  --version 2025-10.2-rc7-rc7-rc7 \
  --namespace flux-system \
  --create-namespace \
  --set license.key="your-license-key" \
  --set session.hashKey="base64:$(openssl rand -base64 32)" \
  --set session.blockKey="base64:$(openssl rand -base64 32)"
```

## Configuration

### Minimal Configuration (No Auth)

For local development or testing:

```yaml
license:
  key: "contact laszlo@gimlet.io"

auth:
  method: noauth

authorization:
  impersonateSaRules: "noauth=flux-system:capacitor-next-builtin-editor"

session:
  hashKey: "base64:YOUR_GENERATED_KEY"
  blockKey: "base64:YOUR_GENERATED_KEY"

clusters:
  - id: in-cluster
    name: In-cluster
    apiServerURL: https://kubernetes.default.svc
    certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    serviceAccount:
      tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
```

### OIDC Authentication

```yaml
license:
  key: "your-license-key"

auth:
  method: oidc
  oidc:
    issuer: "https://your-oidc-provider.com"
    clientId: "capacitor"
    clientSecret: "your-client-secret"
    redirectUrl: "https://capacitor.example.com/auth/callback"
    authorizedEmails: "*@yourcompany.com"

authorization:
  impersonateSaRules: "*@yourcompany.com=flux-system:capacitor-next-builtin-editor"

session:
  hashKey: "base64:YOUR_GENERATED_KEY"
  blockKey: "base64:YOUR_GENERATED_KEY"

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: capacitor.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: capacitor-tls
      hosts:
        - capacitor.example.com
```

### Static User Authentication

```yaml
license:
  key: "your-license-key"

auth:
  method: static
  static:
    # Generate with: htpasswd -bnBC 12 x 'mypassword' | cut -d: -f2
    users: "admin@example.com:$2y$12$..."

authorization:
  impersonateSaRules: "admin@example.com=flux-system:capacitor-next-builtin-editor"

session:
  hashKey: "base64:YOUR_GENERATED_KEY"
  blockKey: "base64:YOUR_GENERATED_KEY"
```

### Multi-Cluster with Agents

```yaml
clusters:
  - id: in-cluster
    name: Main Cluster
    apiServerURL: https://kubernetes.default.svc
    certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    serviceAccount:
      tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
  
  - id: prod-cluster
    name: Production
    agent: true
    agentSecret: "your-shared-secret-here"  # openssl rand -hex 32
  
  - id: staging-cluster
    name: Staging
    agent: true
    agentSecret: "another-shared-secret-here"
```

## Values Reference

See [values.yaml](./values.yaml) for all available configuration options.

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image repository | `ghcr.io/gimlet-io/capacitor-next` |
| `image.tag` | Container image tag | `v2025-10.1` |
| `replicaCount` | Number of replicas | `1` |
| `license.key` | License key (required) | `""` |
| `auth.method` | Authentication method: `oidc`, `noauth`, `static` | `noauth` |
| `session.hashKey` | Session hash key (required) | `""` |
| `session.blockKey` | Session block key (required) | `""` |
| `ingress.enabled` | Enable ingress | `false` |
| `rbac.create` | Create RBAC resources | `true` |

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://github.com/gimlet-io/capacitor
