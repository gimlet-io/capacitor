# Capacitor Agent Helm Chart

This Helm chart deploys the Capacitor Agent in remote clusters to enable multi-cluster management with Capacitor Next.

## Installation

Before deploying the agent, you must configure the cluster in your Capacitor server:

```yaml
# In the server's values.yaml
env:
  registry.yaml: |
    clusters:
      ...
      - id: production-cluster  # Must match CLUSTER_ID
        name: Production
        agent: true
        agentSecret: "your-shared-secret"  # Must match AGENT_SHARED_SECRET
```

### Installing with `helm` CLI

```bash
# Add credentials for GitHub Container Registry
export GITHUB_TOKEN=<your-github-token>
echo $GITHUB_TOKEN | helm registry login ghcr.io -u <github-username> --password-stdin

# Install the chart
helm upgrade -i capacitor-next-agent oci://ghcr.io/gimlet-io/charts/capacitor-next-agent \
  --version 0.12.1 \
  --namespace flux-system \
  --create-namespace \
  --set env.BACKEND_WS_URL="wss://capacitor.example.com/agent/connect" \
  --set env.CLUSTER_ID="my-cluster" \
  --set env.AGENT_SHARED_SECRET="your-shared-secret"
```

### Installing with FluxCD

```bash
kubectl create secret generic capacitor-next-agent \
  --namespace=flux-system \
  --from-literal=AGENT_SHARED_SECRET="your-shared-secret" # openssl rand -hex 32
```

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: capacitor-next-agent-helm
  namespace: flux-system
spec:
  interval: 24h
  url: oci://ghcr.io/gimlet-io/charts/capacitor-next-agent
  ref:
    # semver: ">= 0.12.0-0" # Adding a `-0` suffix to the semver range will include prerelease versions.
    semver: ">= 0.12.0"
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: capacitor-next-agent
  namespace: flux-system
spec:
  interval: 1h
  timeout: 1m
  chartRef:
    kind: OCIRepository
    name: capacitor-next-agent-helm
    namespace: flux-system
  values:
    env:
      BACKEND_WS_URL: "wss://capacitor.example.com/agent/connect"
      CLUSTER_ID: "production-cluster" 

    # The chart will create its configmap with all configuration
    # AND use your existing secret for additional/override values
    existingSecret:
      name: capacitor-next-agent
```

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://gimlet.io/capacitor-next
