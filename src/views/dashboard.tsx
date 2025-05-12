import { createSignal, createEffect, untrack, Show, onMount, createMemo } from "solid-js";
import { DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList, ResourceList } from "../components/index.ts";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar } from "../components/filterBar/FilterBar.tsx";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";
import { podColumns } from "../components/resourceList/PodList.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { updateDeploymentMatchingResources, updateServiceMatchingResources } from "../utils/k8s.ts";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { StatefulSetList } from "../components/resourceList/StatefulSetList.tsx";

export function Dashboard() {
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  
  let contextDropdownRef: HTMLDivElement | undefined;

  // Resource state
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});

  // Define extra watches for certain resource types
  type ResourceUpdater = (mainResource: any, extraResources: any[]) => any;
  type ExtraWatchConfig = {
    resourceType: string;          // The type of resource to watch 
    updater: ResourceUpdater;      // Function to update main resource with the extra resource data
    isNamespaced?: boolean;        // Whether this resource is namespaced
    apiPath?: string;              // API path override (if different from default)
  };

  /**
   * Configuration for extra watches that maintain relationships between resources.
   * 
   * For example, when viewing Deployments, we also watch Pods to show which pods
   * belong to each deployment.
   * 
   * The structure is:
   * {
   *   'mainResourceType': [
   *     {
   *       resourceType: 'relatedResourceType',  // The type of resource to watch
   *       updater: (mainResource, relatedResources) => updatedMainResource,
   *       // Optional API path and namespace configuration if needed
   *     }
   *   ]
   * }
   * 
   * The updater function is called when:
   * 1. The main resource is added or modified
   * 2. Any related resource is added, modified, or deleted
   * 
   * To add additional relationships, add more entries to this object.
   */
  const extraWatches: Record<string, ExtraWatchConfig[]> = {
    'apps/Deployment': [
      {
        resourceType: 'core/Pod',
        updater: (deployment, pods) => updateDeploymentMatchingResources(deployment, pods)
      }
    ],
    'core/Service': [
      {
        resourceType: 'core/Pod',
        updater: (service, pods) => {
          // We need to temporarily store pods separately for the second updater
          // but the matchingPods field will be properly populated in the second updater
          return { ...service, _tempPods: pods };
        }
      },
      {
        resourceType: 'apps/Deployment',
        updater: (service, deployments) => {
          // Get the pods from the temporary field
          const allPods = service._tempPods || [];
          // Create a clean version of service without the temp field
          const { _tempPods, ...cleanService } = service;
          // Use the utility function that correctly sets matchingPods and matchingDeployments
          return updateServiceMatchingResources(cleanService, allPods, deployments);
        }
      }
    ]
  };

  // Function to switch to a new context
  const handleContextSwitch = async (contextName: string) => {
    if (contextName === apiResourceStore.contextInfo?.current) {
      setContextMenuOpen(false);
      return;
    }
    
    try {
      await apiResourceStore.switchContext(contextName);
      
      // Cancel existing watches
      untrack(() => {
        watchControllers().forEach(controller => controller.abort());
      });
      
      // Clear existing resources
      setDynamicResources(() => ({}));
      
      // Set up new watches with the new context
      setupWatches(filterStore.getNamespace(), filterStore.getResourceType());
      
      setContextMenuOpen(false);
    } catch (error) {
      console.error("Error switching context:", error);
      // You could add an error notification here
    }
  };
  
  // Handle clicks outside the context dropdown
  const handleOutsideClick = (e: MouseEvent) => {
    if (contextDropdownRef && !contextDropdownRef.contains(e.target as Node)) {
      setContextMenuOpen(false);
    }
  };
  
  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
  });
  
  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {
    setupWatches(filterStore.getNamespace(), filterStore.getResourceType());
  });

  // Maintain resources for each extra watch
  const extraResources: Record<string, any[]> = {};

  /**
   * Sets up watches for the selected resource type and any related resources
   * configured in extraWatches.
   * 
   * @param ns The selected namespace or undefined for all namespaces
   * @param resourceFilter The selected resource type to watch
   */
  const setupWatches = (ns: string | undefined, resourceType: string | undefined) => {
    if (!resourceType) return;

    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources and cache
    setDynamicResources(() => ({}));
    Object.keys(extraResources).forEach(key => {
      extraResources[key] = [];
    });
    
    const watches = [];

    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    if (!k8sResource) return;
  
    // Only use namespace path if the resource is namespaced and we have a valid namespace
    let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
    if (k8sResource.namespaced && ns && ns !== 'all-namespaces') {
      watchPath = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}?watch=true`;
    }
    
    watches.push({
      path: watchPath,
      callback: (event: { type: string; object: any }) => {
        if (event.type === 'ADDED') {
          setDynamicResources(prev => {
            const current = prev[k8sResource.id] || [];
            
            // Check if we need to apply extra resource updates
            const extraWatchesForResource = extraWatches[k8sResource.id];
            let enhancedResource = event.object;
            
            if (extraWatchesForResource && extraWatchesForResource.length > 0) {
              // Apply all updaters to the new resource
              extraWatchesForResource.forEach(config => {
                const relatedResources = extraResources[config.resourceType] || [];
                enhancedResource = config.updater(enhancedResource, relatedResources);
              });
            }
            
            // Add new resource and sort alphabetically by name
            const updatedResources = [...current, enhancedResource].sort((a, b) => 
              a.metadata.name.localeCompare(b.metadata.name)
            );
            
            return { ...prev, [k8sResource.id]: updatedResources };
          });
        } else if (event.type === 'MODIFIED') {
          setDynamicResources(prev => {
            const current = prev[k8sResource.id] || [];
            
            // Check if we need to apply extra resource updates
            const extraWatchesForResource = extraWatches[k8sResource.id];
            let enhancedResource = event.object;
            
            if (extraWatchesForResource && extraWatchesForResource.length > 0) {
              // Apply all updaters to the modified resource
              extraWatchesForResource.forEach(config => {
                const relatedResources = extraResources[config.resourceType] || [];
                enhancedResource = config.updater(enhancedResource, relatedResources);
              });
            }
            
            return { 
              ...prev, 
              [k8sResource.id]: current.map((res: any) => 
                res.metadata.name === event.object.metadata.name ? enhancedResource : res
              )
            };
          });
        } else if (event.type === 'DELETED') {
          setDynamicResources(prev => {
            const current = prev[k8sResource.id] || [];
            return { 
              ...prev, 
              [k8sResource.id]: current.filter((res: any) => 
                res.metadata.name !== event.object.metadata.name
              )
            };
          });
        }
      }
    });

    // Set up extra watches if configured for this resource type
    const extraWatchesForResource = extraWatches[k8sResource.id];
    if (extraWatchesForResource && extraWatchesForResource.length > 0) {
      // For each extra watch configuration
      extraWatchesForResource.forEach(config => {
        const extraResourceType = config.resourceType;
        const extraResource = filterStore.k8sResources.find(res => res.id === extraResourceType);
        
        if (!extraResource) return;
        
        // Determine the API path for this resource
        const extraApiPath = config.apiPath || extraResource.apiPath;
        const extraResourceName = extraResource.name;
        const extraIsNamespaced = config.isNamespaced !== undefined ? config.isNamespaced : extraResource.namespaced;
        
        // Set up watch for this extra resource
        let extraWatchPath = `${extraApiPath}/${extraResourceName}?watch=true`;
        if (extraIsNamespaced && ns && ns !== 'all-namespaces') {
          extraWatchPath = `${extraApiPath}/namespaces/${ns}/${extraResourceName}?watch=true`;
        }
        
        watches.push({
          path: extraWatchPath,
          callback: (event: { type: string; object: any }) => {
            // Update cache based on event type
            if (event.type === 'ADDED') {
              extraResources[extraResourceType] = [
                ...(extraResources[extraResourceType] || []),
                event.object
              ];
            } else if (event.type === 'MODIFIED') {
              extraResources[extraResourceType] = (extraResources[extraResourceType] || [])
                .map(item => item.metadata.name === event.object.metadata.name ? event.object : item);
            } else if (event.type === 'DELETED') {
              extraResources[extraResourceType] = (extraResources[extraResourceType] || [])
                .filter(item => item.metadata.name !== event.object.metadata.name);
            }
            
            // Update dynamic resources state
            setDynamicResources(prev => {
              // Update the extra resource collection and sort alphabetically
              const sortedExtraResources = [...extraResources[extraResourceType]].sort((a, b) => 
                a.metadata.name.localeCompare(b.metadata.name)
              );
              
              const newState = { 
                ...prev,
                [extraResourceType]: sortedExtraResources
              };
              
              // Update the main resources using the updater function
              const mainResources = prev[resourceType] || [];
              if (mainResources.length > 0) {
                // Apply this updater to each main resource
                let updatedResources = mainResources.map(resource => 
                  config.updater(resource, extraResources[extraResourceType] || [])
                );
                
                // For resources with multiple watches, we need to make sure all updaters are applied
                const otherExtraWatches = extraWatchesForResource.filter(w => w !== config);
                if (otherExtraWatches.length > 0) {
                  otherExtraWatches.forEach(otherConfig => {
                    // Get the cache for this other watch type
                    const otherResources = extraResources[otherConfig.resourceType] || [];
                    // Apply the other updater to each resource
                    updatedResources = updatedResources.map(resource => 
                      otherConfig.updater(resource, otherResources)
                    );
                  });
                }
                
                newState[resourceType] = updatedResources;
              }
              
              return newState;
            });
          }
        });
      });
    }

    const controllers = watches.map(({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
  };

  // Filter resources based on active filters
  const filteredResources = createMemo(() => {
    const resources = dynamicResources()[filterStore.getResourceType() || ''] || [];
    const filters = filterStore.activeFilters.filter(filter => filter.name !== "ResourceType" && filter.name !== "Namespace");
    if (filters.length === 0) { return resources }

    return resources.filter(resource => filters.some(filter => filterStore.filterRegistry[filter.name]?.filterFunction(resource, filter.value)));
  });

  return (
    <div class="layout">
      <main class="main-content">
        <div class="header-section">
          {/* Context display on the left */}
          <Show when={apiResourceStore.contextInfo}>
            <div class="context-dropdown" ref={contextDropdownRef}>
              <div 
                class="context-display" 
                onClick={() => setContextMenuOpen(!contextMenuOpen())}
              >
                <span class="context-label">Current Context:</span>
                <span class="context-name">{apiResourceStore.contextInfo?.current}</span>
                <span class="context-dropdown-arrow">▼</span>
                <Show when={watchStatus}>
                  <span 
                    classList={{ 
                      "watch-status": true, 
                      "error": watchStatus() !== "●" 
                    }}
                  >
                    {watchStatus()}
                  </span>
                </Show>
              </div>
              
              <Show when={contextMenuOpen()}>
                <div class="context-menu">
                  {apiResourceStore.contextInfo?.contexts.map(context => (
                    <div 
                      class={`context-menu-item ${context.isCurrent ? 'active' : ''}`}
                      onClick={() => handleContextSwitch(context.name)}
                    >
                      <span class="context-menu-name">{context.name}</span>
                      {context.clusterName && (
                        <span class="context-menu-details">
                          Cluster: {context.clusterName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Show>
            </div>
          </Show>
          
          {/* Views taking all horizontal space */}
          <div class="views-container">
            <ViewBar
              activeFilters={filterStore.activeFilters}
              setActiveFilters={filterStore.setActiveFilters}
            />
          </div>
        </div>

        <FilterBar
          filters={filterStore.filters}
          activeFilters={filterStore.activeFilters}
          onFilterChange={filterStore.setActiveFilters}
        />

        <section class="resource-section full-width">
          {/* Special rendering for known resource types */}
          <Show when={filterStore.getResourceType() === 'core/Pod'}>
            <ResourceList 
              resources={filteredResources()}
              columns={podColumns}
            />
          </Show>
          <Show when={filterStore.getResourceType() === 'apps/Deployment'}>
            <DeploymentList 
              deployments={filteredResources()}
            />
          </Show>
          <Show when={filterStore.getResourceType() === 'apps/StatefulSet'}>
            <StatefulSetList 
              statefulSets={filteredResources()}
            />
          </Show>
          <Show when={filterStore.getResourceType() === 'core/Service'}>
            <ServiceList 
              services={filteredResources()}
            />
          </Show>
          <Show when={filterStore.getResourceType() === 'kustomize.toolkit.fluxcd.io/Kustomization'}>
            <FluxResourceList 
              kustomizations={filteredResources()}
            />
          </Show>
          <Show when={filterStore.getResourceType() === 'argoproj.io/Application'}>
            <ArgoCDResourceList 
              applications={filteredResources()}
            />
          </Show>
          
          {/* Default rendering for other resource types */}
          <Show when={!['core/Pod', 'apps/Deployment', 'apps/StatefulSet', 'core/Service', 'kustomize.toolkit.fluxcd.io/Kustomization', 'argoproj.io/Application'].includes(filterStore.getResourceType() || 'core/Pod')}>
            <ResourceList 
              resources={filteredResources()} 
              columns={[
                { 
                  header: "Name", 
                  width: "40%", 
                  accessor: (item) => <>{item.metadata?.name || ""}</> 
                },
                { 
                  header: "Namespace", 
                  width: "30%", 
                  accessor: (item) => <>{item.metadata?.namespace || ""}</> 
                },
                { 
                  header: "Age", 
                  width: "30%", 
                  accessor: (item) => useCalculateAge(item.metadata?.creationTimestamp || '')()
                }
              ]}
            />
          </Show>
        </section>
      </main>
    </div>
  );
}
