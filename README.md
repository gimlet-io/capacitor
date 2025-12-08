<img width="1462" alt="Screenshot 2025-07-05 at 8 52 51" src="https://github.com/user-attachments/assets/8864a5cd-9f33-4065-b5d7-84b8c8ac404b" />

# A General Purpose UI for FluxCD.

Capacitor Next is a local-first Kubernetes client that uses your kubeconfig to access your clusters.

- A single binary distribution - like docker or terraform.
- With a built-in webserver.
- A browser tab opens when you start it.
- Like k9s, but in the browser.
- Like the ArgoCD UI, but for FluxCD.

(you can also [run it on a URL](#self-host-for-your-team---beta-testers-wanted) for your team)

## Quickstart

[https://gimlet.io/capacitor-next/docs/#quickstart](https://gimlet.io/capacitor-next/docs/#quickstart)

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
