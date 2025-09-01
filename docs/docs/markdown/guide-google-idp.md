# Guide: Self-host with Google OIDC

## 1) Register a Google OAuth App

Create a Google CLIENT ID and secret on https://console.cloud.google.com/apis/credentials

## 2) Deploy Capacitor Next

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
  OIDC_ISSUER: "https://accounts.google.com"
  OIDC_CLIENT_ID: "xxx.apps.googleusercontent.com" # from step 1)
  OIDC_CLIENT_SECRET: "..." from step 1)
  OIDC_REDIRECT_URL: "http://localhost:10081/auth/callback"
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

Your Google IDP identity is assumed by Capacitor Next. If RBAC roles are not directly associated with your user email address in Kubernetes, you can map your identity to any service account in the cluster with `IMPERSONATE_SA_RULES`.

```
  OIDC_ISSUER: "https://accounts.google.com"
  OIDC_CLIENT_ID: "xxx.apps.googleusercontent.com" # from step 1)
  OIDC_CLIENT_SECRET: "..." from step 1)
  OIDC_REDIRECT_URL: "http://localhost:10081/auth/callback"
  IMPERSONATE_SA_RULES: you@company.com=flux-system:capacitor-next-builtin-editor
```

You inherit the RBAC roles from the `flux-system:capacitor-next-builtin-editor` service account. Adjust the RBAC on it if needed.
