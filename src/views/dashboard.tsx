// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createResource, createEffect, untrack, createMemo, onMount } from "solid-js";
import { DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList, ResourceList } from "../components/index.ts";
import { FilterBar, Filter, ActiveFilter, FilterOption } from "../components/filterBar/FilterBar.tsx";
import type { Pod, Deployment, ServiceWithResources, Kustomization, ArgoCDApplication, Service, DeploymentWithResources } from "../types/k8s.ts";
import { For, Show } from "solid-js";
import { updateServiceMatchingResources, updateDeploymentMatchingResources } from "../utils/k8s.ts";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";
import { podColumns, podsStatusFilter } from "../components/resourceList/PodList.tsx";
import { kustomizationReadyFilter } from "../components/resourceList/FluxResourceList.tsx";
import { argocdApplicationSyncFilter, argocdApplicationHealthFilter } from "../components/resourceList/ArgoCDResourceList.tsx";
type ResourceType = 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd';

interface View {
  id: string;
  label: string;
  namespace: string;
  resourceType: ResourceType;
  isSystem?: boolean;
  filters?: ActiveFilter[];
}

// Interface for storing serialized filters
interface SerializableFilter {
  filterId: string;
  value: string;
}

interface SerializableView {
  id: string;
  label: string;
  namespace: string;
  resourceType: ResourceType;
  isSystem?: boolean;
  filters?: SerializableFilter[];
}

const SYSTEM_VIEWS: View[] = [
  { 
    id: 'pods',
    label: 'Pods',
    namespace: 'flux-system',
    resourceType: 'pods' as ResourceType,
    isSystem: true
  },
  { 
    id: 'fluxcd',
    label: 'FluxCD',
    namespace: 'all-namespaces',
    resourceType: 'fluxcd' as ResourceType,
    isSystem: true
  },
  { 
    id: 'argocd',
    label: 'ArgoCD',
    namespace: 'all-namespaces',
    resourceType: 'argocd' as ResourceType,
    isSystem: true
  }
];

export function Dashboard() {
  const [namespace, setNamespace] = createSignal<string>();
  const [resourceType, setResourceType] = createSignal<ResourceType>('pods');
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);
  const [views, setViews] = createSignal<View[]>(SYSTEM_VIEWS);
  const [selectedView, setSelectedView] = createSignal<string>(SYSTEM_VIEWS[0].id);
  const [showNewViewForm, setShowNewViewForm] = createSignal(false);
  const [newViewName, setNewViewName] = createSignal("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = createSignal<string | null>(null);

  const ResourceTypes = [
    { value: 'argocd', label: 'ArgoCD', filters: [argocdApplicationSyncFilter, argocdApplicationHealthFilter] },
    { value: 'fluxcd', label: 'FluxCD', filters: [kustomizationReadyFilter] },
    { value: 'services', label: 'Services', filters: [] },
    { value: 'deployments', label: 'Deployments', filters: [] },
    { value: 'pods', label: 'Pods', filters: [podsStatusFilter] }
  ] as const;

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

  const namespaceOptions = createMemo<FilterOption[]>(() => {
    if (!namespaces()) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
    return [
      { value: 'all-namespaces', label: 'All Namespaces' },
      ...namespaces()!.map((ns: string) => ({ value: ns, label: ns }))
    ];
  });

  const namespaceFilter: Filter = {
    name: "Namespace",
    type: "select",
    options: namespaceOptions(),
    multiSelect: false,
    filterFunction: () => true
  };

  const resourceTypeFilter: Filter = {
    name: "ResourceType",
    type: "select",
    options: ResourceTypes.map(type => ({ value: type.value, label: type.label })),
    multiSelect: false,
    filterFunction: () => true
  };

  const nameFilter: Filter = {
    name: "Name",
    type: "text",
    placeholder: "Filter by name",
    filterFunction: (resource: any, value: string) => {
      return resource.metadata.name.toLowerCase().includes(value.toLowerCase());
    }
  };

  // Central registry for all available filters - moved after filter definitions
  const filterRegistry: Record<string, Filter> = {
    "Namespace": namespaceFilter,
    "ResourceType": resourceTypeFilter,
    "Name": nameFilter,
    "PodStatus": podsStatusFilter,
    "Ready": kustomizationReadyFilter,
    "Sync Status": argocdApplicationSyncFilter,
    "Health": argocdApplicationHealthFilter
  };

  // Load custom views from localStorage on mount
  onMount(() => {
    try {
      const storedViews = localStorage.getItem('customViews');
      if (storedViews) {
        const serializedViews = JSON.parse(storedViews) as SerializableView[];
        
        // Reconstruct views with proper filter functions
        const customViews = serializedViews.map(serializedView => {
          if (serializedView.filters) {
            // Restore filter functions for each filter reference
            const restoredFilters = serializedView.filters
              .map(sf => {
                const filterDef = filterRegistry[sf.filterId];
                if (filterDef) {
                  return {
                    filter: filterDef,
                    value: sf.value
                  };
                }
                return null;
              })
              .filter(Boolean) as ActiveFilter[]; // Remove any null filters
            
            return { 
              ...serializedView, 
              filters: restoredFilters 
            };
          }
          return serializedView;
        }) as View[];
        
        setViews([...SYSTEM_VIEWS, ...customViews]);
        console.log("Restored views with filter functions:", customViews);
      }
    } catch (error) {
      console.error('Error loading custom views:', error);
    }
  });

  // Save custom views to localStorage whenever they change
  const saveCustomViews = (updatedViews: View[]) => {
    try {
      const customViews = updatedViews.filter(view => !view.isSystem);
      
      // Convert views to a serializable format
      const serializableViews = customViews.map(view => {
        // Process filters to make them serializable
        const serializableFilters = view.filters?.map(activeFilter => ({
          filterId: activeFilter.filter.name, // Store filter name as identifier
          value: activeFilter.value
        }));
        
        return {
          ...view,
          filters: serializableFilters
        };
      });
      
      localStorage.setItem('customViews', JSON.stringify(serializableViews));
      console.log('Serialized and saved custom views:', serializableViews);
    } catch (error) {
      console.error('Error saving custom views:', error);
    }
  };

  // Create a ref for the new view name input
  let newViewNameInput: HTMLInputElement | undefined;

  const createNewView = () => {
    if (!newViewName()) return;
    
    const id = `custom-${Date.now()}`;
    const newView: View = {
      id,
      label: newViewName(),
      namespace: namespace() || 'all-namespaces',
      resourceType: resourceType(),
      filters: [...activeFilters()]
    };
    
    const updatedViews = [...views(), newView];
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    setSelectedView(id);
    setShowNewViewForm(false);
    setNewViewName("");
  };

  const handleNewViewButtonClick = () => {
    setShowNewViewForm(true);
    setNewViewName("");
    setTimeout(() => {
      newViewNameInput?.focus();
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      createNewView();
    }
  };

  const deleteView = (id: string) => {
    const updatedViews = views().filter(view => view.id !== id);
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    setSelectedView(SYSTEM_VIEWS[0].id);
    setShowDeleteConfirmation(null);
  };

  const cancelNewView = () => {
    setShowNewViewForm(false);
    setNewViewName("");
  };

  const handleFilterChange = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
    
    // Update namespace and resourceType signals based on active filters
    const namespaceFilter = filters.find(f => f.filter.name === "Namespace");
    if (namespaceFilter) {
      setNamespace(namespaceFilter.value);
    }
    
    const resourceTypeFilter = filters.find(f => f.filter.name === "ResourceType");
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
    const newFilters = [...activeFilters()];
    
    // Update namespace filter
    const existingNamespaceIndex = newFilters.findIndex(f => f.filter.name === "Namespace");
    if (existingNamespaceIndex >= 0) {
      newFilters[existingNamespaceIndex] = { filter: namespaceFilter, value: currentNamespace };
    } else {
      newFilters.push({ filter: namespaceFilter, value: currentNamespace });
    }
    
    // Update resource type filter
    const existingResourceTypeIndex = newFilters.findIndex(f => f.filter.name === "ResourceType");
    if (existingResourceTypeIndex >= 0) {
      newFilters[existingResourceTypeIndex] = { filter: resourceTypeFilter, value: currentResourceType };
    } else {
      newFilters.push({ filter: resourceTypeFilter, value: currentResourceType });
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
    const viewId = selectedView();
    const view = views().find(v => v.id === viewId);
    
    if (view) {
      setNamespace(view.namespace);
      setResourceType(view.resourceType);
      
      untrack(() => {
        // For custom views with saved filters, apply all those filters
        if (!view.isSystem && view.filters && view.filters.length > 0) {
          setActiveFilters(view.filters);
        } else {
          // For system views, only keep namespace and resource type filters
          const newFilters = activeFilters()
            .filter(f => f.filter.name === "Namespace" || f.filter.name === "ResourceType");
          setActiveFilters(newFilters);
        }
      });
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

  // Update the current custom view whenever active filters change
  createEffect(() => {
    const viewId = selectedView();
    const currentFilters = activeFilters();
    const currentNamespace = namespace();
    const currentResourceType = resourceType();
    
    // Use untrack to avoid circular dependency 
    untrack(() => {
      const view = views().find(v => v.id === viewId);
      
      // Only update non-system views
      if (view && !view.isSystem) {
        // Check if any properties have actually changed before updating
        const filtersChanged = JSON.stringify(view.filters) !== JSON.stringify(currentFilters);
        const namespaceChanged = view.namespace !== currentNamespace;
        const resourceTypeChanged = view.resourceType !== currentResourceType;
        
        // Only proceed if something has changed
        if (filtersChanged || namespaceChanged || resourceTypeChanged) {
          // Update this view with current filters and settings
          const updatedView: View = {
            ...view,
            namespace: currentNamespace || 'all-namespaces',
            resourceType: currentResourceType,
            filters: [...currentFilters]
          };
          
          // Update the view in the views list
          const updatedViews = views().map(v => 
            v.id === updatedView.id ? updatedView : v
          );
          
          setViews(updatedViews);
          saveCustomViews(updatedViews);
          console.log('Custom view updated and saved:', updatedView.label);
        }
      }
    });
  });

  // Set the default title and update it based on the selected view
  createEffect(() => {
    const defaultTitle = "Capacitor";
    const currentView = views().find(view => view.id === selectedView());
    document.title = currentView ? `${defaultTitle} › ${currentView.label}` : defaultTitle;
  });

  return (
    <div class="layout">
      <main class="main-content">
        <div class="views">
          <div class="view-buttons">
            <For each={views()}>
              {(view) => (
                <div class="view-pill-container">
                  <button
                    class={`view-pill ${selectedView() === view.id ? 'selected' : ''}`}
                    onClick={() => setSelectedView(view.id)}
                  >
                    <span>{view.label}</span>
                    {selectedView() === view.id && !view.isSystem && (
                      <span 
                        class="view-delete" 
                        title="Delete view"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirmation(view.id);
                        }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                </div>
              )}
            </For>
            {!showNewViewForm() ? (
              <button
                class="view-pill new-view"
                onClick={handleNewViewButtonClick}
              >
                +
              </button>
            ) : (
              <button
                class="view-pill new-view-creating"
              >
                {newViewName() || "New View"}
              </button>
            )}
          </div>
          <span 
            classList={{ 
              "watch-status": true, 
              "error": watchStatus() !== "●" 
            }}
          >
            {watchStatus()}
          </span>
        </div>
        
        {showNewViewForm() && (
          <div class="new-view-form">
            <input
              type="text"
              placeholder="View name"
              value={newViewName()}
              onInput={(e) => setNewViewName(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              ref={el => newViewNameInput = el}
            />
            <div class="new-view-actions">
              <button class="new-view-cancel" onClick={cancelNewView}>Cancel</button>
              <button 
                class="new-view-save" 
                onClick={createNewView}
                disabled={!newViewName().trim()}
              >
                Save
              </button>
            </div>
          </div>
        )}
        
        {showDeleteConfirmation() && (
          <div class="delete-confirmation">
            <p>Are you sure you want to delete this view?</p>
            <div class="delete-actions">
              <button 
                class="delete-cancel" 
                onClick={() => setShowDeleteConfirmation(null)}
              >
                Cancel
              </button>
              <button 
                class="delete-confirm" 
                onClick={() => deleteView(showDeleteConfirmation()!)}
              >
                Delete
              </button>
            </div>
          </div>
        )}
        
        <FilterBar 
          filters={[namespaceFilter, resourceTypeFilter, nameFilter, ...(ResourceTypes.find(t => t.value === resourceType())?.filters || [])]}
          activeFilters={activeFilters()}
          onFilterChange={handleFilterChange}
        />

        <section class="resource-section full-width">
          <Show when={resourceType() === 'services'}>
            <ServiceList 
              services={services()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'deployments'}>
            <DeploymentList 
              deployments={deployments()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'pods'}>
            <ResourceList 
              resources={pods()} 
              columns={podColumns}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'fluxcd'}>
            <FluxResourceList 
              kustomizations={kustomizations()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'argocd'}>
            <ArgoCDResourceList 
              applications={applications()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
        </section>
      </main>
    </div>
  );
}