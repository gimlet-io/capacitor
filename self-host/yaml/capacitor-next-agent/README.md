# Capacitor Next installation from OCIArtifact

The OCIArtifact is built from the [self-host/yaml/capacitor-next-agent](https://github.com/gimlet-io/capacitor/tree/docs-revamp/self-host/yaml/capacitor-next-agent) folder.

## OCIArtifact

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: capacitor-next-agent-oci
  namespace: flux-system
spec:
  interval: 24h
  url: oci://ghcr.io/gimlet-io/manifests/capacitor-next-agent
  ref:
    # semver: ">= 0.12.0-0" # Adding a `-0` suffix to the semver range will include prerelease versions.
    semver: ">= 0.12.0"
```

## Configuration

Before deploying the agent, you must configure the cluster in your Capacitor server:

```yaml
# In the server configmap
registry.yaml: |
  clusters:
    ...
    - id: production-cluster  # Must match CLUSTER_ID
      name: Production
      agent: true
      agentSecret: "your-shared-secret-here"  # Must match AGENT_SHARED_SECRET
```

```bash
kubectl create secret generic capacitor-next-agent \
  --namespace=flux-system \
  --from-literal=AGENT_SHARED_SECRET="your-shared-secret-here" # openssl rand -hex 32
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: capacitor-next-agent
  namespace: flux-system
data:
  BACKEND_WS_URL: "wss://capacitor.example.com/agent/connect"
  CLUSTER_ID: "production-cluster" 
```

## Deployment

```yaml
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: capacitor-next-agent
  namespace: flux-system
spec:
  interval: 1h
  prune: true
  wait: true
  sourceRef:
    kind: OCIRepository
    name: capacitor-next-agent-oci
```

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://gimlet.io/capacitor-next
