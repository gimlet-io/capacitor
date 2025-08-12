<img width="1462" alt="Screenshot 2025-07-05 at 8 52 51" src="https://github.com/user-attachments/assets/8864a5cd-9f33-4065-b5d7-84b8c8ac404b" />

# A General Purpose UI for FluxCD.

Capacitor Next is a client-side Kubernetes client that uses your kubeconfig to access your clusters.

- Like k9s, but in the browser.
- Like the ArgoCD UI, just lighter.

## Quickstart

```
wget -qO- https://gimlet.io/install-capacitor | bash
```

## Features

- Kubernetes resource discovery
- Keyboard navigation
- Built-in and custom views
- Helm history
- Helm values and manifest diffing
- Flux resource tree
- Flux Kustomization diffing between cluster and git state

**Resource tree**

<img width="1512" alt="Screenshot 2025-07-05 at 8 40 17" src="https://github.com/user-attachments/assets/a2e63aea-f0dc-4bad-8b2b-7ac5bdeb4e3b" />

**Flux Kustomization diffing between cluster and git state**

<img width="1512" alt="Screenshot 2025-07-05 at 8 46 38" src="https://github.com/user-attachments/assets/5c7166f5-ecf4-424b-9140-5b4e92d962af" />

## Why

FluxCD is an amazing backend for all things gitops.

It is a shame that ArgoCD gained so much traction mostly because developers appreciate the UI. Rolling out a read-only ArgoCD UI made Argo the de-facto kubernetes dashboard, where people look at logs and various kubernetes resources.

Capacitor's goal is to level the field: providing a UI option for Flux users that matches or exceeds the level of ArgoCD.

## Capacitor Next - currently under development

Capacitor Next is a rewrite and rethink of the original Capacitor release.

The development is happening on the `main` branch and releases are pushed frequently under this [Github release](https://github.com/gimlet-io/capacitor/releases/tag/capacitor-next).

| Capacitor Next                             | Capacitor                                                             |
|--------------------------------------|-----------------------------------------------------------------------------|
| client-side | server-side        |
| multi-cluster   | single cluster                        |
| respects RBAC   |          ❌               |
| Supports all k8s resources and versions   |            ❌             |
| Kustomization Resource Tree   |          ❌               |
| Helm values and manifest diffing   |        ❌                |
| Kustomization diffing between cluster and git   |          ❌               |

## Capacitor Next on a URL

Capacitor Next is a tool you can run on your laptop.

- Are you looking to host it for your team on a URL?
- Or integrate with Backstage?

Reach out to laszlo at gimlet.io. We are looking for design partners.

## Star History

![Star History Chart](https://api.star-history.com/svg?repos=gimlet-io/capacitor&type=Date)

Please push ✨

## Capacitor - the original release

> 💡 **Tip:** Capacitor was the first attempt to write a ui for Capacitor. It was running in the cluster and users accessed it on a URL. Not under development anymore. Scroll to the top and use Capacitor Next.

![Capacitor - Services](https://github.com/gimlet-io/capacitor/assets/4289031/b79056f0-7383-45f6-9b4a-a04376ba152b)

### Installation - Deprecated

> 💡 **Tip:** Capacitor requires Flux v2.0.0.

Deploy the latest Capacitor release in the `flux-system` namespace
by adding the following manifests to your Flux repository:

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: OCIRepository
metadata:
  name: capacitor
  namespace: flux-system
spec:
  interval: 12h
  url: oci://ghcr.io/gimlet-io/capacitor-manifests
  ref:
    semver: ">=0.1.0"
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: capacitor
  namespace: flux-system
spec:
  targetNamespace: flux-system
  interval: 1h
  retryInterval: 2m
  timeout: 5m
  wait: true
  prune: true
  path: "./"
  sourceRef:
    kind: OCIRepository
    name: capacitor
```

Note that Flux will check for Capacitor releases every 12 hours and will 
automatically deploy the new version if it is available.

Access Capacitor UI with port-forwarding:

```bash
kubectl -n flux-system port-forward svc/capacitor 9000:9000
```

#### (Optional) Verify OCIRepository with Cosign

This feature requires Flux v2.2.0.

```diff
---
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: OCIRepository
metadata:
  name: capacitor
  namespace: flux-system
spec:
  interval: 12h
  url: oci://ghcr.io/gimlet-io/capacitor-manifests
  ref:
    semver: ">=0.1.0"
+  verify:
+    provider: cosign
+    matchOIDCIdentity:
+      - issuer: "https://token.actions.githubusercontent.com"
+        subject: "^https://github.com/gimlet-io/capacitor.*$" 
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: capacitor
  namespace: flux-system
spec:
  targetNamespace: flux-system
  interval: 1h
  retryInterval: 2m
  timeout: 5m
  wait: true
  prune: true
  path: "./"
  sourceRef:
    kind: OCIRepository
    name: capacitor
```

### Kubernetes manifests - Deprecated

```
kubectl apply -f https://raw.githubusercontent.com/gimlet-io/capacitor/refs/tags/capacitor-v0.4.8/deploy/k8s/rbac.yaml
kubectl apply -f https://raw.githubusercontent.com/gimlet-io/capacitor/refs/tags/capacitor-v0.4.8/deploy/k8s/manifest.yaml

kubectl port-forward svc/capacitor -n flux-system 9000:9000
```

For adding an `Ingress`, a Kubernetes `NetworkPolicy` is required.
An example would be:

```
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: capacitor-ingress
  namespace: flux-system
spec:
  policyTypes:
    - Ingress
  ingress:
    - from:
      - namespaceSelector: {}
  podSelector:
    matchLabels:
      app.kubernetes.io/instance: capacitor
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: capacitor-ingress
  namespace: flux-system
spec:
  rules:
    - host: gitops.example.com
      http:
        paths:
          - pathType: Prefix
            path: /
            backend:
              service:
                name: capacitor
                port:
                  number: 9000
```

### Helm - Deprecated

```
kubectl apply -f https://raw.githubusercontent.com/gimlet-io/capacitor/main/deploy/k8s/rbac.yaml

helm repo add onechart https://chart.onechart.dev

helm upgrade -i capacitor -n flux-system onechart/onechart -f https://raw.githubusercontent.com/gimlet-io/capacitor/main/deploy/helm/onechart-helm-values.yaml

kubectl port-forward svc/capacitor -n flux-system 9000:9000
```

### Built in public - Deprecated

The vision: [https://www.youtube.com/watch?v=LaDRRDvsRAs](https://www.youtube.com/watch?v=LaDRRDvsRAs)

Capacitor is built currently by Gimlet.io founder Laszlo Fogas on live streams:

- 1730CET, 16th October 2023 - Capacitor launch, Flux CRD backend
    - https://youtube.com/live/Tw18CWFL5jo
- 1700CET, 20th October 2023 - Rudimentary data model, bundling a React frontend
    - https://www.youtube.com/watch?v=rhQ_ZSon8KA
- 1730CET, 23rd October 2023 - Rendering Flux state
    - https://www.youtube.com/watch?v=BoOIRF2bsQY
- 1700CET, 6th November 2023 - Product vision, Rendering Kustomizations, React event handlers
    - https://www.youtube.com/watch?v=LaDRRDvsRAs
- 1700CET, 12th January 2024 - Where are we with Capacitor? Launch plans
    - https://www.linkedin.com/events/buildingauiforfluxcd-wherearewe7151493559815188481/comments/
- 6th February 2024 - OCIRepository support
    - https://www.youtube.com/watch?v=q_dUJk6UZw4

### Philosophy - Deprecated

Capacitor wants to be more than a tool that displays Flux's CRDs in tables. Capacitor wants to provide contextualized information for developers to best operate their applications.

### Screenshots - Deprecated

Kustomizations:
<img alt="Kustomizations" src="https://github.com/gimlet-io/capacitor/assets/4289031/597d066c-7db1-4f28-91f4-c7ee5d4af722" width="450">

Error Handling:
<img alt="Capacitor - Error handling" src="https://github.com/gimlet-io/capacitor/assets/4289031/cf025e03-1c45-4db0-8ee1-cf102dc24468" width="450">


HelmReleases:
<img alt="Capacitor - Helm Releases" src="https://github.com/gimlet-io/capacitor/assets/4289031/effe04d9-b76f-4fc4-b83d-769164bb23aa" width="450">


Service Logs:
<img alt="Capacitor - Service logs" src="https://github.com/gimlet-io/capacitor/assets/4289031/8493d215-2969-49b2-a433-e0ab4c18437e" width="450">
