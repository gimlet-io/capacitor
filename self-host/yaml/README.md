# Capacitor Next installation from OCIArtifact

The OCIArtifact is built from the [self-host/yaml](https://github.com/gimlet-io/capacitor/tree/docs-revamp/self-host/yaml) folder.

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

**Create the secret**
```bash
kubectl create secret generic capacitor-next \
  --namespace=flux-system \
  --from-literal=LICENSE_KEY="message laszlo at gimlet.io" \
  --from-literal=SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --from-literal=SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)"
```

**Configure the app**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: capacitor-next
  namespace: flux-system
data:
  AUTH: noauth
  AUTH_DEBUG: "true" #logs impersonation headers
  IMPERSONATE_SA_RULES: "noauth=flux-system:capacitor-next-preset-clusteradmin"
```

### OIDC Authentication

### Static User Authentication

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

- See [Environment Variables reference](https://gimlet.io/capacitor-next/docs/#self-host:environment-variables-reference)

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://github.com/gimlet-io/capacitor
