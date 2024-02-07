## How to generate the manifest

```
helm repo add onechart https://chart.onechart.dev

helm template  capacitor -n flux-system onechart/onechart -f ../helm/onechart-helm-values.yaml > manifest.yaml
```