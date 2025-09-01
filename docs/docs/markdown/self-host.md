# Self-Host

Self-host for your team. We are running a private beta on the self-hosted version. Please get in contact with laszlo at gimlet.io

## Authentication

We support three authentication option:
- `AUTH=oidc` is the default setting
- `AUTH=noauth` for local setups like k3s/k3d
- `AUTH=static` for small teams

### OIDC

```
AUTH=oidc
OIDC_ISSUER=https://dex.localhost:8888/
OIDC_CLIENT_ID=example-app
OIDC_CLIENT_SECRET=example-secret
OIDC_REDIRECT_URL=http://127.0.0.1:8181/auth/callback
OIDC_INSECURE_SKIP_TLS_VERIFY=true
AUTHORIZED_EMAILS=laszlo@gimlet.io,*@mycompany.com
# ENTRA_ID_FEDEREATED_TOKEN_AUTH=true # if you use Azure Entra ID
```

### noauth

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=default:capacitor-next-builtin-editor
```

Capacitor default authenticates you as a user called `noauth` what you can then map to a service account. And define RBAC for that service account.

### Static auth

```
AUTH=static
USERS="laszlo@gimlet.io:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG"
```

Where you have to encrypt the password with

```
# install: brew install httpd   # provides htpasswd
htpasswd -bnBC 12 x 'mypassword' | cut -d: -f2`
```

## Authorization

- Capacitor Next impersonates a Kubernetes user or service account in all cases.
- The RBAC of this identity defines authorization
- You can remap identities to service accounts to assume a more static set of RBAC rules.

### Authorization with OIDC

With OIDC, the user identity is returned by the OIDC server and Capacitor Next impersonates this identity.

### Authorization for nouth

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=default:capacitor-next-builtin-editor
```

Every user will assume the RBAC roles defined for the mapped service account (SA). In the example case: capacitor-next-builtin-editor in the default namespace.

### Authorization for static user mapping

```
AUTH=static
USERS="laszlo@gimlet.io:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG[,anotheruser:password]"
IMPERSONATE_SA_RULES=laszlo@gimlet.io=default:capacitor-next-builtin-editor
```

This case laszlo@gimlet.io has a static password, and my user is impersonating a service account. If my user has RBAC on the cluster the IMPERSONATE_SA_RULES is not needed.

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
      - id: remote-cluster
        name: remote-cluster
        apiServerURL: https://xxx.hcp.eastus.azmk8s.io:443
        certificateAuthorityData: |
        -----BEGIN CERTIFICATE-----
        ...
        -----END CERTIFICATE-----
        serviceAccount:
        token: "<bearer-token>"
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

Using workload identity to access a remote cluster is not explored at this point.
