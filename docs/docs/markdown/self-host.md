# Self-Host

Capacitor Next is a local-first Kubernetes client as described in [Quickstart](#quickstart). But you can also self-host it for your team on a URL.

You can do this for
- convenience (easier to distribute),
- or you want to provide read-only access to people without cluster access,
- you are building a platform.

I am running a private beta on the self-hosted version. Please get in touch on laszlo at gimlet.io to join the beta.

## License

The local-first version is Apache 2.0

The self-hosted version is the same app but wrapped in a backend and you can host it on a URL for your team. The wrapper is not open-source at this point.

The local and self-hosted version share the same features and codebase. The self-hosted one has other non-functional things that teams care about:
- OIDC impersonation
- read-only mode.

The self-hosted version may become source available and paid once the beta is over.

If you want to run it for your team on a URL get in touch on laszlo at gimlet.io. There are more than 60 companies in the beta and it proven to be an efficient way to incorporate feedback into Capacitor.

## Deployment: Helm

- [capacitor-next](https://github.com/gimlet-io/capacitor/tree/main/self-host/charts/capacitor-next)
- [capacitor-next-agent](https://github.com/gimlet-io/capacitor/tree/main/self-host/charts/capacitor-next-agent)

## Deployment: HelmRelease


## Deployment: yaml

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
  # Optional: configure default system views shown in the UI
  # The value must be valid JSON (can be multi-line). Using a literal block scalar is recommended:
  SYSTEM_VIEWS: |
    [
      {
        "id": "pods",
        "label": "Pods",
        "filters": [
          { "name": "ResourceType", "value": "core/Pod" },
          { "name": "Namespace", "value": "flux-system" }
        ]
      }
    ]
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
