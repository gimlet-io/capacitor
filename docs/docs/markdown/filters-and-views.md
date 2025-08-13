## Filters

![Pod filters in Capacitor Next](media/filters.png)

- Each Kubernetes resource type has a defined set of filters available.

- The Resource Type filter, the Namespace filter for namespaced resources and the Name filter are available for every resource type, even for custom resources.

- For common filtering use-cases further filters are defined on a per resource type basis. Eg.: for Pods, Readiness, Status and Node filters are defined.

- Filters are maintained in the address bar, therefore the URL can be shared with colleagues.

## Views

The current filters can be saved as a View by hitting the + icon in the view bar. Like I saved the not ready kustomization resource types as a KustomizationErrors view.

![Custom view in Capacitor Next](media/views.png)

- There is a default set of views that are shipped in Capacitor Next.

- Custom views are stored in browser local storage.
