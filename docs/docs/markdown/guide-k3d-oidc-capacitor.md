## Guide: K3d with OIDC and Capacitor Next

### Running DEX with Github Auth

Let's run DEX with docker compose.
- We also proxy it with Nginx as k3d only works with https based OIDC providers.
- We use a self signed cert. K3d and Capacitor Next can work with that.

```yaml
# docker-compose.yaml
services:
  dex:
    image: ghcr.io/dexidp/dex:latest
    command: ["dex", "serve", "/etc/dex/config.yaml"]
    ports:
      - "5556:5556"
    volumes:
      - ./dex-config.yaml:/etc/dex/config.yaml:ro

  nginx:
    image: nginx:alpine
    ports:
      - "1443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/ssl/certs:ro
    depends_on:
      - dex
```

```yaml
# dex-config.yaml
issuer: https://127.0.0.1:1443/
storage:
  type: memory
web:
  http: 0.0.0.0:5556
staticClients:
  - id: onurl
    name: onurl
    secret: onurl-secret
    redirectURIs:
      - http://127.0.0.1:8181/auth/callback
enablePasswordDB: true
staticPasswords:
  - email: alice@example.com
    # bcrypt "password" with htpasswd -bnBC 10 "" password | tr -d ':\n'
    hash: "$2a$10$K1w0u6I2S9sQw5mG1Zi2TeTQO4desvY0r7rA8qg7wOB8y1m7k5pNy"
    username: alice
    userID: "1"
staticConnectors: []
```

```bash
mkdir certs
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout certs/selfsigned.key \
  -out certs/selfsigned.crt \
  -subj "/CN=localhost"
```

```
#nginx.conf
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/ssl/certs/selfsigned.crt;
    ssl_certificate_key /etc/ssl/certs/selfsigned.key;

    location / {
        proxy_pass http://dex:5556;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### K3d with OIDC

These api-server params can only be set at creation.

```bash
k3d cluster create oidc \
  --k3s-arg "--kube-apiserver-arg=oidc-issuer-url=https://127.0.0.1:1443@server:0" \
  --k3s-arg "--kube-apiserver-arg=oidc-client-id=onurl@server:0" \
  --k3s-arg "--kube-apiserver-arg=oidc-username-claim=email@server:0" \
  --k3s-arg "--v=6@server:0"
```

### Create service account

Create a SA for Capacitor Next that can impersonate users.

```yaml
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: capacitor-next
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: impersonator
rules:
  - apiGroups: ["authentication.k8s.io"]
    resources: ["users", "groups", "serviceaccounts"]
    verbs: ["impersonate"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: capacitor-next-impersonator-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: impersonator
subjects:
  - kind: ServiceAccount
    name: capacitor-next
    namespace: default
```

### Generate access token for SA

```bash
kubectl -n default create token capacitor-next --duration=4320h # for 6 months
```

### Run Capacitor Next

```bash
export OIDC_ISSUER=https://127.0.0.1:1443/
export OIDC_CLIENT_ID=onurl
export OIDC_CLIENT_SECRET=onurl-secret
export OIDC_REDIRECT_URL=http://127.0.0.1:8181/auth/callback
export OIDC_INSECURE_SKIP_TLS_VERIFY=true
export AUTHORIZED_EMAILS=*@example.com
export SESSION_HASH_KEY=base64:$(openssl rand -base64 32)
export SESSION_BLOCK_KEY=base64:$(openssl rand -base64 32)
export CLUSTER_REGISTRY_PATH=./registry.yaml
export STATIC_DIR=../backend/public
export PORT=8181
```

```yaml
# registry.yaml
clusters:
  - id: oidc
    name: oidc
    apiServerURL: https://127.0.0.1:59148
    certificateAuthorityData: |
      -----BEGIN CERTIFICATE-----
      ...
      -----END CERTIFICATE-----
    serviceAccount:
      token: eyJhbGciOiJ...
```

Where
- you get apiServerURL and from your kube context
```
CLUSTER_NAME=$(kubectl config view -o jsonpath='{.contexts[?(@.name == "'$(kubectl config current-context)'")].context.cluster}')
kubectl config view --raw -o jsonpath="{.clusters[?(@.name == \"${CLUSTER_NAME}\" )].cluster.server}"
```
- certificateAuthorityData from kube context also, but base64 decode it first
```
CLUSTER_NAME=$(kubectl config view -o jsonpath='{.contexts[?(@.name == "'$(kubectl config current-context)'")].context.cluster}')
kubectl config view --raw -o jsonpath="{.clusters[?(@.name == \"${CLUSTER_NAME}\" )].cluster.certificate-authority-data}" | base64 -d
```
- you can generate a service account token with
```
kubectl -n default create token capacitor-next --duration=4320h # for 6 months
```
### Log in

http://127.0.0.1:8181/auth/login

### Then use Capacitor Next

http://127.0.0.1:8181

### Granting RBAC to OIDC users

```
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: read-only-except-secrets
rules:
# Core API group (""), excluding secrets
- apiGroups: [""]
  resources: ["namespaces", "pods", "services", "configmaps", "endpoints", "persistentvolumeclaims", "namespaces", "nodes", "replicationcontrollers", "events", "serviceaccounts"]
  verbs: ["get", "list", "watch"]

# Apps API group
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
  verbs: ["get", "list", "watch"]

# Batch API group
- apiGroups: ["batch"]
  resources: ["jobs", "cronjobs"]
  verbs: ["get", "list", "watch"]

# Networking API group
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses", "networkpolicies"]
  verbs: ["get", "list", "watch"]

# RBAC API group
- apiGroups: ["rbac.authorization.k8s.io"]
  resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]
  verbs: ["get", "list", "watch"]

# Policy API group
- apiGroups: ["policy"]
  resources: ["poddisruptionbudgets", "podsecuritypolicies"]
  verbs: ["get", "list", "watch"]

# Storage API group
- apiGroups: ["storage.k8s.io"]
  resources: ["storageclasses", "volumeattachments"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: read-only-except-secrets-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: read-only-except-secrets
subjects:
- kind: User
  name: alice@example.com
```

### Using Github as IDP in Dex

```
issuer: https://127.0.0.1:1443/
storage:
  type: memory
web:
  http: 0.0.0.0:5556

staticClients:
  - id: onurl
    name: onurl
    secret: onurl-secret
    redirectURIs:
      - http://127.0.0.1:8181/auth/callback

connectors:
- type: github
    id: github
    name: GitHub
    config:
    clientID: Github Oauth App client ID
    clientSecret: Github OAuth App client secret
    redirectURI: https://127.0.0.1:1443/callback
```
