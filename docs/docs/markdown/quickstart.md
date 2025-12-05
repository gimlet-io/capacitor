# Quickstart

Capacitor Next is a local-first Kubernetes client that uses your kubeconfig to access your clusters.

- A single binary distribution - like docker or terraform.
- With a built-in webserver.
- A browser tab opens when you start it.

![Flux reconciliation state in Capacitor Next](media/tab.png)

- Like k9s, but in the browser.
- Like the ArgoCD UI, but for FluxCD.

## Install

```bash
wget -qO- https://gimlet.io/install-capacitor | bash
```

## Run

- Run `next --port 3333`
- Open [http://localhost:3333](http://localhost:3333) in your browser
