# Capacitor Next Server Helm Chart

This Helm chart deploys the Capacitor Next server - a Kubernetes UI for FluxCD.

## Installation

### Installing with `helm` CLI

```bash
# Add credentials for GitHub Container Registry
export GITHUB_TOKEN=<your-github-token>
echo $GITHUB_TOKEN | helm registry login ghcr.io -u <github-username> --password-stdin

# Install the chart
helm upgrade -i capacitor-next oci://ghcr.io/gimlet-io/charts/capacitor-next \
  --version 2025-12.1 \
  --namespace flux-system \
  --create-namespace \
  --set env.LICENSE_KEY="message laszlo at gimlet.io" \
  --set env.AUTH=noauth \
  --set env.IMPERSONATE_SA_RULES="noauth=flux-system:capacitor-next-preset-clusteradmin" \
  --set env.SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --set env.SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)"
```

### Installing with FluxCD

```bash
kubectl create secret generic capacitor-next \
  --namespace=flux-system \
  --from-literal=LICENSE_KEY="message laszlo at gimlet.io" \
  --from-literal=SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --from-literal=SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)"
```

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 1h
  url: oci://ghcr.io/gimlet-io/charts/capacitor-next
  ref:
    # semver: ">= 0.12.0-0" # Adding a `-0` suffix to the semver range will include prerelease versions.
    semver: ">= 0.12.0"
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 15m
  timeout: 1m
  chartRef:
    kind: OCIRepository
    name: capacitor-next
    namespace: flux-system
  values:
    env:
      AUTH: noauth
      AUTH_DEBUG: true #logs impersonation headers
      IMPERSONATE_SA_RULES: "noauth=flux-system:capacitor-next-preset-clusteradmin"
    existingSecret:
      name: capacitor-next
```

## Configuration

### ClusterAdmin access without authentiaction

```yaml
env:
  LICENSE_KEY: "contact laszlo at gimlet.io"
  
  ##
  ## ClusterAdmin access without authentiaction
  ## For your home lab, local development or testing.
  ## Read https://gimlet.io/capacitor-next/docs/#authorization for more information.
  ##
  AUTH: noauth
  AUTH_DEBUG: true #logs impersonation headers
  IMPERSONATE_SA_RULES: "noauth=flux-system:capacitor-next-preset-clusteradmin"

  SESSION_HASH_KEY:"base64:$(openssl rand -base64 32)"
  SESSION_BLOCK_KEY:"base64:$(openssl rand -base64 32)"
  # Read https://gimlet.io/capacitor-next/docs/#multi-cluster
  registry.yaml: |
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
env:
  LICENSE_KEY: "contact laszlo at gimlet.io"

  ## OIDC Authentication
  ## With per-user defined RBAC.
  ## Read https://gimlet.io/capacitor-next/docs/#authorization:per-user-rbac for more information.
  ##
  AUTH: oidc
  AUTH_DEBUG: true #logs impersonation headers
  OIDC_ISSUER: "https://your-oidc-provider.com"
  OIDC_CLIENT_ID: "capacitor"
  OIDC_CLIENT_SECRET: "your-client-secret"
  OIDC_REDIRECT_URL: "https://capacitor.example.com/auth/callback"
  AUTHORIZED_EMAILS: "*@yourcompany.com"

  SESSION_HASH_KEY:"base64:$(openssl rand -base64 32)"
  SESSION_BLOCK_KEY:"base64:$(openssl rand -base64 32)"
  # Read https://gimlet.io/capacitor-next/docs/#multi-cluster
  registry.yaml: |
    clusters:
    - id: in-cluster
      name: In-cluster
      apiServerURL: https://kubernetes.default.svc
      certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      serviceAccount:
        tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
```

### Static User Authentication

```yaml
env:
  LICENSE_KEY: "contact laszlo at gimlet.io"

  ## Static User Authentication
  ## With mapping users to impersonate ServiceAccounts
  ## Read https://gimlet.io/capacitor-next/docs/#authorization:serviceaccount-impersonation-for-static-authentication for more information.
  ##
  AUTH: static
  AUTH_DEBUG: true #logs impersonation headers
  USERS="laszlo@gimlet.io:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG,john@mycompany.com:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG]"
  IMPERSONATE_SA_RULES=laszlo@gimlet.io=flux-system:capacitor-next-preset-clusteradmin,*@mycompany.com:flux-system:capacitor-next-preset-readonly

  SESSION_HASH_KEY:"base64:$(openssl rand -base64 32)"
  SESSION_BLOCK_KEY:"base64:$(openssl rand -base64 32)"
  # Read https://gimlet.io/capacitor-next/docs/#multi-cluster
  registry.yaml: |
    clusters:
    - id: in-cluster
      name: In-cluster
      apiServerURL: https://kubernetes.default.svc
      certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      serviceAccount:
        tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
```

### Using an Existing Secret

You can use an existing Kubernetes secret to provide the env vars.


When `existingSecret.name` is specified, both the chart environment variables from `env` and the existing secretare loaded. The existing secret is loaded last, allowing it to override values from the `env` value, if they share the same keys:

```yaml
env:
  LICENSE_KEY: "overwritten from existing secret"

  AUTH: oidc
  AUTH_DEBUG: true #logs impersonation headers
  OIDC_ISSUER: "https://your-oidc-provider.com"
  OIDC_CLIENT_ID: "capacitor"
  OIDC_CLIENT_SECRET:  "overwritten from existing secret"
  OIDC_REDIRECT_URL: "https://capacitor.example.com/auth/callback"
  AUTHORIZED_EMAILS: "*@yourcompany.com"

  SESSION_HASH_KEY: "overwritten from existing secret"
  SESSION_BLOCK_KEY: "overwritten from existing secret"

# The chart will create its configmap with all configuration
# AND use your existing secret for additional/override values
existingSecret:
  name: capacitor-secrets-from-external-secrets-operator
```

## Values Reference

See [values.yaml](./values.yaml) for all available configuration options.

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image repository | `ghcr.io/gimlet-io/capacitor-next` |
| `image.tag` | Container image tag | `v2025-10.1` |
| `replicaCount` | Number of replicas | `1` |
| `env` | Environment variables to configure all aspects of Capacitor Next | `""` |
| `existingSecret.name` | Name of existing secret to use in addition to built-in secret | `""` |
| `ingress.enabled` | Enable ingress | `false` |

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://github.com/gimlet-io/capacitor
