# Guide: Self-host on k3d without authentication

## Deploy Capacitor Next

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

### Visit the app

```
kubectl port-forward -n flux-system svc/capacitor-next 10081:80
```

[http://localhost:10081](http://localhost:10081)

### Adjust RBAC if needed

You inherit the RBAC roles from the `flux-system:capacitor-next-builtin-editor` service account. Adjust the RBAC on it if needed. ([Source](https://github.com/gimlet-io/capacitor/blob/main/self-host/yaml/role-builtin-editor.yaml))
