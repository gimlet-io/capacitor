# Authorization

Capacitor Next impersonates a Kubernetes user or ServiceAccount in all cases. All calls to the Kubernetes API are handled on behalf of an existing identity. The RBAC roles of this identity define authorization in the Kubernetes API.

You as Capacitor Next administrator define these user or ServiceAccount RBAC roles 100%. But Capacitor Next provides a few presets for you: read-only, editor, cluster admin.

Capacitor Next needs only the RBAC permission to impersonate users. While it is a highly trusted role grant, it also simplifies RBAC inside Capacitor Next. Each user can perform the Kubernetes actions that this user or service account is able to do with `kubectl`. Capacitor Next just funnels these requests to the Kubernetes API. For certain actions, like editing or deleting resources Capacitor also sends a can-i API call and displays UI elements accordingly.

## Per-user RBAC

This is the most secure and most compliant approach: each user has their own Kubernetes user. Calls can be traced back to users and access can be revoked on a per-user basis.

This is also the one that requires the most maturity in your Kubernetes setup.

On the flip side, this option is the simplest to explain and it is the default route in Capacitor Next's code as Capacitor always does impersonation calls to Kubernetes.

Here is the flow:
- User opens Capacitor Next
- User is redirected to your IDP like Dex, Keycloak, Azure EntraID, Google Auth 
- User authenticates
- Capacitor Next receives proof of the user's identity. Typically their email: `user@mycompany.com`
- Capacitor Next adds the user's email to every Kubernetes API call.
- The Kubernetes API does authorization based on the RBAC roles of the user's identity.

With the above flow, you only need to deal with user identitites and RBAC roles. The user will have the same access as in `kubectl`.

As a final note: Capacitor also forwards OIDC group memberships, so you can define RBAC roles based on the users' groups.

## ServiceAccount impersonation

This is for the case when you don't have per-user RBAC setup in your Kubernetes cluster. This also powers the read-only, editor, cluster admin presets.

The idea is that you can map a user or group of users - even all users - to a `ServiceAccount` in your cluster.

Each call to the Kubernetes API will impersonate the given ServiceAccount. You then define RBAC roles for this ServiceAccount, and map users to ServiceAccounts with the `IMPERSONATE_SA_RULES` environment variable in the format of `<user>=<namespace>:<service-account>[,<user2>=<namespace2>:<service-account2>]`

### ServiceAccount impersonation presets

Capacitor Next provides three ServiceAccounts in the deployment manifests with RBAC role presets that you can use in the `IMPERSONATE_SA_RULES`:
- `flux-system:capacitor-next-preset-readonly`
- `flux-system:capacitor-next-preset-editor`
- `flux-system:capacitor-next-preset-clusteradmin`

It is encouraged that you review and further customize these roles.

```yaml-table
- Capability: View workloads
  readonly: ✅
  editor: ✅
  clusteradmin: ✅
- Capability: View logs/metrics
  readonly: ✅
  editor: ✅
  clusteradmin: ✅
- Capability: View secrets
  readonly: ❌
  editor: ✅
  clusteradmin: ✅
- Capability: Modify workloads (Deployments, Pods, etc.)
  readonly: ❌
  editor: ✅
  clusteradmin: ✅
- Capability: Modify FluxCD resources
  readonly: ❌
  editor: ✅
  clusteradmin: ✅
- Capability: pods/exec & portforward
  readonly: ❌
  editor: ✅
  clusteradmin: ✅
- Capability: Modify namespaces
  readonly: ❌
  editor: ❌
  clusteradmin: ✅
- Capability: Modify nodes
  readonly: ❌
  editor: ❌
  clusteradmin: ✅
- Capability: Modify RBAC (roles, bindings)
  readonly: ❌
  editor: ❌
  clusteradmin: ✅
- Capability: Modify CRDs
  readonly: ❌
  editor: ❌
  clusteradmin: ✅
- Capability: Modify admission webhooks
  readonly: ❌
  editor: ❌
  clusteradmin: ✅
```

In case of the read-only preset, you may want to [use the permition elevation case](#authorization:permition-elevation).

### ServiceAccount impersonation without authentication

When there is no authentication configured in Capacitor Next with the [AUTH=noauth](#authentication:authnoauth) setting, the user identity is set to the `noauth` string. You can use this user identity in `IMPERSONATE_SA_RULES`.

In the following example all users are mapped to a service account that has read only access on the cluster.

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=flux-system:capacitor-next-preset-readonly
```

The `flux-system:capacitor-next-preset-readonly` service account is provided in the deployment manifests.

### ServiceAccount impersonation for static authentication

With [static authentication](#authentication:authstatic) set up, you can use that static list of users in the `IMPERSONATE_SA_RULES`:

```
AUTH=static
USERS="laszlo@gimlet.io:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG,john@mycompany.com:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG]"
IMPERSONATE_SA_RULES=laszlo@gimlet.io=flux-system:capacitor-next-preset-clusteradmin,*@mycompany.com:flux-system:capacitor-next-preset-readonly
```

The above example maps Laszlo to the cluster admin ServiceAccount preset, and maps everybody with a mycompany.com email to the read-only preset.

## Examples

### Homelab access without authentication

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=flux-system:capacitor-next-preset-clusteradmin
```

### Read-only dashboard without authentication

```
AUTH=noauth
IMPERSONATE_SA_RULES=noauth=flux-system:capacitor-next-preset-readonly
```



### Multiple roles with static authentication

```
AUTH=static
USERS="devs@mycompanny.com:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG,devops@mycompany.com:$2y$12$CCou0vEKZOcJVsiYmsHH6.JD768WnUTHfudG/u5jWjNcAzgItdbgG]"
IMPERSONATE_SA_RULES=devs=flux-system:capacitor-next-preset-readonly,devops=flux-system:capacitor-next-preset-clusteradmin
```

### OIDC with ServiceAccount impersonation

Sometimes even with per-user OIDC identities, you want to grant access that does not exist in Kubernetes RBAC. In the case bellow, I granted access to Matt who is our PM.

```
AUTH=oidc
IMPERSONATE_SA_RULES=matt@mycompany.com=flux-system:capacitor-next-preset-readonly
```

## Permition elevation

Capacitor Next uses Kubernetes RBAC to determine access in all cases as described on this page:

> Capacitor Next impersonates a Kubernetes user or ServiceAccount in all cases. All calls to the Kubernetes API are handled on behalf of an existing identity. The RBAC roles of this identity define authorization in the Kubernetes API.

For read-only dashboards (using the `flux-system:capacitor-next-preset-readonly` service account) there are a handful of usecases that are operationally useful, but not possible to to RBAC:
- deleting pods to restart them
- rolling restart of deployments
- trigger FluxCD reconciliation
- reading helm secrets to get rollout history and build the resource tree

Capacitor Next can enable these usecases on read-only setups if you set the `PERMITION_ELEVATION_WORKLOAD_RESTART`, `PERMITION_ELEVATION_FLUX_RECONCILIATION`, `PERMISSION_ELEVATION_HELM_INFO` environment variables.

In these cases Capacitor's inpersonator service account gets additional RBAC scopes and these features will use the impersonator service account, and not the impersonated access, this we elevate the user's RBAC permissions to perform useful and not harmful actions.

This is a controlled way to work around the limitations of the RBAC system.
