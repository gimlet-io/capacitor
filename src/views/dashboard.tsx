import { createSignal, createEffect, untrack, Show, onMount, createMemo } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar } from "../components/filterBar/FilterBar.tsx";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "../components/ErrorDisplay.tsx";
import { resourceTypeConfigs } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "../components/resourceList/PodList.tsx";
import { setJobNodeOptions } from "../components/resourceList/JobList.tsx";
import { ExtraWatchConfig } from "../resourceTypeConfigs.tsx";
import { sortByName, sortByAge, sortByNamespace } from "../utils/sortUtils.ts";

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
      errorStore.setApiError(`Context switch failed: ${errorMessage}`);
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
        console.log('[Dashboard] Setting watch error due to watch setup failure');
        errorStore.setWatchError(`Failed to watch resources: ${errorMessage}`);
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
  
  // Monitor errors and handle retries for API/server connectivity
  createEffect(() => {
    const currentError = errorStore.currentError;
    const resources = apiResourceStore.apiResources;
    const namespaces = apiResourceStore.namespaces;
    const contexts = apiResourceStore.contextInfo;

    // If there's an API/server error, mark connection lost and schedule retry
    if (currentError && (currentError.type === 'api' || currentError.type === 'server')) {
      if (!connectionLost()) {
        console.log('Setting connection lost due to error:', currentError.message);
        setConnectionLost(true);
      }
      if (retryTimer() === null) {
        const timer = setTimeout(() => {
          retryLoadResources();
          setRetryTimer(null);
        }, 5000);
        setRetryTimer(timer);
      }
      return;
    }

    // If we have data and previously had a connection error, consider connection restored
    if ((resources !== undefined || namespaces !== undefined || contexts !== undefined) && connectionLost()) {
      console.log('Connection appears restored; resetting state');
      setConnectionLost(false);
      if (retryTimer() !== null) {
        clearTimeout(retryTimer()!);
        setRetryTimer(null);
      }
      setupWatches(filterStore.getNamespace(), filterStore.getResourceType()).catch(error => {
        console.error('Error reloading watches after connection restoration:', error);
      });
    }
  });

  // Maintain resources for each extra watch
  const extraResources: Record<string, any[]> = {};

  // Batch queues and timers per resource type id
  const batchQueues: Record<string, Array<{ type: 'ADDED' | 'MODIFIED' | 'DELETED'; object: any }>> = {};
  const batchTimers: Record<string, number | undefined> = {};

  const scheduleFlush = (resourceTypeId: string, extraWatchesForResource?: ExtraWatchConfig[]) => {
    if (batchTimers[resourceTypeId] !== undefined) return;
    batchTimers[resourceTypeId] = setTimeout(() => {
      const changes = batchQueues[resourceTypeId] || [];
      batchQueues[resourceTypeId] = [];
      batchTimers[resourceTypeId] = undefined;
      if (changes.length === 0 && (!extraWatchesForResource || extraWatchesForResource.length === 0)) return;

      setDynamicResources(prev => {
        const current = prev[resourceTypeId] || [];
        // Build index by name for efficient updates
        const nameToIndex = new Map<string, number>();
        for (let i = 0; i < current.length; i++) {
          nameToIndex.set(current[i]?.metadata?.name, i);
        }
        let next = current.slice();

        // Apply queued changes
        for (const evt of changes) {
          const name = evt.object?.metadata?.name;
          if (!name) continue;
          if (evt.type === 'DELETED') {
            const idx = nameToIndex.get(name);
            if (idx !== undefined) {
              next.splice(idx, 1);
              // rebuild map lazily
              nameToIndex.delete(name);
            }
          } else {
            // Enhance via extra watchers if provided
            let enhanced = evt.object;
            if (extraWatchesForResource && extraWatchesForResource.length > 0) {
              for (const cfg of extraWatchesForResource) {
                const related = extraResources[cfg.resourceType] || [];
                enhanced = cfg.updater(enhanced, related);
              }
            }
            const idx = nameToIndex.get(name);
            if (idx === undefined) {
              nameToIndex.set(name, next.length);
              next.push(enhanced);
            } else {
              next[idx] = enhanced;
            }
          }
        }

        // If extra resources changed since last flush, re-apply updaters across the list
        if (extraWatchesForResource && extraWatchesForResource.length > 0) {
          next = next.map(item => {
            let updated = item;
            for (const cfg of extraWatchesForResource) {
              const related = extraResources[cfg.resourceType] || [];
              updated = cfg.updater(updated, related);
            }
            return updated;
          });
        }

        // Sort once per flush by name (stable display)
        next.sort((a, b) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));

        return { ...prev, [resourceTypeId]: next };
      });
    }, 16) as unknown as number;
  };

  // Error handler for watch failures
  const handleWatchError = (message: string, path: string) => {
    console.log('Watch error:', { message, path });
    errorStore.setWatchError(message, path);
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
    const plannedWatchKeys = new Set<string>();

    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    if (!k8sResource) return;
  
    // Only use namespace path if the resource is namespaced and we have a valid namespace
    let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
    if (k8sResource.namespaced && ns && ns !== 'all-namespaces') {
      watchPath = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}?watch=true`;
    }
    
    const mainExtraWatches = resourceTypeConfigs[k8sResource.id]?.extraWatches || [];
    if (!plannedWatchKeys.has(watchPath)) {
      plannedWatchKeys.add(watchPath);
      watches.push({
        path: watchPath,
        callback: (event: { type: string; object: any; error?: string; path?: string }) => {
          // Handle ERROR events from the WebSocket
          if (event.type === 'ERROR') {
            handleWatchError(event.error || 'Unknown watch error', event.path || watchPath);
            return;
          }

          // Clear watch errors only when receiving data successfully
          if (errorStore.currentError?.type === 'watch') {
            errorStore.clearError();
          }

          // Queue event and schedule a flush for this resource type
          (batchQueues[k8sResource.id] ||= []).push({ type: event.type as any, object: event.object });
          scheduleFlush(k8sResource.id, mainExtraWatches);
        }
      });
    }

    // Set up extra watches if configured for this resource type
    const extraWatchesForResource = mainExtraWatches;
    if (extraWatchesForResource && extraWatchesForResource.length > 0) {
      // For each extra watch configuration
      extraWatchesForResource.forEach((config: ExtraWatchConfig) => {
        const extraResourceType = config.resourceType;
        const extraResource = filterStore.k8sResources.find(res => res.id === extraResourceType);
        
        if (!extraResource) return;
        
        // Set up watch for this extra resource
        let extraWatchPath = `${extraResource.apiPath}/${extraResource.name}?watch=true`;
        if (extraResource.namespaced && ns && ns !== 'all-namespaces') {
          extraWatchPath = `${extraResource.apiPath}/namespaces/${ns}/${extraResource.name}?watch=true`;
        }
        
        if (!plannedWatchKeys.has(extraWatchPath)) {
          plannedWatchKeys.add(extraWatchPath);
          watches.push({
            path: extraWatchPath,
            callback: (event: { type: string; object: any; error?: string; path?: string }) => {
              // Handle ERROR events from the WebSocket
              if (event.type === 'ERROR') {
                handleWatchError(event.error || 'Unknown watch error', event.path || extraWatchPath);
                return;
              }
              
              // Clear watch errors only when receiving data successfully
              if (errorStore.currentError?.type === 'watch') {
                errorStore.clearError();
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
              
              // Schedule a flush for the main resource type so updaters re-apply once per frame
              scheduleFlush(resourceType, extraWatchesForResource);
            }
          });
        }
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

  // Populate node filter options for jobs from matched pods
  createEffect(() => {
    const resourceType = filterStore.getResourceType();
    if (resourceType !== 'batch/Job') return;
    
    // Get all jobs and extract unique node names from pod template
    const allJobs = dynamicResources()[resourceType] || [];
    const uniqueNodes = [...new Set(
      allJobs
        .flatMap((job: any) => (job.pods || []).map((p: any) => p.spec?.nodeName))
        .filter((nodeName: string) => nodeName)
    )].sort();
    
    setJobNodeOptions(uniqueNodes.map((nodeName: string) => ({
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
