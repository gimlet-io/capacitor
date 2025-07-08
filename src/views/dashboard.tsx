import { createSignal, createEffect, untrack, Show, onMount, createMemo } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar } from "../components/filterBar/FilterBar.tsx";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { updateDeploymentMatchingResources, updateReplicaSetMatchingResources } from "../utils/k8s.ts";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "../components/ErrorDisplay.tsx";
import { resourceTypeConfigs } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "../components/resourceList/PodList.tsx";
import { sortByName, sortByNamespace, sortByAge } from "../resourceTypeConfigs.tsx";

export function Dashboard() {
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
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
    'apps/ReplicaSet': [
      {
        resourceType: 'core/Pod',
        updater: (replicaSet, pods) => updateReplicaSetMatchingResources(replicaSet, pods)
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
      setContextMenuOpen(false);
    } catch (error) {
      console.error("Error switching context in dashboard:", error);
      
      // Show error to user when context switch fails
      const errorMessage = error instanceof Error ? error.message : 'Failed to switch context';
      console.log('Processing context switch error:', errorMessage);
      
      if (errorMessage.includes('Failed to fetch') || 
          errorMessage.includes('NetworkError') || 
          errorMessage.includes('TypeError') ||
          errorMessage.includes('ERR_CONNECTION_REFUSED') ||
          errorMessage.includes('fetch')) {
        console.log('Setting server error for context switch');
        errorStore.setServerError('Cannot connect to server. Please check if the server is running.');
      } else {
        console.log('Setting API error for context switch');
        errorStore.setApiError(`Context switch failed: ${errorMessage}`);
      }
      
      setContextMenuOpen(false);
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
    // Handle async setupWatches
    const handleSetupWatches = async () => {
      try {
        await setupWatches(filterStore.getNamespace(), filterStore.getResourceType());
      } catch (error) {
        console.error('Error setting up watches:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to set up watches';
        if (errorMessage.includes('Cannot connect to server') || 
            errorMessage.includes('server may be down') ||
            errorMessage.includes('server may be unreachable')) {
          console.log('[Dashboard] Setting server error due to watch setup failure');
          errorStore.setServerError('Cannot connect to server. Please check if the server is running.');
        } else {
          console.log('[Dashboard] Setting watch error due to watch setup failure');
          errorStore.setWatchError(`Failed to watch resources: ${errorMessage}`);
        }
      }
    };
    
    handleSetupWatches();
  });

  // Monitor API resource loading errors and handle retries
  const [retryTimer, setRetryTimer] = createSignal<number | null>(null);
  const [connectionLost, setConnectionLost] = createSignal(false);
  
  // Function to retry loading resources
  const retryLoadResources = () => {
    console.log('Retrying to load resources...');
    apiResourceStore.refetchResources();
  };
  
  // Clear retry timer when component unmounts
  onCleanup(() => {
    if (retryTimer() !== null) {
      clearTimeout(retryTimer()!);
    }
  });
  
  // Monitor API resource loading errors
  createEffect(() => {
    const lastError = apiResourceStore.lastError;
    const resources = apiResourceStore.apiResources;
    const namespaces = apiResourceStore.namespaces;
    const contexts = apiResourceStore.contextInfo;
    
    // If there's an error from the API resource store, show it
    if (lastError) {
      console.log('Setting connection lost due to error:', lastError);
      // Mark connection as lost to ensure we detect reconnection
      setConnectionLost(true);
      
      if (lastError.includes('connection refused') || lastError.includes('Failed to fetch')) {
        errorStore.setServerError('Cannot connect to Kubernetes cluster. Please check your connection and ensure the server can reach the Kubernetes API.');
      } else {
        errorStore.setApiError(lastError);
      }
      
      // Set up retry timer if not already set
      if (retryTimer() === null) {
        const timer = setTimeout(() => {
          retryLoadResources();
          // Reset timer ID after retry
          setRetryTimer(null);
        }, 5000);
        setRetryTimer(timer);
      }
    } else {
      // No error from API store
      // If we have successful data and previously had a connection error, connection is restored
      if ((resources !== undefined || namespaces !== undefined || contexts !== undefined) &&
          connectionLost()) {
        
        console.log('Connection restored! Clearing error and resetting state');
        // Connection restored, clear error and reset connection state
        errorStore.clearError();
        setConnectionLost(false);
        
        // Clear any pending retry timer
        if (retryTimer() !== null) {
          clearTimeout(retryTimer()!);
          setRetryTimer(null);
        }
        
        // Reload resources and watches
        setupWatches(filterStore.getNamespace(), filterStore.getResourceType()).catch(error => {
          console.error('Error reloading watches after connection restoration:', error);
        });
      } else if (!connectionLost() && 
                 (errorStore.currentError?.type === 'server' || errorStore.currentError?.type === 'api')) {
        // We have data but still showing an error from a previous state - clear it
        console.log('Clearing stale error');
        errorStore.clearError();
      }
    }
  });

  // Maintain resources for each extra watch
  const extraResources: Record<string, any[]> = {};

  // Error handler for watch failures
  const handleWatchError = (message: string, path: string) => {
    console.log('Watch error:', { message, path });
    
    // Check if this is a server connection error
    if (message.includes('WebSocket connection closed') || 
        message.includes('Failed to connect') ||
        message.includes('Connection failed') ||
        message.includes('Unable to connect to server') ||
        message.includes('connection refused')) {
      errorStore.setServerError('Cannot connect to server. Please check if the server is running.');
    } else {
      errorStore.setWatchError(message, path);
    }
  };

  /**
   * Sets up watches for the selected resource type and any related resources
   * configured in extraWatches.
   * 
   * @param ns The selected namespace or undefined for all namespaces
   * @param resourceFilter The selected resource type to watch
   */
  const setupWatches = async (ns: string | undefined, resourceType: string | undefined) => {
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
      callback: (event: { type: string; object: any; error?: string; path?: string }) => {
        // Handle ERROR events from the WebSocket
        if (event.type === 'ERROR') {
          handleWatchError(event.error || 'Unknown watch error', event.path || watchPath);
          return;
        }
        
        // Clear any existing errors when we receive data successfully
        if (errorStore.currentError?.type === 'watch') {
          errorStore.clearError();
        }
        
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
        
        // Set up watch for this extra resource
        let extraWatchPath = `${extraResource.apiPath}/${extraResource.name}?watch=true`;
        if (extraResource.namespaced && ns && ns !== 'all-namespaces') {
          extraWatchPath = `${extraResource.apiPath}/namespaces/${ns}/${extraResource.name}?watch=true`;
        }
        
        watches.push({
          path: extraWatchPath,
          callback: (event: { type: string; object: any; error?: string; path?: string }) => {
            // Handle ERROR events from the WebSocket
            if (event.type === 'ERROR') {
              handleWatchError(event.error || 'Unknown watch error', event.path || extraWatchPath);
              return;
            }
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
      try {
        watchResource(path, callback, controller, setWatchStatus, handleWatchError);
      } catch (error) {
        console.error(`Failed to start watch for ${path}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown watch error';
        handleWatchError(errorMessage, path);
      }
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

  // Populate node filter options for pods
  createEffect(() => {
    const resourceType = filterStore.getResourceType();
    if (resourceType !== 'core/Pod') return;
    
    // Get all pods and extract unique node names
    const allPods = dynamicResources()[resourceType] || [];
    const uniqueNodes = [...new Set(
      allPods
        .map((pod: any) => pod.spec?.nodeName)
        .filter((nodeName: string) => nodeName) // Filter out undefined/null nodes
    )].sort();
    
    // Update the node filter options using the exported setter
    setNodeOptions(uniqueNodes.map((nodeName: string) => ({
      value: nodeName,
      label: nodeName
    })));
  });

  // Look up the current resource type configuration
  const currentResourceConfig = createMemo(() => {
    const resourceType = filterStore.getResourceType();
    return resourceType && resourceTypeConfigs[resourceType] ? resourceTypeConfigs[resourceType] : {
      columns: [
        { 
          header: "Name", 
          width: "40%", 
          accessor: (item) => <>{item.metadata?.name || ""}</>,
          sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
        },
        { 
          header: "Namespace", 
          width: "30%", 
          accessor: (item) => <>{item.metadata?.namespace || ""}</>,
          sortFunction: (items: any[], ascending: boolean) => sortByNamespace(items, ascending),
        },
        { 
          header: "Age", 
          width: "30%", 
          accessor: (item) => useCalculateAge(item.metadata?.creationTimestamp || '')(),
          sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
        }
      ]
    };
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
          <Show when={errorStore.currentError} fallback={
            <ResourceList 
              resources={filteredResources()}
              resourceTypeConfig={currentResourceConfig()!}
            />
          }>
            <ErrorDisplay class="inline" />
          </Show>
        </section>
      </main>
    </div>
  );
}
