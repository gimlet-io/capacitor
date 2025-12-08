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
- Variable: AUTH
  Description: ..
```
