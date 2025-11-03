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
# IMPERSONATE_SA_RULES=*@mycompany.com=flux-system:capacitor-next-builtin-editor # for wildcard impersonation rules
# ENTRA_ID_FEDEREATED_TOKEN_AUTH=true # if you use Azure Entra ID
# OIDC_SCOPES="openid,profile,email" # <-- the default list. Include groups if needed. eg.: "openid,profile,email,groups"
# OIDC_GROUPS_CLAIM=groups # <-- default
# OIDC_DEBUG=true # if set to true, logs impersonation headers for namespace listing (useful for OIDC debugging)
```

### noauth

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=flux-system:capacitor-next-builtin-editor
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

All groups the identity is member of are also set in impersonation headers.

### Authorization for nouth

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=flux-system:capacitor-next-builtin-editor
```

Every user will assume the RBAC roles defined for the mapped service account (SA). In the example case: capacitor-next-builtin-editor in the default namespace.

### Authorization for static user mapping

```
AUTH=static
USERS="laszlo@gimlet.io:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG[,anotheruser:password]"
IMPERSONATE_SA_RULES=laszlo@gimlet.io=flux-system:capacitor-next-builtin-editor
```

This case laszlo@gimlet.io has a static password, and my user is impersonating a service account. If my user has RBAC on the cluster the IMPERSONATE_SA_RULES is not needed.

Passwords can be encrypted with

```
bcrypt "password" with htpasswd -bnBC 10 "" password | tr -d ':\n'
```

### Impersonation rules

`IMPERSONATE_SA_RULES` maps users - or wildcard of users - to impersonate a service account. This way you can set up RBAC for them, even if the identity does not have RBAC grants.

The example bellow authorizes an external email and all emails in the company, then the company emails assume the `flux-system:capacitor-next-builtin-editor` service account when interacting with the cluster. The external email must have RBAC defined to be able to query the cluster.

```
AUTHORIZED_EMAILS=laszlo@gimlet.io,*@mycompany.com
IMPERSONATE_SA_RULES=*@mycompany.com=flux-system:capacitor-next-builtin-editor # for wildcard impersonation rules
```
