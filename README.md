# Capacitor

A general purpose UI for FluxCD.

## Why

FluxCD is an amazing backend for all things gitops.

It is a shame that ArgoCD gained so much traction mostly because developers appreciate the UI. Rolling out a read-only ArgoCD UI made Argo the de-facto kubernetes dashboard, where people look at logs and various kubernetes resources.

Capacitor's goal is to level the field: providing a UI option for Flux users that matches or exceeds the level of ArgoCD.

## Built in public

![image](https://github.com/gimlet-io/capacitor/assets/4289031/81ca9de2-9fe0-44e7-ac7a-f7e1878f999f)


Capacitor is built currently by Gimlet.io founder Laszlo Fogas on live streams:

- 1730CET, 16th October - Capacitor launch, Flux CRD backend
    - https://youtube.com/live/Tw18CWFL5jo
- 1700CET, 20th October - Rudimentary data model, bundling a React frontend
    - https://www.youtube.com/watch?v=rhQ_ZSon8KA
- 1730CET, 23rd October - Rendering Flux state
    - https://www.youtube.com/watch?v=BoOIRF2bsQY
- 1700CET, 6th November - Product vision, Rendering Kustomizations, React event handlers

## Philosophy

Capacitor wants to be more than a tool that displays Flux's CRDs in tables. Capacitor wants to provide contextualized information for developers to best operate their applications.

## Roadmap

  - Flux CRD data ("sync state") backend
  - Flux CRD data ("sync state") frontend
  - UI for kubernetes resources deployed by Flux
  - Quick actions: logs, events, describe, port-forward
  - Displaying Errors
  - Error notifications
  - Support for environments
  - Display application meta information - service catalog items
