// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createResource, createEffect, untrack, createMemo } from "solid-js";
import { PodList, DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList } from "../components/index.ts";
import { FilterBar, Filter, ActiveFilter, FilterOption } from "../components/FilterBar.tsx";
import type { Pod, Deployment, ServiceWithResources, Kustomization, ArgoCDApplication, Service, DeploymentWithResources, PodCondition, ContainerStatus } from "../types/k8s.ts";
import { For, Show } from "solid-js";
import { updateServiceMatchingResources, updateDeploymentMatchingResources } from "../utils/k8s.ts";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";

type ResourceType = 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd';

export function Dashboard() {
  const [namespace, setNamespace] = createSignal<string>();
  const [resourceType, setResourceType] = createSignal<ResourceType>('pods');
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);

  const CARD_TYPES = [
    { value: 'argocd', label: 'ArgoCD' },
    { value: 'fluxcd', label: 'FluxCD' },
    { value: 'services', label: 'Services' },
    { value: 'deployments', label: 'Deployments' },
    { value: 'pods', label: 'Pods' }
  ] as const;

  const VIEWS = [
    { 
      id: 'pods',
      label: 'Pods',
      namespace: 'flux-system',
      resourceType: 'pods' as ResourceType
    },
    { 
      id: 'fluxcd',
      label: 'FluxCD',
      namespace: 'flux-system',
      resourceType: 'fluxcd' as ResourceType
    },
    { 
      id: 'argocd',
      label: 'ArgoCD',
      namespace: 'argocd',
      resourceType: 'argocd' as ResourceType
    }
  ] as const;

  const [selectedView, setSelectedView] = createSignal(VIEWS[0].id);

  // Resource state
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [deployments, setDeployments] = createSignal<DeploymentWithResources[]>([]);
  const [services, setServices] = createSignal<ServiceWithResources[]>([]);
  const [kustomizations, setKustomizations] = createSignal<Kustomization[]>([]);
  const [applications, setApplications] = createSignal<ArgoCDApplication[]>([]);

  const [namespaces] = createResource(async () => {
    const response = await fetch('/k8s/api/v1/namespaces');
    const data = await response.json();
    const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
    return nsList;
  });

  // Define namespace filter options
  const namespaceOptions = createMemo<FilterOption[]>(() => {
    if (!namespaces()) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
    return [
      { value: 'all-namespaces', label: 'All Namespaces' },
      ...namespaces()!.map((ns: string) => ({ value: ns, label: ns }))
    ];
  });

  // Define namespace filter
  const namespaceFilter: Filter = {
    name: "Namespace",
    type: "select",
    options: namespaceOptions(),
    multiSelect: false
  };

  // Define resource type filter
  const resourceTypeFilter: Filter = {
    name: "ResourceType",
    type: "select",
    options: CARD_TYPES.map(type => ({ value: type.value, label: type.label })),
    multiSelect: false
  };

  // Handle filter changes
  const handleFilterChange = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
    
    // Update namespace and resourceType signals based on active filters
    const namespaceFilter = filters.find(f => f.filter === "Namespace");
    if (namespaceFilter) {
      setNamespace(namespaceFilter.value);
    }
    
    const resourceTypeFilter = filters.find(f => f.filter === "ResourceType");
    if (resourceTypeFilter && 
        (resourceTypeFilter.value === 'pods' || 
         resourceTypeFilter.value === 'services' || 
         resourceTypeFilter.value === 'deployments' || 
         resourceTypeFilter.value === 'fluxcd' || 
         resourceTypeFilter.value === 'argocd')) {
      setResourceType(resourceTypeFilter.value);
    }
  };

  // Update active filters when namespace or resourceType changes
  createEffect(() => {
    const currentNamespace = namespace();
    const currentResourceType = resourceType();
    
    if (!currentNamespace || !currentResourceType) return;
    
    // Create new active filters array
    let newFilters = [...activeFilters()];
    
    // Update namespace filter
    const existingNamespaceIndex = newFilters.findIndex(f => f.filter === "Namespace");
    if (existingNamespaceIndex >= 0) {
      newFilters[existingNamespaceIndex] = { filter: "Namespace", value: currentNamespace };
    } else {
      newFilters.push({ filter: "Namespace", value: currentNamespace });
    }
    
    // Update resource type filter
    const existingResourceTypeIndex = newFilters.findIndex(f => f.filter === "ResourceType");
    if (existingResourceTypeIndex >= 0) {
      newFilters[existingResourceTypeIndex] = { filter: "ResourceType", value: currentResourceType };
    } else {
      newFilters.push({ filter: "ResourceType", value: currentResourceType });
    }
    
    // Only update if needed to avoid infinite loops
    if (JSON.stringify(newFilters) !== JSON.stringify(activeFilters())) {
      setActiveFilters(newFilters);
    }
  });

  createEffect(() => {
    if (!namespaces()) {
      return;
    }
    if (namespaces().includes("flux-system")) {
      setNamespace("flux-system");
    } else {
      setNamespace(namespaces()![0]);
    }
  });

  // Apply view when selected
  createEffect(() => {
    const view = VIEWS.find(v => v.id === selectedView());
    if (view) {
      setNamespace(view.namespace);
      setResourceType(view.resourceType);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {
    setupWatches(namespace(), resourceType());
  });

  const setupWatches = (ns: string | undefined, resourceFilter: ResourceType) => {
    if (!ns) return;
    console.log('Setting up watches for namespace:', ns, 'resource type:', resourceFilter);

    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources
    setPods(() => []);
    setDeployments(() => []);
    setServices(() => []);
    setKustomizations(() => []);
    setApplications(() => []);

    const watches = [];

    const namespacePath = ns === 'all-namespaces' ? '' : `/namespaces/${ns}`;

    if (resourceFilter === 'pods' || resourceFilter === 'services' || resourceFilter === 'deployments') {
      watches.push(
        {
          path: `/k8s/api/v1${namespacePath}/pods?watch=true`,
          callback: (event: { type: string; object: Pod }) => {
            if (event.type === 'ADDED') {
              setPods(prev => [...prev, event.object]);
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, [...pods(), event.object], deployments())));
            } else if (event.type === 'MODIFIED') {
              setPods(prev => prev.map(p => p.metadata.name === event.object.metadata.name ? event.object : p));
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            } else if (event.type === 'DELETED') {
              setPods(prev => prev.filter(p => p.metadata.name !== event.object.metadata.name));
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            }
          }
        },
        {
          path: `/k8s/apis/apps/v1${namespacePath}/deployments?watch=true`,
          callback: (event: { type: string; object: Deployment }) => {
            if (event.type === 'ADDED') {
              setDeployments(prev => [...prev, updateDeploymentMatchingResources(event.object, pods())]);
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), [...deployments(), event.object])));
            } else if (event.type === 'MODIFIED') {
              setDeployments(prev => prev.map(d => d.metadata.name === event.object.metadata.name ? updateDeploymentMatchingResources(event.object, pods()) : d));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            } else if (event.type === 'DELETED') {
              setDeployments(prev => prev.filter(d => d.metadata.name !== event.object.metadata.name));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            }
          }
        },
        {
          path: `/k8s/api/v1${namespacePath}/services?watch=true`,
          callback: (event: { type: string; object: Service }) => {
            if (event.type === 'ADDED') {
              setServices(prev => [...prev, updateServiceMatchingResources(event.object, pods(), deployments())]);
            } else if (event.type === 'MODIFIED') {
              setServices(prev => prev.map(s => 
                s.metadata.name === event.object.metadata.name 
                  ? updateServiceMatchingResources(event.object, pods(), deployments())
                  : s
              ));
            } else if (event.type === 'DELETED') {
              setServices(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
            }
          }
        }
      );
    }

    if (resourceFilter === 'fluxcd') {
      watches.push(
        {
          path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1${namespacePath}/kustomizations?watch=true`,
          callback: (event: { type: string; object: Kustomization }) => {
            if (event.type === 'ADDED') {
              setKustomizations(prev => [...prev, event.object]);
            } else if (event.type === 'MODIFIED') {
              setKustomizations(prev => prev.map(k => k.metadata.name === event.object.metadata.name ? event.object : k));
            } else if (event.type === 'DELETED') {
              setKustomizations(prev => prev.filter(k => k.metadata.name !== event.object.metadata.name));
            }
          }
        }
      );
    }

    if (resourceFilter === 'argocd') {
      watches.push(
        {
          path: `/k8s/apis/argoproj.io/v1alpha1${namespacePath}/applications?watch=true`,
          callback: (event: { type: string; object: ArgoCDApplication }) => {
            if (event.type === 'ADDED') {
              setApplications(prev => [...prev, event.object]);
            } else if (event.type === 'MODIFIED') {
              setApplications(prev => prev.map(a => a.metadata.name === event.object.metadata.name ? event.object : a));
            } else if (event.type === 'DELETED') {
              setApplications(prev => prev.filter(a => a.metadata.name !== event.object.metadata.name));
            }
          }
        }
      );
    }

    const controllers = watches.map(({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
  };

  // Update namespaceFilter options when namespaces resource changes
  createEffect(() => {
    namespaceFilter.options = namespaceOptions();
  });

  return (
    <div class="layout">
      <main class="main-content">
        <div class="views">
          <For each={VIEWS}>
            {(view) => (
              <button
                class={`view-pill ${selectedView() === view.id ? 'selected' : ''}`}
                onClick={() => setSelectedView(view.id)}
              >
                {view.label}
              </button>
            )}
          </For>
        </div>
        
        {/* Global Filters */}
        <FilterBar 
          filters={[namespaceFilter, resourceTypeFilter]}
          activeFilters={activeFilters()}
          onFilterChange={handleFilterChange}
        />
        
        <div class="controls">
          <span 
            class="watch-status" 
            style={{ "color": watchStatus() === "●" ? "var(--linear-green)" : "var(--linear-red)" } as any}
          >
            {watchStatus()}
          </span>
        </div>
        <section class="resource-section full-width">
          <Show when={resourceType() === 'services'}>
            <ServiceList services={services()} />
          </Show>
          <Show when={resourceType() === 'deployments'}>
            <DeploymentList deployments={deployments()} />
          </Show>
          <Show when={resourceType() === 'pods'}>
            <PodList pods={pods()} />
          </Show>
          <Show when={resourceType() === 'fluxcd'}>
            <FluxResourceList kustomizations={kustomizations()} />
          </Show>
          <Show when={resourceType() === 'argocd'}>
            <ArgoCDResourceList applications={applications()} />
          </Show>
        </section>
      </main>
    </div>
  );
}