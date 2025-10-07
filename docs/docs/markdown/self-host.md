# Self-Host

Self-host for your team. We are running a private beta on the self-hosted version. Please get in contact with laszlo at gimlet.io

## Deployment

### Service Account

```
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: capacitor-next
  namespace: flux-system
```

### Secrets

```
apiVersion: v1
kind: Secret
metadata:
  name: capacitor-next
  namespace: flux-system
type: Opaque
stringData:
  LICENSE_KEY: "contact laszlo at gimlet.io"
  AUTH: noauth
  IMPERSONATE_SA_RULES: noauth=flux-system:capacitor-next-builtin-editor
  SESSION_HASH_KEY: "base64:< run `openssl rand -base64 32`>"
  SESSION_BLOCK_KEY: "base64:< same value as the line before>"
  registry.yaml: |
    clusters:
      - id: in-cluster
        name: In-cluster
        apiServerURL: https://kubernetes.default.svc
        certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        serviceAccount:
          tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
```

### Definining clusters

```
clusters:
    clusters:
      - id: in-cluster
        name: In-cluster
        apiServerURL: https://kubernetes.default.svc
        certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        serviceAccount:
          tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
      - id: remote-cluster1
        name: remote-cluster1
        agent: true
        agentSecret: < run `openssl rand -hex 32`> # use the same shared secret in the agent deployment
      - id: remote-cluster2
        name: remote-cluster2
        agent: true
        agentSecret: < run `openssl rand -hex 32`> # use the same shared secret in the agent deployment
```

### Deploy the yamls to the flux-system namespace.

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
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 1m
  path: "./self-host/yaml"
  prune: true
  sourceRef:
    kind: GitRepository
    name: capacitor-next
  targetNamespace: flux-system
```
