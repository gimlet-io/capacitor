## Filters

![Pod filters in Capacitor Next](media/filters.png)

- Each Kubernetes resource type has a defined set of filters available.

- The Resource Type filter, the Namespace filter for namespaced resources and the Name filter are available for every resource type, even for custom resources.

- For common filtering use-cases further filters are defined on a per resource type basis. Eg.: for Pods, Readiness, Status and Node filters are defined.

- Filters are maintained in the address bar, therefore the URL can be shared with colleagues.

## Views

Common filters can loaded from views.

![Views in Capacitor Next](media/views.png)

- There are system views that come preloaded with Capacitor.
- System views can be deleted if you don't need them. The deletion is stored in browser local storage.
- The current filters can be saved as a custom view by clicking the *Save as View...* button in the View dropdown.
- Custom views are stored in browser local storage.

### System Views in the self-hosted version

In the self-hosted version you can configure the system views by setting the `SYSTEM_VIEWS` environment variable. You can help your team with these presets.

```json
{
  "*": [
    {
        "id": "APIPods",
        "label": "API Pods",
        "filters": [
            { "name": "ResourceType", "value": "core/Pod" },
            { "name": "Namespace", "value": "production" }
        ]
    },
    {
        "id": "Kustomizations",
        "label": "Kustomizations",
        "filters": [
            { "name": "ResourceType", "value": "kustomize.toolkit.fluxcd.io/Kustomization" },
            { "name": "Namespace", "value": "all-namespaces" }
        ]
    },
    {
        "id": "HelmReleases",
        "label": "HelmReleases",
        "filters": [
            { "name": "ResourceType", "value": "helm.toolkit.fluxcd.io/HelmRelease" },
            { "name": "Namespace", "value": "all-namespaces" }
        ]
    }
  ]
}
```

The JSON structure is an object with key value pairs.
- The keys are context names, therefore you can have different presets per environment. - The context names accept wildcards. `*` is a catch-all rule and `dev4` matches one cluster, while `dev*` matches all cluster names starting with dev.
- The values of the key-value pairs are arrays of views.
- A view has an id and a label and an array of filtes.
- The best way to create the views array is to copy views from the browser local storage. Define a custom view on the UI, then copy the JSON from the local storage with the browser developer toolbar.
