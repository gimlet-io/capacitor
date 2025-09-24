<img width="1462" alt="Screenshot 2025-07-05 at 8 52 51" src="https://github.com/user-attachments/assets/8864a5cd-9f33-4065-b5d7-84b8c8ac404b" />

# A General Purpose UI for FluxCD.

Capacitor Next is a client-side Kubernetes client that uses your kubeconfig to access your clusters.

- Like k9s, but in the browser.
- Like the ArgoCD UI, just lighter.

(you can also [run it on a URL](#self-host-for-your-team---beta-testers-wanted) for your team)

## Quickstart

```
wget -qO- https://gimlet.io/install-capacitor | bash
```

## Features

- Kubernetes resource discovery
- Respects RBAC
- Multi-cluster
- Keyboard navigation
- Built-in and custom views
- Helm history
- Helm values and manifest diffing
- Flux resource tree
- Flux Kustomization diffing between cluster and git state

## Why

FluxCD is an amazing backend for all things gitops.

It is a shame that ArgoCD gained so much traction mostly because developers appreciate the UI. Rolling out a read-only ArgoCD UI made Argo the de-facto kubernetes dashboard, where people look at logs and various kubernetes resources.

Capacitor's goal is to level the field: providing a UI option for Flux users that matches or exceeds the level of ArgoCD.

## Self-host for your team - beta testers wanted

Capacitor Next is a tool you can run on your laptop.

- Are you looking to host it for your team on a URL?
- Or integrate with Backstage?

Reach out to laszlo at gimlet.io. We are looking for beta testers.

## Star History

![Star History Chart](https://api.star-history.com/svg?repos=gimlet-io/capacitor&type=Date)

Please push ✨

## Versioning

Capacitor Next follows a calendar based versioning with a bi-weekly feature release cadence.

- `v2025-09.1` is the first feature release in September 2025. Landing mid month.
- `v2025-09.2` is the second feature release in September 2025. Landing at the end of the month, or perhaps the beginning of the next one.
- `v2025-09.1-patch1` is the first patch release of the first feature release in September 2025.
- `v2025-09.2-rc2` is the second release candidate of the second feature release in September 2025.
- `v2025-09.2-debug1` is a debug release of the second feature release in September 2025. Meant to be installed only by request of the maintainers.

The update notifications in the UI trigger only on feature releases: `v2025-09.1`, `v2025-09.2`.

You may install `patch` and `rc` releases if you please, `debug` releases if requested.

You can install a specific version by supplying the version tag:

```
wget -qO- https://gimlet.io/install-capacitor | bash -s -- v2025-09.1-patch1
```

### Branching

`main` is always the latest feature release. Late September 2025 that is `v2025-09.1` as `v2025-09.2` is not released yet. `main` carries patch and debug releases of the latest feature release.

The next feature release is built on a branch named after it eg.: `v2025-09.2`. Rc and debug releases are built from this branch.

### Self-hosted versioning

Versioning for the self-hosted release follows the versioning of the local-first app.

The deployment yamls always point to the latest feture release or its latest patch release.

- Self-hosted fixes are released in a patch version `v2025-09.1-patch1` even if the local-first app does not have any changes. The auto-update message ignores patch versions, therefor the self-hosted version does not interfere with the local-first experience.

- The self-hosted version does not publish an image with rc tag of the next feature release. New features are meant to be tested in the local-first app.

- The self-hosted version do publish images with the debug tag. It is crucial to grow robust support for all environments. These are meant to be installed on request and the contents are not publicly documented.

- The self-hosted version may introduce new features in a patch tag. Only for new features that are strictly related to the self-hosted experience.
