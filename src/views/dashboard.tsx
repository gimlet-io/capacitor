import { createSignal, createEffect, Show, onMount, createMemo, untrack } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar } from "../components/filterBar/FilterBar.tsx";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "../components/ErrorDisplay.tsx";
import { resourceTypeConfigs, type Column, namespaceColumn, type ExtraWatchConfig } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "../components/resourceList/PodList.tsx";
import { setJobNodeOptions } from "../components/resourceList/JobList.tsx";

export function Dashboard() {
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
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
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {    
    // Simple fetch of resources using Table response, then start stream to enhance with full objects
    const handleFetchTable = async () => {
      try {
        setInitialLoadComplete(false);
        setResourceCount(0);
        // Abort any existing watchers before starting new ones
        untrack(() => {
          watchControllers().forEach(c => c.abort());
        });
        setWatchControllers([]);
        await fetchResourceTable(filterStore.getNamespace(), filterStore.getResourceType());
        // await new Promise(resolve => setTimeout(resolve, 3000));;
        await startStream(filterStore.getNamespace(), filterStore.getResourceType());
        await startExtraWatches(filterStore.getNamespace(), filterStore.getResourceType());
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
          // Mark that this item originated from a Table response so accessors can fallback to cells
          (obj as any).__fromTable = true;
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

  // Start a simple stream (watch) to enhance/replace Table rows with full objects
  const startStream = async (ns: string | undefined, resourceType: string | undefined) => {
    try {
      if (!resourceType) return;
      const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
      if (!k8sResource) return;

      let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
      if (k8sResource.namespaced && ns && ns !== 'all-namespaces') {
        watchPath = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}?watch=true`;
      }

      const controller = new AbortController();
      setWatchControllers(prev => [...prev, controller]);
      const ctxName = apiResourceStore.contextInfo?.current;
      await watchResource(watchPath, (event: { type: string; object: any; error?: string; path?: string }) => {
        if (event.type === 'ERROR') {
          const msg = event.error || 'Unknown watch error';
          errorStore.setWatchError(msg, event.path || watchPath);
          return;
        }
        const obj = event.object;
        if (!obj?.metadata?.name) return;

        setDynamicResources(prev => {
          const list = (prev[k8sResource.id] || []).slice();
          const name = obj.metadata.name;
          let idx = -1;
          for (let i = 0; i < list.length; i++) {
            if ((list[i] as any)?.metadata?.name === name) { idx = i; break; }
          }
          if (event.type === 'DELETED') {
            if (idx !== -1) list.splice(idx, 1);
          } else {
            // Preserve table cells if present
            const prevItem = idx !== -1 ? list[idx] : undefined;
            let nextItem = { ...obj } as any;
            if ((prevItem as any)?.__cells && !nextItem.__cells) {
              nextItem.__cells = (prevItem as any).__cells;
            }
            // Enrich main resource with any available extra resources using configured updaters
            const cfg = resourceTypeConfigs[k8sResource.id];
            const extras: ExtraWatchConfig[] = Array.isArray(cfg?.extraWatches) ? cfg!.extraWatches! : [];
            for (const ex of extras) {
              const extraList = (prev[ex.resourceType] || []) as any[];
              try {
                nextItem = ex.updater(nextItem, extraList);
              } catch (_e) {
                // ignore enrich errors
              }
            }
            // Replace or append
            if (idx === -1) list.push(nextItem); else list[idx] = nextItem;
          }
          // Sort by name for stable display
          list.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
          // Update count if current type
          if (k8sResource.id === filterStore.getResourceType()) {
            setResourceCount(list.length);
          }
          return { ...prev, [k8sResource.id]: list };
        });
      }, controller, setWatchStatus, (msg, path) => errorStore.setWatchError(msg, path), ctxName);
    } catch (e) {
      console.error('Failed to start stream:', e);
    }
  };

  // Start watches for extra resource types defined by the current main resource type
  const startExtraWatches = async (ns: string | undefined, resourceType: string | undefined) => {
    try {
      if (!resourceType) return;
      const mainRes = filterStore.k8sResources.find(res => res.id === resourceType);
      if (!mainRes) return;
      const cfg = resourceTypeConfigs[resourceType];
      const extras: ExtraWatchConfig[] = Array.isArray(cfg?.extraWatches) ? cfg!.extraWatches! : [];
      if (extras.length === 0) return;

      const ctxName = apiResourceStore.contextInfo?.current;

      for (const ex of extras) {
        const extraRes = filterStore.k8sResources.find(r => r.id === ex.resourceType);
        if (!extraRes) continue;
        let extraPath = `${extraRes.apiPath}/${extraRes.name}?watch=true`;
        if (extraRes.namespaced && ns && ns !== 'all-namespaces') {
          extraPath = `${extraRes.apiPath}/namespaces/${ns}/${extraRes.name}?watch=true`;
        }
        const controller = new AbortController();
        setWatchControllers(prev => [...prev, controller]);

        const noopSetWatchStatus = (_: string) => {};
        await watchResource(
          extraPath,
          (event: { type: string; object: any; error?: string; path?: string }) => {
            if (event.type === 'ERROR') {
              const msg = event.error || 'Unknown watch error';
              errorStore.setWatchError(msg, event.path || extraPath);
              return;
            }
            const obj = event.object;
            if (!obj?.metadata?.name) return;

            setDynamicResources(prev => {
              // Update extra resource cache
              const extraList = (prev[ex.resourceType] || []).slice();
              const name = obj.metadata.name;
              let idx = -1;
              for (let i = 0; i < extraList.length; i++) {
                if ((extraList[i] as any)?.metadata?.name === name) { idx = i; break; }
              }
              if (event.type === 'DELETED') {
                if (idx !== -1) extraList.splice(idx, 1);
              } else {
                if (idx === -1) extraList.push(obj); else extraList[idx] = obj;
              }

              // Enrich main list items using the updater and updated extra list
              const mainId = mainRes.id;
              const currentMain = (prev[mainId] || []) as any[];
              const enriched = currentMain.map(item => {
                try {
                  return ex.updater(item, extraList);
                } catch (_e) {
                  return item;
                }
              });
              // Maintain stable sort by name
              enriched.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));

              const next: Record<string, any[]> = { ...prev, [ex.resourceType]: extraList, [mainId]: enriched };
              return next;
            });
          },
          controller,
          noopSetWatchStatus,
          (msg, path) => errorStore.setWatchError(msg, path),
          ctxName
        );
      }
    } catch (e) {
      console.error('Failed to start extra watches:', e);
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

  // Build effective columns in one place: prefer configured columns; when only Table object is present, fallback to table cells matching headers.
  // Also inject the Namespace column for namespaced resources when viewing all namespaces.
  const effectiveColumns = createMemo<Column<any>[]>(() => {
    const resourceType = filterStore.getResourceType();
    const cfg = resourceType ? resourceTypeConfigs[resourceType] : undefined;
    const tblCols = tableColumns();
    const tblNames = Array.isArray(tblCols) ? tblCols.map(c => String((c as any)?.header || '').toLowerCase()) : [];

    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    const namespaced = Boolean(k8sResource?.namespaced);
    const ns = filterStore.getNamespace();
    const viewingAllNamespaces = !ns || ns === 'all-namespaces';

    // Use configured columns when available,
    // wrapping accessors to optionally use Table cells as fallback
    if (Array.isArray(cfg?.columns)) {
      const base = cfg.columns.map((col) => {
        const headerName = String(col.header || '').toLowerCase();
        const idx = tblNames.indexOf(headerName);
        const fallbackAccessor = (item: any) => <>{(item as any)?.__cells?.[idx] ?? ''}</>;
        const accessor = (item: any) => {
          // If item came from Table and no full object yet, use table cell fallback
          if ((item as any)?.__fromTable) {
            return fallbackAccessor(item);
          }
          return col.accessor(item);
        };
        const title = (item: any) => {
          if ((item as any)?.__fromTable) {
            return undefined;
          }
          return col.title ? col.title(item) : '';
        };
        return { ...col, accessor, title } as Column<any>;
      });

      // Inject Namespace column as the second column when appropriate
      if (viewingAllNamespaces && namespaced && base.length > 0) {
        return [base[0], namespaceColumn, ...base.slice(1)];
      }
      return base;
    }

    // No configured columns – use Table model if available; otherwise, return empty
    return Array.isArray(tblCols) ? tblCols : [];
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
          initialLoadComplete={initialLoadComplete()}
          resourceCount={resourceCount()}
        />

        <section class="resource-section full-width">
          <Show when={errorStore.currentError} fallback={
            <Show when={effectiveColumns().length > 0}>
              <ResourceList 
                resources={filteredResources()}
                resourceTypeConfig={(resourceTypeConfigs[filterStore.getResourceType() || ''] as any) || { columns: [] }}
                resetKey={listResetKey()}
                columns={effectiveColumns()}
              />
            </Show>
          }>
            <ErrorDisplay class="inline" />
          </Show>
        </section>
      </main>
    </div>
  );
}
