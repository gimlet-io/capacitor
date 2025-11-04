// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, Show, onMount, createMemo, untrack } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { useNavigate } from "@solidjs/router";
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
  const navigate = useNavigate();
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [initialLoadComplete, setInitialLoadComplete] = createSignal(true);
  const [resourceCount, setResourceCount] = createSignal(0);
  const [loadingStage, setLoadingStage] = createSignal<'loading' | 'enhancing' | 'filtering' | null>(null);
  const [settleTimer, setSettleTimer] = createSignal<number | null>(null);
  
  let contextDropdownRef: HTMLDivElement | undefined;

  // Resource state
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});
  // Dynamic columns from K8s Table response
  const [tableColumns, setTableColumns] = createSignal<Column<any>[] | null>(null);
  const [listResetKey, setListResetKey] = createSignal(0);
  // Batching state for watch updates (per resource type)
  const mainBatchQueue: Record<string, Array<{ type: 'ADDED' | 'MODIFIED' | 'DELETED'; object: any }>> = {};
  const mainBatchTimer: Record<string, number | undefined> = {};
  const extraBatchQueue: Record<string, Array<{ type: 'ADDED' | 'MODIFIED' | 'DELETED'; object: any }>> = {};
  const extraBatchTimer: Record<string, number | undefined> = {};

  // Determine if non-trivial filters are active (excluding ResourceType and Namespace)
  const hasUserFilters = createMemo(() => {
    return filterStore.activeFilters.some(f => f.name !== 'ResourceType' && f.name !== 'Namespace');
  });

  // Bump a 300ms settle timer; sets stage based on whether user filters exist
  const bumpSettleTimer = () => {
    untrack(() => {
      if (initialLoadComplete() === false) {
        setLoadingStage('loading');
      } else {
        setLoadingStage(hasUserFilters() ? 'filtering' : 'enhancing');
      }
      const existing = settleTimer();
      if (existing !== null) clearTimeout(existing!);
      const timer = setTimeout(() => {
        setLoadingStage(null);
        setSettleTimer(null);
      }, 300) as unknown as number;
      setSettleTimer(timer);
    });
  };

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
    const timer = settleTimer();
    if (timer !== null) {
      clearTimeout(timer);
      setSettleTimer(null);
    }
  });

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {    
    // Simple fetch of resources using Table response, then start stream to enhance with full objects
    const handleFetchTable = async () => {
      try {
        setInitialLoadComplete(false);
        setLoadingStage('loading');
        setResourceCount(0);
        // Abort any existing watchers before starting new ones
        untrack(() => {
          watchControllers().forEach(c => c.abort());
        });
        setWatchControllers([]);
        await fetchResourceTable(filterStore.getNamespace(), filterStore.getResourceType());
      //  await new Promise(resolve => setTimeout(resolve, 3000));
        await startStream(filterStore.getNamespace(), filterStore.getResourceType());
        await startExtraWatches(filterStore.getNamespace(), filterStore.getResourceType());
      } catch (error) {
        console.error('Error fetching resources (Table):', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch resources';
        errorStore.setApiError(`Failed to fetch resources: ${errorMessage}`);
        setInitialLoadComplete(true);
        setLoadingStage(null);
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
    // Ask the API server to exclude objects from Table rows (avoid managedFields)
    const url = listPath + (listPath.includes('?') ? '&' : '?') + 'includeObject=None';

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

      // Find indices for common identity columns in the Table
      const nameIdx = columnDefs.findIndex((def: any) => String(def?.format || '').toLowerCase() === 'name' || String(def?.name || '').toLowerCase() === 'name');
      const nsIdx = columnDefs.findIndex((def: any) => String(def?.name || '').toLowerCase() === 'namespace');

      // Build dynamic columns based on Table column definitions
      const cols: Column<any>[] = columnDefs.map((def: any, idx: number) => ({
        header: String(def?.name || ''),
        width: `${Math.max(10, Math.floor(100 / Math.max(1, columnDefs.length)))}%`,
        accessor: (resource: any) => <>{(resource as any)?.__cells?.[idx] ?? ''}</>,
        sortable: false
      }));
      setTableColumns(cols);

      // Map rows to underlying objects while attaching cells for rendering
      const effectiveApiVersion = (k8sResource.group && k8sResource.group !== 'core')
        ? `${k8sResource.group}/${k8sResource.version}`
        : k8sResource.version;
      const mapped = rows
        .map((r: any) => {
          const obj = r?.object || {};
          try {
            // Attach cells for UI rendering
            (obj as any).__cells = Array.isArray(r?.cells) ? r.cells : [];
          } catch (_e) {
            // ignore attach errors
          }
          // Normalize identity so commands work before stream enrichment
          try {
            if (!obj || typeof obj !== 'object') {
              // ensure object-like
            } else {
              if (!(obj as any).metadata) (obj as any).metadata = {};
              // If object wasn't included, derive name/namespace from Table cells when available
              if ((obj as any).metadata && Array.isArray((obj as any).__cells)) {
                if ((obj as any).metadata.name == null && nameIdx >= 0) {
                  (obj as any).metadata.name = (obj as any).__cells[nameIdx] ?? (obj as any).metadata.name;
                }
                if ((obj as any).metadata.namespace == null && nsIdx >= 0) {
                  (obj as any).metadata.namespace = (obj as any).__cells[nsIdx] ?? (obj as any).metadata.namespace;
                }
              }
              if (!(obj as any).kind || (obj as any).kind === 'PartialObjectMetadata') {
                (obj as any).kind = k8sResource.kind;
              }
              const apiVer = (obj as any).apiVersion;
              if (!apiVer || apiVer === 'meta.k8s.io/v1') {
                (obj as any).apiVersion = effectiveApiVersion;
              }
            }
          } catch (_e) {
            // ignore normalization errors
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
      setLoadingStage(null);
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
      // Enter enhancing/filtering stage now that streaming starts
      untrack(() => setLoadingStage(hasUserFilters() ? 'filtering' : 'enhancing'));
      bumpSettleTimer();
      const scheduleMainFlush = (resTypeId: string) => {
        if (mainBatchTimer[resTypeId] !== undefined) return;
        mainBatchTimer[resTypeId] = setTimeout(() => {
          const changes = mainBatchQueue[resTypeId] || [];
          mainBatchQueue[resTypeId] = [];
          mainBatchTimer[resTypeId] = undefined;
          if (changes.length === 0) return;

          setDynamicResources(prev => {
            const list = (prev[resTypeId] || []).slice();
            // Build name index for fast lookup
            const nameToIndex = new Map<string, number>();
            for (let i = 0; i < list.length; i++) {
              const n = (list[i] as any)?.metadata?.name as string | undefined;
              if (n) nameToIndex.set(n, i);
            }
            for (const evt of changes) {
              const obj = evt.object;
              const name = obj?.metadata?.name as string | undefined;
              if (!name) continue;
              const idx = nameToIndex.get(name);
              if (evt.type === 'DELETED') {
                if (idx !== undefined) {
                  list.splice(idx, 1);
                  nameToIndex.delete(name);
                }
              } else {
                // Preserve table cells if present
                const prevItem = idx !== undefined ? list[idx] : undefined;
                let nextItem = { ...obj } as any;
                if ((prevItem as any)?.__cells && !nextItem.__cells) {
                  nextItem.__cells = (prevItem as any).__cells;
                }
                if (idx === undefined) {
                  nameToIndex.set(name, list.length);
                  list.push(nextItem);
                } else {
                  list[idx] = nextItem;
                }
              }
            }
            // Stable sort by name once per flush
            list.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
            // Update count if current type
            if (resTypeId === filterStore.getResourceType()) {
              setResourceCount(list.length);
            }
            return { ...prev, [resTypeId]: list };
          });
        }, 40) as unknown as number;
      };

      // Send projection fields to server if configured for this resource type
      const proj = (resourceType && resourceTypeConfigs[resourceType]?.projectFields) || undefined;
      const params = proj && proj.length > 0 ? { fields: JSON.stringify(proj) } : undefined;
      await watchResource(watchPath, (event: { type: string; object: any; error?: string; path?: string }) => {
        if (event.type === 'ERROR') {
          const msg = event.error || 'Unknown watch error';
          errorStore.setWatchError(msg, event.path || watchPath);
          return;
        }
        const obj = event.object;
        if (!obj?.metadata?.name) return;
        // Queue main event
        const rt = k8sResource.id;
        if (!Array.isArray(mainBatchQueue[rt])) mainBatchQueue[rt] = [];
        mainBatchQueue[rt].push({ type: event.type as any, object: obj });
        // Bump settle for ADDED
        if (event.type === 'ADDED') bumpSettleTimer();
        scheduleMainFlush(rt);
      }, controller, setWatchStatus, (msg, path) => errorStore.setWatchError(msg, path), ctxName, params);
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
        const scheduleExtraFlush = (resTypeId: string, mainId: string, updater: (item: any, extras: any[]) => any) => {
          if (extraBatchTimer[resTypeId] !== undefined) return;
          extraBatchTimer[resTypeId] = setTimeout(() => {
            const changes = extraBatchQueue[resTypeId] || [];
            extraBatchQueue[resTypeId] = [];
            extraBatchTimer[resTypeId] = undefined;
            if (changes.length === 0) return;

            setDynamicResources(prev => {
              // Update extra cache
              const extraList = (prev[resTypeId] || []).slice();
              const keyOf = (o: any) => o?.metadata ? `${o.metadata.namespace || ''}/${o.metadata.name || ''}` : '';
              const keyToIndex = new Map<string, number>();
              for (let i = 0; i < extraList.length; i++) keyToIndex.set(keyOf(extraList[i]), i);
              for (const evt of changes) {
                const key = keyOf(evt.object);
                if (!key) continue;
                const idx = keyToIndex.get(key);
                if (evt.type === 'DELETED') {
                  if (idx !== undefined) {
                    extraList.splice(idx, 1);
                    keyToIndex.delete(key);
                  }
                } else {
                  if (idx === undefined) {
                    keyToIndex.set(key, extraList.length);
                    extraList.push(evt.object);
                  } else {
                    extraList[idx] = evt.object;
                  }
                }
              }

              // Enrich main list items once per flush
              const currentMain = (prev[mainId] || []) as any[];
              const enriched = currentMain.map(item => {
                try {
                  return updater(item, extraList);
                } catch (_e) {
                  return item;
                }
              });
              enriched.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
              const next: Record<string, any[]> = { ...prev, [resTypeId]: extraList, [mainId]: enriched };
              return next;
            });
          }, 40) as unknown as number;
        };

        // Prepare projection fields for the extra watch if configured
        const extraParams = Array.isArray(ex.projectFields) && ex.projectFields.length > 0
          ? { fields: JSON.stringify(ex.projectFields) }
          : undefined;

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
            // Queue extra event and schedule flush
            const rt = ex.resourceType;
            const mainId = mainRes.id;
            if (!Array.isArray(extraBatchQueue[rt])) extraBatchQueue[rt] = [];
            extraBatchQueue[rt].push({ type: event.type as any, object: obj });
            if (event.type === 'ADDED' || event.type === 'DELETED') bumpSettleTimer();
            scheduleExtraFlush(rt, mainId, ex.updater);
          },
          controller,
          noopSetWatchStatus,
          (msg, path) => errorStore.setWatchError(msg, path),
          ctxName,
          extraParams
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

  // Keep resourceCount in sync with settle: update total immediately; update filtered count after 300ms settle
  createEffect(() => {
    const hasFilters = filterStore.activeFilters.some(f => f.name !== 'ResourceType' && f.name !== 'Namespace');
    if (!hasFilters) {
      const all = dynamicResources()[filterStore.getResourceType() || ''] || [];
      setResourceCount(all.length);
      return;
    }
    // If filtering, update count only when loadingStage is null (settled)
    if (loadingStage() === null) {
      setResourceCount(filteredResources().length);
    }
  });

  // When filters change, reflect filtering stage and restart settle window
  createEffect(() => {
    const _filters = filterStore.activeFilters;
    void _filters;
    untrack(() => bumpSettleTimer());
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
          loadingStage={loadingStage()}
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
                navigate={navigate}
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
