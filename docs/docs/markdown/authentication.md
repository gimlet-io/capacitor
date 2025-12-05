# Authentication

## Local-first CLI

In the local-first version (as described in [Quickstart](#quickstart)) we use your kubeconfig  to access Kubernetes.

Authentication is described and set in the kubeconfig (`~/.kube.config`) file. If you are not sure how to get a valid kubeconfig file, reach out to your cluster administrator.

If you have multiple kubeconfig files, Capacitor Next respects the `KUBECONFIG` environment variable:

```bash
export KUBECONFIG=~/.kube/my-other-config
next -p 3333
```

## Self-hosted version

We support three authentication options via the `AUTH` environment variable:

```yaml-table
- AUTH: AUTH=noauth
  Description: for local setups like k3s/k3d, or read-only dashboards
- AUTH: AUTH=static
  Description: for small teams or multiple role dashboards
- AUTH: AUTH=oidc
  Description: for per-user based access (most secure)
```

### AUTH=noauth

Capacitor will have no authentication with this setting.

If there is no authentication, there will be no identity available for the authorization system to pair roles with users, therefore Capacitor falls back to one default role. The exact method of that is described in [Authorization](#authorization).

While this setting does not seem useful, it can be used for
- cluster admin access on local clusters(TODO: link)
- for providing read-only access(TODO: link) to people who otherwise don't have cluster access.

### AUTH=static

Capacitor will have HTTP BASIC authentication with this setting.

The `USERS` environment variable controls the available user and password pairs in the format of: `email:bcrypt_password[,email2:bcrypt_password]`

Example:

```
AUTH=static
AUTH_DEBUG=true #logs impersonation headers

USERS="admin:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG,anna:$2y$12$yyH1b68RTW1RjGiw4o4Qhe9wY1sFx7MxQW9XdCYictavQXMsSiLJi,devs:kpT1yEqjXg4OtgHNehzML..f.JJZ8uX2A2X6cRq6ZKUjE5jVLlHxq"
```

Where you encrypt the password with:

```
# install: brew install httpd   # provides htpasswd
htpasswd -bnBC 12 x 'mypassword' | cut -d: -f2
```

### AUTH=oidc

Besides the `OIDC_*` variables make sure you set the `AUTHORIZED_EMAILS` environment variable. It specifies what emails or email wildcards can authenticate to Capacitor Next.

```
AUTH=oidc
OIDC_ISSUER=https://dex.localhost:8888/
OIDC_CLIENT_ID=example-app
OIDC_CLIENT_SECRET=example-secret
OIDC_REDIRECT_URL=http://127.0.0.1:8181/auth/callback

AUTHORIZED_EMAILS=laszlo@gimlet.io,*@mycompany.com

# OIDC_INSECURE_SKIP_TLS_VERIFY=true
# ENTRA_ID_FEDEREATED_TOKEN_AUTH=true #if you use Azure Entra ID
# OIDC_SCOPES="openid,profile,email" #<--the default list. Include groups if needed. eg.: "openid,profile,email,groups"
# OIDC_GROUPS_CLAIM=groups #<--default
# OIDC_GROUP_PREFIX= #TODO
# OIDC_GROUP_SUFFIX= #TODO
# AUTH_DEBUG=true #logs impersonation headers for namespace listing (useful for OIDC and ServiceAccount impersonation debugging)
```
