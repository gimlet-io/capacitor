# Self-host on AKS with Workload Identity

- Run Capacitor Next on an AKS cluster
- Using Azure OIDC for end-users to log in
- Using Azure Workload Identity to have a no-secrets
- Try multi-cluster access

## 1) Create an Entra ID App Registration

```
az ad app create --display-name capacitor-next
```

The Application Id will be the Client ID in later settings.

Set redirect URI: 

```
az ad app update \
  --id <Application ID from above)> \
  --set 'web={"redirectUris":["http://localhost:10081/auth/callback"]}' 
```

## 2) Create a Managed Identity

```
az identity create \                     
    --name "capacitor-next" \
    --resource-group "<resource-group>" \
    --location "<cluster-location>" \
    --subscription "<subscription id>"
```

## 3) Created a Federated Credential on the App Registration

The workload will assume the Managed Identity created in step 2).

The Managed Identity token is issued by your cluster issuer, but the App Registration knows nothing about that issuer. Let's create a Federated Credential on the App Registration so it knows about the tokens the cluster issuer issues.

You can find the cluster issuer URL with

```
az aks show \
  --resource-group <rg> \
  --name <cluster-name> \
  --query "oidcIssuerProfile.issuerUrl" \
  -o tsv
```

Now create a federated credential on the app registration.

```
az ad app federated-credential create \
  --id <Application ID 1)> \
  --parameters '{
      "name": "capacitor-next",
      "issuer": "https://<cluster>.oidc.azure.net/<tenant-id>",
      "subject": "system:serviceaccount:flux-system:capacitor-next",
      "audiences": ["api://AzureADTokenExchange"]
  }'
```

## 4) Deploy Capacitor Next

### Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: capacitor-next
  namespace: flux-system
type: Opaque
stringData:
  LICENSE_KEY: "contact laszlo at gimlet.io"
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

### Deploy with the Helm chart via FluxCD


```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: capacitor-next-helm
  namespace: flux-system
spec:
  interval: 24h
  url: oci://ghcr.io/gimlet-io/charts/capacitor-next
  ref:
    # semver: ">= 0.12.0-0" # Adding a `-0` suffix to the semver range will include prerelease versions.
    semver: ">= 0.12.0"
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: capacitor-next
  namespace: flux-system
spec:
  interval: 15m
  timeout: 1m
  chartRef:
    kind: OCIRepository
    name: capacitor-next-helm
    namespace: flux-system
  values:
    env:
      AUTH: oidc
      AUTH_DEBUG: "true" # logs impersonation headers
      OIDC_ISSUER: "https://login.microsoftonline.com/<tenant ID>/v2.0"
      OIDC_CLIENT_ID: "<Application ID from 1)>"
      OIDC_REDIRECT_URL: "http://localhost:10081/auth/callback" # replace this with your ingress URL if you not run capacitor next on a port forward
      ENTRA_ID_FEDEREATED_TOKEN_AUTH: "true"
    existingSecret:
      name: capacitor-next
    serviceAccount:
      annotations:
        azure.workload.identity/client-id: "<Application ID from 1)>"
```

### Visit the app

```
kubectl port-forward -n flux-system svc/capacitor-next 10081:80
```

[http://localhost:10081](http://localhost:10081)

Adjust end-user RBAC if needed based on [Authorization](#authorization).
