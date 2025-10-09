# Self-Host

Self-host for your team. We are running a private beta on the self-hosted version. Please get in contact with laszlo at gimlet.io

## Deploying agents in remote clusters

```yaml
---
apiVersion: v1
kind: Secret
metadata:
  name: capacitor-next-agent
  namespace: flux-system
type: Opaque
stringData:
  BACKEND_WS_URL: "wss://capacitor-next.example.com/agent/connect"
  CLUSTER_ID: "remote-cluster1"
  AGENT_SHARED_SECRET: < run `openssl rand -hex 32`> # use the same shared secret as in the server config
```

```
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 1m
  url: https://github.com/gimlet-io/capacitor
  ref:
    branch: main
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: capacitor-next-agent
  namespace: flux-system
spec:
  interval: 1m
  path: "./self-host/yaml/agent"
  prune: true
  sourceRef:
    kind: GitRepository
    name: capacitor-next
  targetNamespace: flux-system
```
