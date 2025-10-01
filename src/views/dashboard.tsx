import { createSignal, createEffect, Show, onMount, createMemo } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar } from "../components/filterBar/FilterBar.tsx";
// import { watchResource } from "../watches.tsx"; // Commented out: switching from watch to simple fetch (Table)
import { onCleanup } from "solid-js";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "../components/ErrorDisplay.tsx";
import { resourceTypeConfigs, type Column } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "../components/resourceList/PodList.tsx";
import { setJobNodeOptions } from "../components/resourceList/JobList.tsx";
import { sortByName, sortByAge, sortByNamespace } from "../utils/sortUtils.ts";

export function Dashboard() {
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  // const [watchStatus, setWatchStatus] = createSignal("●"); // Commented out: watch indicator not used with simple fetch
  // const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]); // Commented out: no live watches
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [initialLoadComplete, setInitialLoadComplete] = createSignal(true);
  const [resourceCount, setResourceCount] = createSignal(0);
  
  let contextDropdownRef: HTMLDivElement | undefined;

  // Resource state
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});
  // Dynamic columns from K8s Table response
  const [tableColumns, setTableColumns] = createSignal<Column<any>[] | null>(null);
  const [listResetKey, setListResetKey] = createSignal(0);

  // Function to switch to a new context
  const handleContextSwitch = async (contextName: string) => {
    if (contextName === apiResourceStore.contextInfo?.current) {
      setContextMenuOpen(false);
      return;
    }
    
    try {
      // Clear in-memory resources immediately
      setDynamicResources(() => ({}));

      await apiResourceStore.switchContext(contextName);
      // Bump reset key so ResourceList clears its internal UI state
      setListResetKey(prev => prev + 1);
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
    // untrack(() => {
    //   watchControllers().forEach(controller => controller.abort());
    // });
  });

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {    
    // Simple fetch of resources using Table response instead of watches
    const handleFetchTable = async () => {
      try {
        setInitialLoadComplete(false);
        setResourceCount(0);
        await fetchResourceTable(filterStore.getNamespace(), filterStore.getResourceType());
      } catch (error) {
        console.error('Error fetching resources (Table):', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch resources';
        errorStore.setApiError(`Failed to fetch resources: ${errorMessage}`);
        setInitialLoadComplete(true);
      }
    };

    handleFetchTable();
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
      // After connection restoration, re-fetch the resources
      fetchResourceTable(filterStore.getNamespace(), filterStore.getResourceType()).catch(error => {
        console.error('Error reloading resources after connection restoration:', error);
      });
    }
  });
  // Note: Watch-related batching removed in fetch mode

  // Error handler for watch failures
  // const handleWatchError = (message: string, path: string) => {
  //   console.log('Watch error:', { message, path });
  //   errorStore.setWatchError(message, path);
  // };

  // Watches disabled: using Table-based fetch

  // Fetch resources using the Kubernetes Table response and build dynamic columns
  const fetchResourceTable = async (ns: string | undefined, resourceType: string | undefined) => {
    if (!resourceType) return;

    // Clear existing resources and columns
    setDynamicResources(() => ({}));
    setTableColumns(null);

    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    if (!k8sResource) return;

    // Construct list path
    let listPath = `${k8sResource.apiPath}/${k8sResource.name}`;
    if (k8sResource.namespaced && ns && ns !== 'all-namespaces') {
      listPath = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}`;
    }

    // Use apiPath as-is; it already contains the correct /k8s/<context> prefix
    const url = listPath;

    try {
      const resp = await fetch(url, {
        headers: {
          // Ask for Table; fallback to JSON if server does not honor it
          'Accept': 'application/json;as=Table;g=meta.k8s.io;v=v1, application/json'
        }
      });
      if (!resp.ok) {
        throw new Error(`${resp.status} ${resp.statusText}`);
      }
      const data = await resp.json();

      // If we didn't get a Table, fall back to listing items
      if (data?.kind !== 'Table' || !Array.isArray(data?.rows)) {
        const items = Array.isArray(data?.items) ? data.items : [];
        setDynamicResources(prev => ({ ...prev, [k8sResource.id]: items }));
        setResourceCount(items.length);
        setInitialLoadComplete(true);
        setTableColumns(null);
        return;
      }

      const columnDefs = Array.isArray(data?.columnDefinitions) ? data.columnDefinitions : [];
      const rows = Array.isArray(data?.rows) ? data.rows : [];

      // Build dynamic columns based on Table column definitions
      const cols: Column<any>[] = columnDefs.map((def: any, idx: number) => ({
        header: String(def?.name || ''),
        width: `${Math.max(10, Math.floor(100 / Math.max(1, columnDefs.length)))}%`,
        accessor: (resource: any) => <>{(resource as any)?.__cells?.[idx] ?? ''}</>,
        sortable: false
      }));
      setTableColumns(cols);

      // Map rows to underlying objects while attaching cells for rendering
      const mapped = rows
        .map((r: any) => {
          const obj = r?.object || {};
          try {
            // Attach cells for UI rendering
            (obj as any).__cells = Array.isArray(r?.cells) ? r.cells : [];
          } catch (_e) {
            // ignore attach errors
          }
          return obj;
        });

      // Sort once by name for stable display when possible
      mapped.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));

      setDynamicResources(prev => ({ ...prev, [k8sResource.id]: mapped }));
      setResourceCount(mapped.length);
      setInitialLoadComplete(true);
    } catch (err) {
      console.error('Failed fetching Table list:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errorStore.setApiError(`Failed to fetch resources: ${msg}`);
      setInitialLoadComplete(true);
    }
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
                {/* Watch status removed in fetch mode */}
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
          initialLoadComplete={initialLoadComplete()}
          resourceCount={resourceCount()}
        />

        <section class="resource-section full-width">
          <Show when={errorStore.currentError} fallback={
            <ResourceList 
              resources={filteredResources()}
              resourceTypeConfig={currentResourceConfig()!}
              resetKey={listResetKey()}
              overrideColumns={tableColumns() || undefined}
            />
          }>
            <ErrorDisplay class="inline" />
          </Show>
        </section>
      </main>
    </div>
  );
}
