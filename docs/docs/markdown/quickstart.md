# Quickstart

Capacitor Next is a local-first Kubernetes client that uses your kubeconfig to access your clusters.

- A single binary distribution - like docker or terraform.
- With a built-in webserver.
- A browser tab opens when you start it.

![Capacitor Next opens a browser tab on your laptop](media/tab.png)

- Like k9s, but in the browser.
- Like the ArgoCD UI, but for FluxCD.

## Install

On macOS or Linux with Homebrew:

```bash
brew install gimlet-io/capacitor/capacitor
```

Or with the install script:

```bash
wget -qO- https://gimlet.io/install-capacitor | bash
```

## Run

- Run `next --port 3333`
- Open [http://localhost:3333](http://localhost:3333) in your browser
