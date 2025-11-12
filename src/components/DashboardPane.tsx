// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, Show, createMemo, untrack, onCleanup } from "solid-js";
import { ResourceList } from "./index.ts";
import { useNavigate } from "@solidjs/router";
import { ViewBar } from "./viewBar/ViewBar.tsx";
import { FilterBar, type ActiveFilter } from "./filterBar/FilterBar.tsx";
import { formatShortcutForDisplay } from "../utils/shortcuts.ts";
import { watchResource } from "../watches.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { PaneFilterProvider, usePaneFilterStore, getPaneFilters } from "../store/paneFilterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "./ErrorDisplay.tsx";
import { resourceTypeConfigs, type Column, namespaceColumn, type ExtraWatchConfig } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "./resourceList/PodList.tsx";
import { setJobNodeOptions } from "./resourceList/JobList.tsx";
import { type Orientation } from "./paneManager/index.ts";

interface DashboardPaneProps {
  paneKey: number;
  focused: () => boolean;
  onFocus: () => void;
  onStatusChange: (status: string) => void;
  onSplit: (orientation: Orientation) => void;
  onClose: () => void;
}

interface DashboardPaneWithProviderProps extends DashboardPaneProps {
  paneFilterCache: Map<number, ActiveFilter[]>;
  onPaneFilterChange: (paneKey: number, filters: ActiveFilter[]) => void;
}

// Pane wrapper with provider
export function DashboardPaneWithProvider(props: DashboardPaneWithProviderProps) {
  const key = props.paneKey;
  // Get initial filters for this pane from:
  // 1. Cache (for existing panes after tree restructure)
  // 2. Registry (for newly split panes)
  // 3. Provider will use DEFAULT_PANE_FILTERS if undefined
  // Use untrack() to avoid creating reactive dependencies when reading initial state
  const initialFilters = untrack(() => {
    const cached = props.paneFilterCache.get(key);
    if (cached) return cached;
    
    const fromRegistry = getPaneFilters(key);
    if (fromRegistry.length > 0) return fromRegistry;
    
    return undefined; // Let provider use its defaults
  });
  
  return (
    <PaneFilterProvider 
      paneId={key} 
      initialFilters={initialFilters}
      onStateChange={(filters) => props.onPaneFilterChange(key, filters)}
    >
      <DashboardPane 
        paneKey={props.paneKey}
        focused={props.focused}
        onFocus={props.onFocus}
        onStatusChange={props.onStatusChange}
        onSplit={props.onSplit}
        onClose={props.onClose}
      />
    </PaneFilterProvider>
  );
}

// Pane subcomponent encapsulating resources, filters, list and watchers
function DashboardPane(props: DashboardPaneProps) {
  const navigate = useNavigate();
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  // Use pane filter context
  const paneFilterStore = usePaneFilterStore();

  // Resource state
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});
  const [tableColumns, setTableColumns] = createSignal<Column<any>[] | null>(null);
  const [listResetKey, setListResetKey] = createSignal(0);
  const [initialLoadComplete, setInitialLoadComplete] = createSignal(true);
  const [resourceCount, setResourceCount] = createSignal(0);
  const [loadingStage, setLoadingStage] = createSignal<'loading' | 'enhancing' | 'filtering' | null>(null);
  const [settleTimer, setSettleTimer] = createSignal<number | null>(null);
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  const mainBatchQueue: Record<string, Array<{ type: 'ADDED' | 'MODIFIED' | 'DELETED'; object: any }>> = {};
  const mainBatchTimer: Record<string, number | undefined> = {};
  const extraBatchQueue: Record<string, Array<{ type: 'ADDED' | 'MODIFIED' | 'DELETED'; object: any }>> = {};
  const extraBatchTimer: Record<string, number | undefined> = {};

  const hasUserFilters = createMemo(() => {
    return paneFilterStore.activeFilters.some(f => f.name !== 'ResourceType' && f.name !== 'Namespace');
  });

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

  // Fetch Table and stream
  createEffect(() => {
    const ns = paneFilterStore.getNamespace();
    const rt = paneFilterStore.getResourceType();
    const handleFetch = async () => {
      try {
        setInitialLoadComplete(false);
        setLoadingStage('loading');
        setResourceCount(0);
        untrack(() => { watchControllers().forEach(c => c.abort()); });
        setWatchControllers([]);
        await fetchResourceTable(ns, rt);
        await startStream(ns, rt);
        await startExtraWatches(ns, rt);
      } catch (error) {
        console.error('Error fetching resources (Table):', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch resources';
        errorStore.setApiError(`Failed to fetch resources: ${errorMessage}`);
        setInitialLoadComplete(true);
        setLoadingStage(null);
      }
    };
    handleFetch();
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
    const timer = settleTimer();
    if (timer !== null) {
      clearTimeout(timer);
      setSettleTimer(null);
    }
  });

  // API/server connectivity recovery (reuse top-level store signals)
  const [retryTimer, setRetryTimer] = createSignal<number | null>(null);
  const [connectionLost, setConnectionLost] = createSignal(false);
  const retryLoadResources = () => { apiResourceStore.refetchResources(); };
  onCleanup(() => {
    if (retryTimer() !== null) clearTimeout(retryTimer()!);
  });
  createEffect(() => {
    const currentError = errorStore.currentError;
    const resources = apiResourceStore.apiResources;
    const namespaces = apiResourceStore.namespaces;
    const contexts = apiResourceStore.contextInfo;
    if (currentError && (currentError.type === 'api' || currentError.type === 'server')) {
      if (!connectionLost()) setConnectionLost(true);
      if (retryTimer() === null) {
        const timer = setTimeout(() => {
          retryLoadResources();
          setRetryTimer(null);
        }, 5000);
        setRetryTimer(timer);
      }
      return;
    }
    if ((resources !== undefined || namespaces !== undefined || contexts !== undefined) && connectionLost()) {
      setConnectionLost(false);
      if (retryTimer() !== null) {
        clearTimeout(retryTimer()!);
        setRetryTimer(null);
      }
      fetchResourceTable(paneFilterStore.getNamespace(), paneFilterStore.getResourceType()).catch(err => console.error('Error reloading after connection restoration:', err));
    }
  });

  const fetchResourceTable = async (ns: string | undefined, resourceType: string | undefined) => {
    if (!resourceType) return;
    setDynamicResources(() => ({}));
    setTableColumns(null);
    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    if (!k8sResource) return;
    let listPath = `${k8sResource.apiPath}/${k8sResource.name}`;
    if (k8sResource.namespaced && ns && ns !== 'all-namespaces') {
      listPath = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}`;
    }
    const url = listPath + (listPath.includes('?') ? '&' : '?') + 'includeObject=None';
    try {
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/json;as=Table;g=meta.k8s.io;v=v1, application/json'
        }
      });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      if (data?.kind !== 'Table' || !Array.isArray(data?.rows)) {
        const items = Array.isArray(data?.items) ? data.items : [];
        setDynamicResources(prev => {
          // Enrich with extras if configured and available
          const cfg = resourceType ? resourceTypeConfigs[resourceType] : undefined;
          let base = items;
          if (cfg && Array.isArray(cfg.extraWatches) && cfg.extraWatches.length > 0) {
            for (const ex of cfg.extraWatches) {
              const extraList = (prev[ex.resourceType] || []) as any[];
              try {
                base = base.map(item => {
                  const updated = ex.updater(item, extraList);
                  if (updated && typeof updated === 'object' && (updated as any).__fromTable) {
                    try { delete (updated as any).__fromTable; } catch { /* ignore */ }
                  }
                  return updated;
                });
              } catch { /* ignore */ }
            }
          }
          return { ...prev, [k8sResource.id]: base };
        });
        setResourceCount(items.length);
        setInitialLoadComplete(true);
        setTableColumns(null);
        return;
      }
      const columnDefs = Array.isArray(data?.columnDefinitions) ? data.columnDefinitions : [];
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const nameIdx = columnDefs.findIndex((def: any) => String(def?.format || '').toLowerCase() === 'name' || String(def?.name || '').toLowerCase() === 'name');
      const nsIdx = columnDefs.findIndex((def: any) => String(def?.name || '').toLowerCase() === 'namespace');
      const cols: Column<any>[] = columnDefs.map((def: any, idx: number) => ({
        header: String(def?.name || ''),
        width: `${Math.max(10, Math.floor(100 / Math.max(1, columnDefs.length)))}%`,
        accessor: (resource: any) => <>{(resource as any)?.__cells?.[idx] ?? ''}</>,
        sortable: false
      }));
      setTableColumns(cols);
      const effectiveApiVersion = (k8sResource.group && k8sResource.group !== 'core') ? `${k8sResource.group}/${k8sResource.version}` : k8sResource.version;
      const mapped = rows.map((r: any) => {
        const obj = r?.object || {};
        try { (obj as any).__cells = Array.isArray(r?.cells) ? r.cells : []; } catch { /* ignore */ }
        try {
          if (obj && typeof obj === 'object') {
            if (!(obj as any).metadata) (obj as any).metadata = {};
            if ((obj as any).metadata && Array.isArray((obj as any).__cells)) {
              if ((obj as any).metadata.name == null && nameIdx >= 0) (obj as any).metadata.name = (obj as any).__cells[nameIdx] ?? (obj as any).metadata.name;
              if ((obj as any).metadata.namespace == null && nsIdx >= 0) (obj as any).metadata.namespace = (obj as any).__cells[nsIdx] ?? (obj as any).metadata.namespace;
            }
            if (!(obj as any).kind || (obj as any).kind === 'PartialObjectMetadata') (obj as any).kind = k8sResource.kind;
            const apiVer = (obj as any).apiVersion;
            if (!apiVer || apiVer === 'meta.k8s.io/v1') (obj as any).apiVersion = effectiveApiVersion;
          }
        } catch { /* ignore */ }
        (obj as any).__fromTable = true;
        return obj;
      });
      mapped.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
      setDynamicResources(prev => {
        // Enrich with extras if configured and available
        const cfg = resourceType ? resourceTypeConfigs[resourceType] : undefined;
        let enriched = mapped;
        if (cfg && Array.isArray(cfg.extraWatches) && cfg.extraWatches.length > 0) {
          for (const ex of cfg.extraWatches) {
            const extraList = (prev[ex.resourceType] || []) as any[];
            try {
              enriched = enriched.map(item => {
                const updated = ex.updater(item, extraList);
                if (updated && typeof updated === 'object' && (updated as any).__fromTable) {
                  try { delete (updated as any).__fromTable; } catch { /* ignore */ }
                }
                return updated;
              });
            } catch { /* ignore */ }
          }
        }
        return { ...prev, [k8sResource.id]: enriched };
      });
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

  const startStream = async (ns: string | undefined, resourceType: string | undefined) => {
    try {
      if (!resourceType) return;
      const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
      if (!k8sResource) return;
      let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
      if (k8sResource.namespaced && ns && ns !== 'all-namespaces') {
        watchPath = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}?watch=true`;
      }
      const ctxName = apiResourceStore.contextInfo?.current;
      const proj = (resourceType && resourceTypeConfigs[resourceType]?.projectFields) || undefined;
      const params = proj && proj.length > 0 ? { fields: JSON.stringify(proj) } : undefined;
      const controller = new AbortController();
      setWatchControllers(prev => [...prev, controller]);
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
                const prevItem = idx !== undefined ? list[idx] : undefined;
                let nextItem = { ...obj } as any;
                if ((prevItem as any)?.__cells && !nextItem.__cells) {
                  nextItem.__cells = (prevItem as any).__cells;
                }
                // Preserve fields added by extra watches (e.g. pods, replicaSets)
                if (prevItem && typeof prevItem === 'object') {
                  if ((prevItem as any).pods && !nextItem.pods) {
                    nextItem.pods = (prevItem as any).pods;
                  }
                  if ((prevItem as any).replicaSets && !nextItem.replicaSets) {
                    nextItem.replicaSets = (prevItem as any).replicaSets;
                  }
                  if ((prevItem as any).matchingPods && !nextItem.matchingPods) {
                    nextItem.matchingPods = (prevItem as any).matchingPods;
                  }
                  if ((prevItem as any).matchingDeployments && !nextItem.matchingDeployments) {
                    nextItem.matchingDeployments = (prevItem as any).matchingDeployments;
                  }
                  if ((prevItem as any).ingresses && !nextItem.ingresses) {
                    nextItem.ingresses = (prevItem as any).ingresses;
                  }
                  if ((prevItem as any).kustomizations && !nextItem.kustomizations) {
                    nextItem.kustomizations = (prevItem as any).kustomizations;
                  }
                  if ((prevItem as any).events && !nextItem.events) {
                    nextItem.events = (prevItem as any).events;
                  }
                  if ((prevItem as any).gitRepositories && !nextItem.gitRepositories) {
                    nextItem.gitRepositories = (prevItem as any).gitRepositories;
                  }
                  if ((prevItem as any).buckets && !nextItem.buckets) {
                    nextItem.buckets = (prevItem as any).buckets;
                  }
                  if ((prevItem as any).ociRepositories && !nextItem.ociRepositories) {
                    nextItem.ociRepositories = (prevItem as any).ociRepositories;
                  }
                }
                // Main watch has provided an object; ensure we treat it as non-table data
                if (nextItem && typeof nextItem === 'object' && (nextItem as any).__fromTable) {
                  try { delete (nextItem as any).__fromTable; } catch { /* ignore */ }
                }
                // If this resource type has extra watches configured, re-run enrichment using the latest extras
                try {
                  const cfg = resourceType ? resourceTypeConfigs[resourceType] : undefined;
                  if (cfg && Array.isArray(cfg.extraWatches) && cfg.extraWatches.length > 0) {
                    for (const ex of cfg.extraWatches) {
                      const extraList = (prev[ex.resourceType] || []) as any[];
                      try {
                        nextItem = ex.updater(nextItem, extraList);
                      } catch { /* ignore */ }
                    }
                  }
                } catch { /* ignore */ }
                if (idx === undefined) {
                  nameToIndex.set(name, list.length);
                  list.push(nextItem);
                } else {
                  list[idx] = nextItem;
                }
              }
            }
            list.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
            if (resTypeId === paneFilterStore.getResourceType()) {
              setResourceCount(list.length);
            }
            return { ...prev, [resTypeId]: list };
          });
        }, 40) as unknown as number;
      };
      await watchResource(
        watchPath,
        (event: { type: string; object: any; error?: string; path?: string }) => {
          if (event.type === 'ERROR') {
            const msg = event.error || 'Unknown watch error';
            errorStore.setWatchError(msg, event.path || watchPath);
            return;
          }
          const obj = event.object;
          if (!obj?.metadata?.name) return;
          const rt = k8sResource.id;
          if (!Array.isArray(mainBatchQueue[rt])) mainBatchQueue[rt] = [];
          mainBatchQueue[rt].push({ type: event.type as any, object: obj });
          if (event.type === 'ADDED') bumpSettleTimer();
          scheduleMainFlush(rt);
        },
        controller,
        (s) => {
          props.onStatusChange(s);
        },
        (msg, path) => errorStore.setWatchError(msg, path),
        ctxName,
        params
      );
    } catch (e) {
      console.error('Failed to start stream:', e);
    }
  };

  const startExtraWatches = async (ns: string | undefined, resourceType: string | undefined) => {
    try {
      console.log('[startExtraWatches] called with:', { ns, resourceType, paneKey: props.paneKey });
      if (!resourceType) return;
      const mainRes = filterStore.k8sResources.find(res => res.id === resourceType);
      if (!mainRes) {
        console.log('[startExtraWatches] mainRes not found for:', resourceType);
        return;
      }
      const cfg = resourceTypeConfigs[resourceType];
      console.log('[startExtraWatches] cfg:', cfg ? 'found' : 'not found', 'extraWatches:', cfg?.extraWatches);
      const extras: ExtraWatchConfig[] = Array.isArray(cfg?.extraWatches) ? cfg!.extraWatches! : [];
      if (extras.length === 0) {
        console.log('[startExtraWatches] No extra watches configured for:', resourceType);
        return;
      }
      console.log('[startExtraWatches] Starting', extras.length, 'extra watches');
      const ctxName = apiResourceStore.contextInfo?.current;
      for (const ex of extras) {
        console.log('[startExtraWatches] Processing extra watch for:', ex.resourceType);
        const extraRes = filterStore.k8sResources.find(r => r.id === ex.resourceType);
        if (!extraRes) {
          console.log('[startExtraWatches] extraRes not found for:', ex.resourceType);
          continue;
        }
        let extraPath = `${extraRes.apiPath}/${extraRes.name}?watch=true`;
        if (extraRes.namespaced && ns && ns !== 'all-namespaces') {
          extraPath = `${extraRes.apiPath}/namespaces/${ns}/${extraRes.name}?watch=true`;
        }
        console.log('[startExtraWatches] Starting watch for path:', extraPath);
        // Seed extras once so enrichment has current data even if watch doesn't replay ADDED for existing objects
        try {
          let listPath = `${extraRes.apiPath}/${extraRes.name}`;
          if (extraRes.namespaced && ns && ns !== 'all-namespaces') {
            listPath = `${extraRes.apiPath}/namespaces/${ns}/${extraRes.name}`;
          }
          const resp = await fetch(listPath, { headers: { 'Accept': 'application/json' } });
          if (resp.ok) {
            const data = await resp.json();
            const initialItems: any[] = Array.isArray(data?.items) ? data.items : [];
            setDynamicResources(prev => {
              const next: Record<string, any[]> = { ...prev, [ex.resourceType]: initialItems };
              const mainId = mainRes.id;
              const currentMain = (next[mainId] || []) as any[];
              const enriched = currentMain.map(item => {
                try { 
                  const updated = ex.updater(item, initialItems);
                  if (updated && typeof updated === 'object' && (updated as any).__fromTable) {
                    try { delete (updated as any).__fromTable; } catch { /* ignore */ }
                  }
                  return updated;
                } catch { return item; }
              });
              enriched.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
              next[mainId] = enriched;
              return next;
            });
          }
        } catch (e) {
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
              const currentMain = (prev[mainId] || []) as any[];
              const enriched = currentMain.map(item => {
                try { 
                  const updated = updater(item, extraList);
                  // If an item was enriched, ensure it is treated as non-table data
                  if (updated && typeof updated === 'object' && (updated as any).__fromTable) {
                    try { delete (updated as any).__fromTable; } catch { /* ignore */ }
                  }
                  return updated; 
                } catch { 
                  return item; 
                }
              });
              enriched.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
              try {
                console.log('[extraWatch flush] enriched main list', { mainId, extraResType: resTypeId, mainCount: enriched.length, extraCount: extraList.length });
              } catch { /* ignore */ }
              const next: Record<string, any[]> = { ...prev, [resTypeId]: extraList, [mainId]: enriched };
              return next;
            });
          }, 40) as unknown as number;
        };
        const extraParams = Array.isArray(ex.projectFields) && ex.projectFields.length > 0 ? { fields: JSON.stringify(ex.projectFields) } : undefined;
        await watchResource(
          extraPath,
          (event: { type: string; object: any; error?: string; path?: string }) => {
            console.log('[extraWatch callback] received event:', event.type, 'for', event.object?.metadata?.name, 'extraPath:', extraPath);
            if (event.type === 'ERROR') {
              const msg = event.error || 'Unknown watch error';
              errorStore.setWatchError(msg, event.path || extraPath);
              return;
            }
            const obj = event.object;
            if (!obj?.metadata?.name) {
              console.log('[extraWatch callback] skipping event with no metadata.name');
              return;
            }
            const rt = ex.resourceType;
            const mainId = mainRes.id;
            if (!Array.isArray(extraBatchQueue[rt])) extraBatchQueue[rt] = [];
            extraBatchQueue[rt].push({ type: event.type as any, object: obj });
            console.log('[extraWatch callback] queued event, queue length:', extraBatchQueue[rt].length);
            if (event.type === 'ADDED' || event.type === 'DELETED') bumpSettleTimer();
            console.log('[extraWatch callback] calling scheduleExtraFlush for', rt, 'mainId:', mainId);
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

  const filteredResources = createMemo(() => {
    const resources = dynamicResources()[paneFilterStore.getResourceType() || ''] || [];
    const filters = paneFilterStore.activeFilters.filter(filter => filter.name !== "ResourceType" && filter.name !== "Namespace");
    if (filters.length === 0) { return resources; }
    return resources.filter(resource => filters.some(filter => filterStore.filterRegistry[filter.name]?.filterFunction(resource, filter.value)));
  });

  // Keep resourceCount in sync with settle
  createEffect(() => {
    const hasFilters = paneFilterStore.activeFilters.some(f => f.name !== 'ResourceType' && f.name !== 'Namespace');
    if (!hasFilters) {
      const all = dynamicResources()[paneFilterStore.getResourceType() || ''] || [];
      setResourceCount(all.length);
      return;
    }
    if (loadingStage() === null) {
      setResourceCount(filteredResources().length);
    }
  });

  // Restart settle when filters change
  createEffect(() => {
    const _filters = paneFilterStore.activeFilters;
    void _filters;
    untrack(() => bumpSettleTimer());
  });

  // Populate node filter options for pods
  createEffect(() => {
    const resourceType = paneFilterStore.getResourceType();
    if (resourceType !== 'core/Pod') return;
    const allPods = dynamicResources()[resourceType] || [];
    const uniqueNodes = [...new Set(
      allPods.map((pod: any) => pod.spec?.nodeName).filter((nodeName: string) => nodeName)
    )].sort();
    setNodeOptions(uniqueNodes.map((nodeName: string) => ({ value: nodeName, label: nodeName })));
  });
  // Populate node options for jobs
  createEffect(() => {
    const resourceType = paneFilterStore.getResourceType();
    if (resourceType !== 'batch/Job') return;
    const allJobs = dynamicResources()[resourceType] || [];
    const uniqueNodes = [...new Set(
      allJobs.flatMap((job: any) => (job.pods || []).map((p: any) => p.spec?.nodeName)).filter((nodeName: string) => nodeName)
    )].sort();
    setJobNodeOptions(uniqueNodes.map((nodeName: string) => ({ value: nodeName, label: nodeName })));
  });

  const effectiveColumns = createMemo<Column<any>[]>(() => {
    const resourceType = paneFilterStore.getResourceType();
    const cfg = resourceType ? resourceTypeConfigs[resourceType] : undefined;
    const tblCols = tableColumns();
    const tblNames = Array.isArray(tblCols) ? tblCols.map(c => String((c as any)?.header || '').toLowerCase()) : [];
    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    const namespaced = Boolean(k8sResource?.namespaced);
    const ns = paneFilterStore.getNamespace();
    const viewingAllNamespaces = !ns || ns === 'all-namespaces';
    if (Array.isArray(cfg?.columns)) {
      const base = cfg.columns.map((col) => {
        const headerName = String(col.header || '').toLowerCase();
        const idx = tblNames.indexOf(headerName);
        const fallbackAccessor = (item: any) => <>{(item as any)?.__cells?.[idx] ?? ''}</>;
        const accessor = (item: any) => {
          if ((item as any)?.__fromTable) return fallbackAccessor(item);
          return col.accessor(item);
        };
        const title = (item: any) => {
          if ((item as any)?.__fromTable) return undefined;
          return col.title ? col.title(item) : '';
        };
        return { ...col, accessor, title } as Column<any>;
      });
      if (viewingAllNamespaces && namespaced && base.length > 0) {
        return [base[0], namespaceColumn, ...base.slice(1)];
      }
      return base;
    }
    return Array.isArray(tblCols) ? tblCols : [];
  });

  return (
    <div
      class="pane"
      tabIndex={0}
      onMouseDownCapture={() => props.onFocus()}
      onMouseDown={() => props.onFocus()}
      onClick={() => props.onFocus()}
      onFocus={() => props.onFocus()}
    >
      <div class="view-filter-row">
        <ViewBar
          keyboardEnabled={props.focused()}
        />
        <div class="vertical-separator" />
        <div class="filterbar-flex">
          <FilterBar
            initialLoadComplete={initialLoadComplete()}
            loadingStage={loadingStage()}
            resourceCount={resourceCount()}
            keyboardEnabled={props.focused()}
          />
        </div>
        <div class="filter-history-nav">
          <div class="filter-group">
            <button 
              class="filter-group-button"
              classList={{ "has-active-filters": false, "disabled": !paneFilterStore.canGoBack }}
              onClick={() => paneFilterStore.goBack()}
              disabled={!paneFilterStore.canGoBack}
              title="Go back in filter history"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="shortcut-key">{formatShortcutForDisplay('Mod+ArrowLeft')}</span>
            </button>
          </div>
          <div class="filter-group">
            <button 
              class="filter-group-button"
              classList={{ "has-active-filters": false, "disabled": !paneFilterStore.canGoForward }}
              onClick={() => paneFilterStore.goForward()}
              disabled={!paneFilterStore.canGoForward}
              title="Go forward in filter history"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="shortcut-key">{formatShortcutForDisplay('Mod+ArrowRight')}</span>
            </button>
          </div>
          <div class="filter-group">
            <button
              type="button"
              class="filter-group-button split-button"
              title={`Split horizontally (${formatShortcutForDisplay('Mod+-')})`}
              onClick={(e) => {
                e.stopPropagation();
                props.onSplit('horizontal');
              }}
            >
              -
              <span class="shortcut-key">{formatShortcutForDisplay('Mod+-')}</span>
            </button>
          </div>
          <div class="filter-group">
            <button
              type="button"
              class="filter-group-button split-button"
              title={`Split vertically (${formatShortcutForDisplay('Mod+|')})`}
              onClick={(e) => {
                e.stopPropagation();
                props.onSplit('vertical');
              }}
            >
              |
              <span class="shortcut-key">{formatShortcutForDisplay('Mod+|')}</span>
            </button>
          </div>
          <div class="filter-group">
            <button
              class="filter-group-button"
              onMouseDown={(e) => { e.stopPropagation(); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onClose(); }}
              title={`Close pane (${formatShortcutForDisplay('Mod+X')})`}
            >
              ✕
              <span class="shortcut-key">{formatShortcutForDisplay('Mod+X')}</span>
            </button>
          </div>
        </div>
      </div>

      <section class="resource-section full-width">
        <Show when={errorStore.currentError} fallback={
          <Show when={effectiveColumns().length > 0}>
            <ResourceList 
              resources={filteredResources()}
              resourceTypeConfig={(resourceTypeConfigs[paneFilterStore.getResourceType() || ''] as any) || { columns: [] }}
              resetKey={listResetKey()}
              columns={effectiveColumns()}
              navigate={navigate}
              keyboardEnabled={props.focused()}
              isActive={props.focused()}
            />
          </Show>
        }>
          <ErrorDisplay class="inline" />
        </Show>
      </section>
    </div>
  );
}

