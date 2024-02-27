# Capacitor

A general purpose UI for FluxCD.

![Capacitor - Services](https://github.com/gimlet-io/capacitor/assets/4289031/b79056f0-7383-45f6-9b4a-a04376ba152b)


## Installation

### Flux

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
    tag: v-cosign-test5
  verify:
    provider: cosign
    matchOIDCIdentity:
      - issuer: "https://token.actions.githubusercontent.com"
        subject: "https://github.com/gimlet-io/capacitor" 
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

### Kubernetes manifests

```
kubectl apply -f https://raw.githubusercontent.com/gimlet-io/capacitor/main/deploy/k8s/rbac.yaml
kubectl apply -f https://raw.githubusercontent.com/gimlet-io/capacitor/main/deploy/k8s/manifest.yaml

kubectl port-forward svc/capacitor -n flux-system 9000:9000
```

### Helm

```
kubectl apply -f https://raw.githubusercontent.com/gimlet-io/capacitor/main/deploy/k8s/rbac.yaml

helm repo add onechart https://chart.onechart.dev

helm upgrade -i capacitor -n flux-system onechart/onechart -f https://raw.githubusercontent.com/gimlet-io/capacitor/main/deploy/helm/onechart-helm-values.yaml

kubectl port-forward svc/capacitor -n flux-system 9000:9000
```

## Why

FluxCD is an amazing backend for all things gitops.

It is a shame that ArgoCD gained so much traction mostly because developers appreciate the UI. Rolling out a read-only ArgoCD UI made Argo the de-facto kubernetes dashboard, where people look at logs and various kubernetes resources.

Capacitor's goal is to level the field: providing a UI option for Flux users that matches or exceeds the level of ArgoCD.

## Built in public

The vision: [https://www.youtube.com/watch?v=LaDRRDvsRAs](https://www.youtube.com/watch?v=LaDRRDvsRAs)

Capacitor is built currently by Gimlet.io founder Laszlo Fogas on live streams:

- 1730CET, 16th October - Capacitor launch, Flux CRD backend
    - https://youtube.com/live/Tw18CWFL5jo
- 1700CET, 20th October - Rudimentary data model, bundling a React frontend
    - https://www.youtube.com/watch?v=rhQ_ZSon8KA
- 1730CET, 23rd October - Rendering Flux state
    - https://www.youtube.com/watch?v=BoOIRF2bsQY
- 1700CET, 6th November - Product vision, Rendering Kustomizations, React event handlers
    - https://www.youtube.com/watch?v=LaDRRDvsRAs
- 1700CET, 12th January - Where are we with Capacitor? Launch plans
    - https://www.linkedin.com/events/buildingauiforfluxcd-wherearewe7151493559815188481/comments/
- 6th February - OCIRepository support
    - https://www.youtube.com/watch?v=q_dUJk6UZw4

## Philosophy

Capacitor wants to be more than a tool that displays Flux's CRDs in tables. Capacitor wants to provide contextualized information for developers to best operate their applications.

## Screenshots

Kustomizations:
<img alt="Kustomizations" src="https://github.com/gimlet-io/capacitor/assets/4289031/597d066c-7db1-4f28-91f4-c7ee5d4af722" width="450">

Error Handling:
<img alt="Capacitor - Error handling" src="https://github.com/gimlet-io/capacitor/assets/4289031/cf025e03-1c45-4db0-8ee1-cf102dc24468" width="450">


HelmReleases:
<img alt="Capacitor - Helm Releases" src="https://github.com/gimlet-io/capacitor/assets/4289031/effe04d9-b76f-4fc4-b83d-769164bb23aa" width="450">


Service Logs:
<img alt="Capacitor - Service logs" src="https://github.com/gimlet-io/capacitor/assets/4289031/8493d215-2969-49b2-a433-e0ab4c18437e" width="450">

## Roadmap

  - DONE: Flux CRD data ("sync state") backend
  - DONE: Flux CRD data ("sync state") frontend
  - DONE: UI for kubernetes resources deployed by Flux
  - DONE: Quick actions: logs, events, describe, port-forward
  - Displaying Errors
  - Error notifications
  - Support for environments
  - Display application meta information - service catalog items

## Star History

![Star History Chart](https://api.star-history.com/svg?repos=gimlet-io/capacitor&type=Date)

Please push ✨
