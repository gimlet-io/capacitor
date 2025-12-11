# Guide: Self-host with Google OIDC

## 1) Register a Google OAuth App

Create a Google CLIENT ID and secret on [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)

## 2) Deploy Capacitor Next

You can deploy Capacitor Next into your cluster either with Flux and the published OCI manifests, or with the Helm chart.

### Option 1: Deploy with Flux and the OCIArtifact

Secret with Google OIDC and session keys:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: capacitor-next
  namespace: flux-system
type: Opaque
stringData:
  LICENSE_KEY: "contact laszlo at gimlet.io"
  OIDC_CLIENT_SECRET: "<CLIENT_SECRET_FROM_STEP_1>"
  SESSION_HASH_KEY: "base64:< run `openssl rand -base64 32`>"
  SESSION_BLOCK_KEY: "base64:< run `openssl rand -base64 32` again>"
```

ConfigMap for Google OIDC configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: capacitor-next
  namespace: flux-system
data:
  ## OIDC Authentication with Google as IDP
  ## With per-user defined RBAC.
  ## Read https://gimlet.io/capacitor-next/docs/#authorization:per-user-rbac for more information.
  ##
  AUTH: oidc
  AUTH_DEBUG: "true" # logs impersonation headers
  OIDC_ISSUER: "https://accounts.google.com"
  OIDC_CLIENT_ID: "<CLIENT_ID_FROM_STEP_1>.apps.googleusercontent.com"
  OIDC_REDIRECT_URL: "http://localhost:10081/auth/callback"
  AUTHORIZED_EMAILS: "youremail@company.com[,*@company.com]"
  registry.yaml: |
    clusters:
      - id: in-cluster
        name: In-cluster
        apiServerURL: https://kubernetes.default.svc
        certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        serviceAccount:
          tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
```

Flux OCIRepository and Kustomization

Deploy the manifests to the `flux-system` namespace using Flux and the published OCIArtifact:

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 24h
  url: oci://ghcr.io/gimlet-io/manifests/capacitor-next
  ref:
    # semver: ">= 0.12.0-0" # Adding a `-0` suffix to the semver range will include prerelease versions.
    semver: ">= 0.12.0"
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 1h
  prune: true
  sourceRef:
    kind: OCIRepository
    name: capacitor-next
```

### Option 2: Deploy with the Helm chart

As an alternative to Flux with the OCI manifests, you can use the published Helm chart with Google as the OIDC provider:

```bash
# Add credentials for GitHub Container Registry
export GITHUB_TOKEN=<your-github-token>
echo $GITHUB_TOKEN | helm registry login ghcr.io -u <github-username> --password-stdin

# Install the chart with Google OIDC
helm upgrade -i capacitor-next oci://ghcr.io/gimlet-io/charts/capacitor-next \
  --version 0.12.0 \
  --namespace flux-system \
  --create-namespace \
  --set env.LICENSE_KEY="contact laszlo at gimlet.io" \
  --set env.AUTH=oidc \
  --set env.AUTH_DEBUG=true \
  --set env.OIDC_ISSUER="https://accounts.google.com" \
  --set env.OIDC_CLIENT_ID="<CLIENT_ID_FROM_STEP_1>.apps.googleusercontent.com" \
  --set env.OIDC_CLIENT_SECRET="<CLIENT_SECRET_FROM_STEP_1>" \
  --set env.OIDC_REDIRECT_URL="http://localhost:10081/auth/callback" \
  --set env.AUTHORIZED_EMAILS="youremail@company.com[,*@company.com]" \
  --set env.SESSION_HASH_KEY="base64:$(openssl rand -base64 32)" \
  --set env.SESSION_BLOCK_KEY="base64:$(openssl rand -base64 32)"
```

### Visit the app

```bash
kubectl port-forward -n flux-system svc/capacitor-next 10081:80
```

[http://localhost:10081](http://localhost:10081)

### Adjust RBAC if needed

Your Google IDP identity is assumed by Capacitor Next. If RBAC roles are not directly associated with your user email address in Kubernetes, you can map your identity to any service account in the cluster with `IMPERSONATE_SA_RULES`.

```yaml
  OIDC_ISSUER: "https://accounts.google.com"
  OIDC_CLIENT_ID: "<CLIENT_ID_FROM_STEP_1>.apps.googleusercontent.com"
  OIDC_CLIENT_SECRET: "<CLIENT_SECRET_FROM_STEP_1>"
  OIDC_REDIRECT_URL: "http://localhost:10081/auth/callback"
  IMPERSONATE_SA_RULES: you@company.com=flux-system:capacitor-next-builtin-editor
```

You inherit the RBAC roles from the `flux-system:capacitor-next-preset-editor` service account. Adjust the RBAC on it if needed. ([Source](https://github.com/gimlet-io/capacitor/blob/main/self-host/yaml/rbac-preset-editor.yaml))
