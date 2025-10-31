# Capacitor Agent Helm Chart

This Helm chart deploys the Capacitor Agent in remote clusters to enable multi-cluster management with Capacitor Next.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.8+
- A running Capacitor Server with agent configuration

## Installation

### Installing from OCI Registry (GitHub Packages)

```bash
# Add credentials for GitHub Container Registry
export GITHUB_TOKEN=<your-github-token>
echo $GITHUB_TOKEN | helm registry login ghcr.io -u <github-username> --password-stdin

# Install the chart
helm install capacitor-agent oci://ghcr.io/gimlet-io/charts/capacitor-agent \
  --version 0.1.0 \
  --namespace flux-system \
  --create-namespace \
  --set agent.backendWsUrl="wss://capacitor.example.com/agent/connect" \
  --set agent.clusterId="my-cluster" \
  --set agent.agentSharedSecret="your-shared-secret"
```

### Installing from Local Chart

```bash
helm install capacitor-agent ./capacitor-agent \
  --namespace flux-system \
  --create-namespace \
  --set agent.backendWsUrl="wss://capacitor.example.com/agent/connect" \
  --set agent.clusterId="my-cluster" \
  --set agent.agentSharedSecret="your-shared-secret"
```

## Configuration

### Basic Configuration

```yaml
agent:
  backendWsUrl: "wss://capacitor.example.com/agent/connect"
  clusterId: "production-cluster"
  agentSharedSecret: "your-shared-secret-here"  # openssl rand -hex 32
```

### Custom Resources

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

### Node Selection

```yaml
nodeSelector:
  role: monitoring

tolerations:
  - key: "monitoring"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"

affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: role
          operator: In
          values:
          - monitoring
```

## Server Configuration

Before deploying the agent, you must configure the cluster in your Capacitor server:

```yaml
# In the server's values.yaml
clusters:
  - id: production-cluster  # Must match agent.clusterId
    name: Production
    agent: true
    agentSecret: "your-shared-secret-here"  # Must match agent.agentSharedSecret
```

## Complete Setup Example

### 1. Generate a Shared Secret

```bash
openssl rand -hex 32
# Output: a1b2c3d4e5f6...
```

### 2. Configure the Server

Add to your server's `values.yaml`:

```yaml
clusters:
  - id: prod-east
    name: Production East
    agent: true
    agentSecret: "a1b2c3d4e5f6..."
```

Update your server installation:

```bash
helm upgrade capacitor-server oci://ghcr.io/gimlet-io/charts/capacitor-server \
  --namespace flux-system \
  --reuse-values \
  -f updated-values.yaml
```

### 3. Deploy the Agent

In your remote cluster:

```bash
helm install capacitor-agent oci://ghcr.io/gimlet-io/charts/capacitor-agent \
  --version 0.1.0 \
  --namespace flux-system \
  --create-namespace \
  --set agent.backendWsUrl="wss://capacitor.example.com/agent/connect" \
  --set agent.clusterId="prod-east" \
  --set agent.agentSharedSecret="a1b2c3d4e5f6..."
```

### 4. Verify Connection

Check the agent logs:

```bash
kubectl logs -n flux-system -l app=capacitor-next-agent --tail=50
```

You should see connection success messages.

## Publishing to GitHub Package Registry

### Package the Chart

```bash
# From the self-host directory
helm package capacitor-agent
```

### Push to GitHub Container Registry

```bash
# Login to GitHub Container Registry
export GITHUB_TOKEN=<your-github-token>
echo $GITHUB_TOKEN | helm registry login ghcr.io -u <github-username> --password-stdin

# Push the chart
helm push capacitor-agent-0.1.0.tgz oci://ghcr.io/gimlet-io/charts
```

## Values Reference

See [values.yaml](./values.yaml) for all available configuration options.

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image repository | `ghcr.io/gimlet-io/capacitor-next` |
| `image.tag` | Container image tag | `agent-v2025-10.1` |
| `replicaCount` | Number of replicas | `1` |
| `agent.backendWsUrl` | WebSocket URL to server (required) | `""` |
| `agent.clusterId` | Cluster identifier (required) | `""` |
| `agent.agentSharedSecret` | Shared secret for authentication (required) | `""` |
| `rbac.create` | Create RBAC resources | `true` |

## Troubleshooting

### Agent Not Connecting

1. Check the agent logs:
   ```bash
   kubectl logs -n flux-system -l app=capacitor-next-agent
   ```

2. Verify the WebSocket URL is accessible from the cluster:
   ```bash
   kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
     curl -v -H "Upgrade: websocket" https://capacitor.example.com/agent/connect
   ```

3. Ensure the shared secret matches between server and agent

4. Check network policies and firewall rules

### Permission Errors

The agent needs impersonation permissions. Verify RBAC is created:

```bash
kubectl get clusterrole,clusterrolebinding -l app.kubernetes.io/name=capacitor-agent
```

## Upgrading

```bash
helm upgrade capacitor-agent oci://ghcr.io/gimlet-io/charts/capacitor-agent \
  --version 0.1.0 \
  --namespace flux-system \
  --reuse-values
```

## Uninstalling

```bash
helm uninstall capacitor-agent --namespace flux-system
```

## Support

For support and licensing inquiries, contact: laszlo@gimlet.io

For more information, visit: https://github.com/gimlet-io/capacitor

