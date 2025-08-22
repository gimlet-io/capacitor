# Self-host on AKS with Workload Identity

- Run Capacitor Next on an AKS cluster
- Using Azure OIDC for end-users to log in
- Using Azure Workload Identity to have a no-secrets
- Try multi-cluster access

## 1) Create an Entra ID App Registration with a federated credential

```
az ad app create --display-name capacitor-next
```

The Application Id will be the Client ID in later settings.

You can find the cluster OIDC issuer URL with

```
az aks show \
  --resource-group <rg> \
  --name <cluster-name> \
  --query "oidcIssuerProfile.issuerUrl" \
  -o tsv
```

Now create a federated credential for the app registration.

```
az ad app federated-credential create \
  --id 99a6f24e-f925-4d6f-88cd-5767ccae392b \
  --parameters '{
      "name": "capacitor-next-cred",
      "issuer": "https://<cluster>.oidc.azure.net/<tenant-id>",
      "subject": "system:serviceaccount:flux-system:capacitor-next",
      "audiences": ["api://AzureADTokenExchange"]
  }'
```

## 2) Deploy Capacitor Next

### Service Account

```
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: capacitor-next
  namespace: flux-system
  annotations:
    azure.workload.identity/use: "true"
    azure.workload.identity/client-id: "<Application ID from 1)>"
```

### Secrets

Technically, only the session keys are secrets.

```
apiVersion: v1
kind: Secret
metadata:
  name: capacitor-next
  namespace: flux-system
type: Opaque
stringData:
  LICENSE_KEY: "contact laszlo at gimlet.io"
  OIDC_ISSUER: "https://login.microsoftonline.com/<tenant ID>/v2.0"
  OIDC_CLIENT_ID: "<Application ID from 1)>"
  OIDC_REDIRECT_URL: "http://localhost:8080/auth/callback" # replace this with your ingress URL if you not run capacitor next on a port forward
  SESSION_HASH_KEY: "base64:< run `openssl rand -base64 32`>"
  SESSION_BLOCK_KEY: "base64:< same value as the line before>"
  ENTRA_ID_FEDEREATED_TOKEN_AUTH: "true"
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

