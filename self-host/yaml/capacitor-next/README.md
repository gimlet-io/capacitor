# Capacitor Next installation from OCIArtifact

The OCIArtifact is built from the [self-host/yaml/capacitor-next](https://github.com/gimlet-io/capacitor/tree/docs-revamp/self-host/yaml/capacitor-next) folder.

## OCIArtifact

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: capacitor-next-oci
  namespace: flux-system
spec:
  interval: 24h
  url: oci://ghcr.io/gimlet-io/manifests/capacitor-next
  ref:
    # semver: ">= 0.12.0-0" # Adding a `-0` suffix to the semver range will include prerelease versions.
    semver: ">= 0.12.0"
```

## Configuration

### ClusterAdmin access without authentiaction

```bash
kubectl create secret generic capacitor-next \
  --namespace=flux-system \
  --from-literal=LICENSE_KEY="message laszlo at gimlet.io" \
  --from-literal=SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --from-literal=SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)" \
  --from-literal=registry.yaml="clusters:
- id: in-cluster
  name: In-cluster
  apiServerURL: https://kubernetes.default.svc
  certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
  serviceAccount:
    tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token"
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: capacitor-next
  namespace: flux-system
data:
  ##
  ## ClusterAdmin access without authentiaction
  ## For your home lab, local development or testing.
  ## Read https://gimlet.io/capacitor-next/docs/#authorization for more information.
  ##
  AUTH: noauth
  AUTH_DEBUG: "true" #logs impersonation headers
  IMPERSONATE_SA_RULES: "noauth=flux-system:capacitor-next-preset-clusteradmin"
```

### OIDC Authentication

```bash
kubectl create secret generic capacitor-next \
  --namespace=flux-system \
  --from-literal=LICENSE_KEY="message laszlo at gimlet.io" \
  --from-literal=OIDC_CLIENT_SECRET="your-client-secret" \
  --from-literal=SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --from-literal=SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)"
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: capacitor-next
  namespace: flux-system
data:
  ## OIDC Authentication
  ## With per-user defined RBAC.
  ## Read https://gimlet.io/capacitor-next/docs/#authorization:per-user-rbac for more information.
  ##
  AUTH: oidc
  AUTH_DEBUG: "true" #logs impersonation headers
  OIDC_ISSUER: "https://your-oidc-provider.com"
  OIDC_CLIENT_ID: "capacitor"
  OIDC_REDIRECT_URL: "https://capacitor.example.com/auth/callback"
  AUTHORIZED_EMAILS: "*@yourcompany.com"
```

### Static User Authentication

```bash
kubectl create secret generic capacitor-next \
  --namespace=flux-system \
  --from-literal=LICENSE_KEY="message laszlo at gimlet.io" \
  --from-literal=USERS="laszlo@gimlet.io:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG,john@mycompany.com:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG" \
  --from-literal=SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --from-literal=SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)"
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: capacitor-next
  namespace: flux-system
data:
  ## Static User Authentication
  ## With mapping users to impersonate ServiceAccounts
  ## Read https://gimlet.io/capacitor-next/docs/#authorization:serviceaccount-impersonation-for-static-authentication for more information.
  ##
  AUTH: static
  AUTH_DEBUG: "true" #logs impersonation headers
  IMPERSONATE_SA_RULES=laszlo@gimlet.io=flux-system:capacitor-next-preset-clusteradmin,*@mycompany.com:flux-system:capacitor-next-preset-readonly
```

## Deployment

```yaml
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 1h
  prune: true
  wait: true
  sourceRef:
    kind: OCIRepository
    name: capacitor-next-oci
```

## Environment Variables reference

See [Environment Variables reference](https://gimlet.io/capacitor-next/docs/#self-host:environment-variables-reference)

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://gimlet.io/capacitor-next
