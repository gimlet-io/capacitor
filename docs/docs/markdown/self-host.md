# Self-Host

Capacitor Next is a local-first Kubernetes client as described in [Quickstart](#quickstart). But you can also self-host it for your team on a URL.

You can do this for
- convenience (easier to distribute),
- or you want to provide read-only access to people without cluster access,
- you are building a platform.

I am running a private beta on the self-hosted version. Please get in touch on laszlo at gimlet.io to join the beta.

## License

The local-first version is Apache 2.0

The self-hosted version is the same app but wrapped in a backend and you can host it on a URL for your team. The wrapper is not open-source at this point.

The local and self-hosted version share the same features and codebase. The self-hosted one has other non-functional things that teams care about:
- OIDC impersonation
- read-only mode.

The self-hosted version may become source available and paid once the beta is over.

If you want to run it for your team on a URL get in touch on laszlo at gimlet.io. There are more than 60 companies in the beta and it proven to be an efficient way to incorporate feedback into Capacitor.

## Deployment

There are various options to deploy Capacitor Next bellow. Regardless of what installation method you chose, you can configure behavior with [environment variables](#self-host:environment-variables-reference).

### Helm
- [capacitor-next](https://github.com/gimlet-io/capacitor/tree/main/self-host/charts/capacitor-next)
- [capacitor-next-agent](https://github.com/gimlet-io/capacitor/tree/main/self-host/charts/capacitor-next-agent)

### HelmRelease

- [HelmRelease](https://github.com/gimlet-io/capacitor/tree/main/self-host/charts/capacitor-next#installing-with-fluxcd)

### OCIArtifact

- [Kustomization and OCIArtifact](https://github.com/gimlet-io/capacitor/tree/main/self-host/yaml/README.md)


### Plain yaml

- The OCIArtifact is built from the [self-host/yaml/capacitor-next](https://github.com/gimlet-io/capacitor/tree/docs-revamp/self-host/yaml/capacitor-next) folder. You can copy the yaml from the folder and craft your own path following the process described in [Kustomization and OCIArtifact](https://github.com/gimlet-io/capacitor/tree/main/self-host/yaml/capacitor-next/README.md).

## Environment Variables reference

Regardless of what installation method you chose, you can configure behavior with environment variables.

```yaml-table
- Variable: AGENT_SHARED_SECRET
  Description: Shared secret string that must match between Capacitor Next and its agent to authenticate agent connections. [See Agent installation](https://github.com/gimlet-io/capacitor/blob/main/self-host/charts/capacitor-next-agent/README.md)
- Variable: AUTH
  Description: Selects the authentication mode for Capacitor Next, such as `noauth`, `static`, or `oidc`. [See Authentication](#authentication)
- Variable: AUTHORIZED_EMAILS
  Description: Lists the email addresses or wildcards that are allowed to authenticate via OIDC. [See Authentication](#authentication)
- Variable: AUTH_DEBUG
  Description: When true, logs impersonation headers for debugging namespace listing, OIDC, and ServiceAccount impersonation. [See Authentication](#authentication)
- Variable: CLUSTER_REGISTRY_PATH
  Description: Points to the YAML file that defines the cluster registry Capacitor Next connects to.
- Variable: ENTRA_ID_FEDEREATED_TOKEN_AUTH
  Description: Enables Azure Entra ID federated token authentication for OIDC when set to true.
- Variable: FLUXCD_*
  Description: Sets where the FluxCD controllers run so Capacitor Next can discover their logs. [See usage](https://github.com/gimlet-io/capacitor/blob/main/self-host/charts/capacitor-next/values.yaml#L54-L62).
- Variable: IMPERSONATE_SA_RULES
  Description: Maps user identities to Kubernetes ServiceAccounts in the format `<user>=<namespace>:<service-account>[,<user2>=<namespace2>:<service-account2>]`. [See Authorication](#authorization)
- Variable: OIDC_CLIENT_CREDENTIALS_SCOPE
  Description: The scope used for a non‑interactive client_credentials token request, specifically the federated token preflight when ENTRA_ID_FEDEREATED_TOKEN_AUTH is enabled (Azure Workload Identity). Default in this project: https://graph.microsoft.com/.default.
- Variable: OIDC_CLIENT_ID
  Description: Sets the OIDC client ID registered for Capacitor Next.
- Variable: OIDC_CLIENT_SECRET
  Description: Sets the OIDC client secret used by Capacitor Next to authenticate with the OIDC provider.
- Variable: OIDC_GROUPS_CLAIM
  Description: Specifies the claim name in the OIDC token that contains the user’s groups.
- Variable: OIDC_GROUP_PREFIX
  Description: If your OIDC group names don't match exactly your RBAC role grant subjects, you add a prefix to the OIDC group name when setting the impersonation headers.
- Variable: OIDC_GROUP_SUFFIX
  Description: If your OIDC group names don't match exactly your RBAC role grant subjects, you add a suffix to the OIDC group name when setting the impersonation headers.
- Variable: OIDC_INSECURE_SKIP_TLS_VERIFY
  Description: When true, skips TLS certificate verification for the OIDC issuer, mainly for development setups.
- Variable: OIDC_ISSUER
  Description: Specifies the OIDC issuer URL used by Capacitor Next for authentication.
- Variable: OIDC_REDIRECT_URL
  Description: Defines the redirect URL where the OIDC provider sends users back after authentication.
- Variable: OIDC_SCOPES
  Description: Sets the OIDC scopes requested during authentication, such as `openid,profile,email,groups`.
- Variable: PORT
  Description: Sets the HTTP listening port for the Capacitor Next server.
- Variable: SESSION_BLOCK_KEY
  Description: Encrypts the session cookie’s contents so the client can’t read what’s inside (email, groups, selected cluster, etc.).
- Variable: SESSION_HASH_KEY
  Description: Signs the session cookie so the client can’t tamper with its contents without invalidating the signature.
- Variable: STATIC_DIR
  Description: Specifies the directory from which Capacitor Next serves static frontend assets. Only relevant in development.
- Variable: SYSTEM_VIEWS
  Description: Provides a JSON definition of default system views and filters shown in the Capacitor Next UI. [See Filters and Views](  #filters-and-views:system-views-in-the-self-hosted-version)
- Variable: USERS
  Description: Defines static users and bcrypt-hashed passwords in the format `email:bcrypt_password[,email2:bcrypt_password]`. [See Authentication](#authentication)
```
