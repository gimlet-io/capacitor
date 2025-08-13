## Self-Host

Self-host for your team.

- OIDC-based authentication
- We also offer static role based access
- We are running a private beta on the self-hosted version. Please get in contact with laszlo at gimlet.io

### Definining clusters

```
clusters:
  - id: test
    name: Test
    apiServerURL: https://127.0.0.1:59148
    certificateAuthorityData: |
      -----BEGIN CERTIFICATE-----
      MIIBdjCCAR2gAwIBAgIBADAKBggqhkjOPQQDAjAjMSEwHwYDVQQDDBhrM3Mtc2Vy
      ...
      -----END CERTIFICATE-----
    serviceAccount:
      token: ...
```

### Configuring OIDC

```
OIDC_ISSUER=https://dex.localhost:8888/
OIDC_CLIENT_ID=example-app
OIDC_CLIENT_SECRET=example-secret
OIDC_REDIRECT_URL=http://127.0.0.1:8181/auth/callback
OIDC_INSECURE_SKIP_TLS_VERIFY=true
SESSION_HASH_KEY=base64:xxx
SESSION_BLOCK_KEY=base64:xxx
CLUSTER_REGISTRY_PATH=./registry.yaml
STATIC_DIR=../backend/public
PORT=8181
```
