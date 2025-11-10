// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, Show, onMount, createMemo, untrack, For, onCleanup } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { useNavigate } from "@solidjs/router";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar } from "../components/filterBar/FilterBar.tsx";
import { SettingsModal } from "../components/settings/SettingsModal.tsx";
import { applyTheme, loadInitialTheme, type ThemeName } from "../utils/theme.ts";
import { KeyboardShortcuts } from "../components/keyboardShortcuts/KeyboardShortcuts.tsx";
import { ShortcutPrefix, getShortcutPrefix, getDefaultShortcutPrefix, setShortcutPrefix, formatShortcutForDisplay } from "../utils/shortcuts.ts";
import { watchResource } from "../watches.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "../components/ErrorDisplay.tsx";
import { resourceTypeConfigs, type Column, namespaceColumn, type ExtraWatchConfig } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "../components/resourceList/PodList.tsx";
import { setJobNodeOptions } from "../components/resourceList/JobList.tsx";
import { keyboardManager } from "../utils/keyboardManager.ts";
// Minimal local replicas of filter types to avoid cross-file type-only import resolution issues
type FilterOption = {
  label: string;
  value: string;
  color?: string;
};
type FilterType = "select" | "text";
type Filter = {
  name: string;
  label: string;
  type?: FilterType;
  options?: FilterOption[];
  multiSelect?: boolean;
  placeholder?: string;
  filterFunction: (resource: any, value: string) => boolean;
  renderOption?: (option: FilterOption) => any;
  searchable?: boolean;
};
type ActiveFilter = {
  name: string;
  value: string;
};

export function Dashboard() {
  const navigate = useNavigate();
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  // Pane management
  type Orientation = 'horizontal' | 'vertical';
  const [orientation, setOrientation] = createSignal<Orientation>('horizontal'); // default horizontal split
  const [panes, setPanes] = createSignal<Array<{ key: number }>>([{ key: 0 }, { key: 1 }]); // start with 2 panes
  const [activePaneIndex, setActivePaneIndex] = createSignal(0);
  const [paneStatuses, setPaneStatuses] = createSignal<Record<number, string>>({});

  // Header / settings
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [theme, setTheme] = createSignal<ThemeName>(loadInitialTheme());
  const [viewShortcutModifier, setViewShortcutModifier] = createSignal<ShortcutPrefix>(
    typeof globalThis !== 'undefined' ? getShortcutPrefix() : getDefaultShortcutPrefix()
  );
  
  let contextDropdownRef: HTMLDivElement | undefined;

  // Watch status in header reflects active pane
  const watchStatus = createMemo(() => {
    const s = paneStatuses()[activePaneIndex()];
    return s || "●";
  });

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
    applyTheme(theme());
    // Register split/close shortcuts
    const unregister = keyboardManager.register({
      id: 'dashboard-pane-manager',
      priority: 0,
      ignoreInInput: true,
      handler: (e: KeyboardEvent) => {
        // Split vertical: Mod + |
        if ((e.key === '|' || e.key === '\\') && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
          // Use our Mod abstraction: rely on utils/shortcuts event matcher would require import; keep simple:
          // We'll accept when any modifier combo matches user setting via shortcuts util in FilterBar; here accept generic modifier combo
          // Only proceed if 'doesEventMatchShortcut' with 'mod+|' equivalent; simple heuristic:
          const k = e.key;
          const hasAnyMod = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
          if (hasAnyMod) {
            e.preventDefault();
            setOrientation('vertical');
            setPanes(prev => {
              const newIdx = prev.length;
              setActivePaneIndex(newIdx);
              return [...prev, { key: Date.now() }];
            });
            return true;
          }
        }
        // Split horizontal: Mod + -
        if (e.key === '-' && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
          e.preventDefault();
          setOrientation('horizontal');
          setPanes(prev => {
            const newIdx = prev.length;
            setActivePaneIndex(newIdx);
            return [...prev, { key: Date.now() }];
          });
          return true;
        }
        // Close current pane: Mod + x
        if ((e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
          e.preventDefault();
          setPanes(prev => {
            if (prev.length <= 1) return prev;
            const idx = activePaneIndex();
            const next = prev.slice();
            next.splice(idx, 1);
            // Adjust active index
            const newIdx = Math.max(0, Math.min(idx, next.length - 1));
            setActivePaneIndex(newIdx);
            return next;
          });
          return true;
        }
        return false;
      }
    });
    onCleanup(() => {
      unregister();
    });
  });
  
  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
  });

  createEffect(() => {
    setShortcutPrefix(viewShortcutModifier());
  });

  // Pane subcomponent encapsulating resources, filters, list and watchers
  function DashboardPane(props: {
    paneKey: number;
    focused: boolean;
    onFocus: () => void;
    onWatchStatus: (status: string) => void;
  }) {
    // Local filter state for pane
    // Initialize from top-level store if available (must pass value, not a function)
    const [paneActiveFilters, setPaneActiveFilters] = createSignal<ActiveFilter[]>(
      filterStore.activeFilters.length > 0 ? [...filterStore.activeFilters] : []
    );
    const getPaneResourceType = () => paneActiveFilters().find(f => f.name === "ResourceType")?.value;
    const getPaneNamespace = () => paneActiveFilters().find(f => f.name === "Namespace")?.value;
    const [selectedView, setSelectedView] = createSignal<string>('');
    // Local filter history
    const [paneHistory, setPaneHistory] = createSignal<ActiveFilter[][]>([]);
    const [paneHistoryIndex, setPaneHistoryIndex] = createSignal<number>(-1);
    const [isNavigatingHistory, setIsNavigatingHistory] = createSignal<boolean>(false);

    // Wrapper for setting filters that also maintains local history
    const updatePaneActiveFilters = (filters: ActiveFilter[]) => {
      setPaneActiveFilters(filters);
      if (!isNavigatingHistory()) {
        const current = paneHistory();
        const idx = paneHistoryIndex();
        const newHist = current.slice(0, idx + 1);
        newHist.push([...filters]);
        // keep last 50
        if (newHist.length > 50) newHist.shift();
        setPaneHistory(newHist);
        setPaneHistoryIndex(newHist.length - 1);
      }
    };

    const paneCanGoBack = createMemo(() => paneHistoryIndex() >= 1);
    const paneCanGoForward = createMemo(() => paneHistoryIndex() < paneHistory().length - 1);
    const paneGoBack = () => {
      if (!paneCanGoBack()) return;
      setIsNavigatingHistory(true);
      const newIdx = paneHistoryIndex() - 1;
      setPaneHistoryIndex(newIdx);
      const histFilters = paneHistory()[newIdx] || [];
      setPaneActiveFilters([...histFilters]);
      setIsNavigatingHistory(false);
    };
    const paneGoForward = () => {
      if (!paneCanGoForward()) return;
      setIsNavigatingHistory(true);
      const newIdx = paneHistoryIndex() + 1;
      setPaneHistoryIndex(newIdx);
      const histFilters = paneHistory()[newIdx] || [];
      setPaneActiveFilters([...histFilters]);
      setIsNavigatingHistory(false);
    };

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

    // Preselect default "Pods in all namespaces" view filters if none provided
    onMount(() => {
      try {
        const hasResourceType = paneActiveFilters().some(f => f.name === 'ResourceType');
        if (!hasResourceType) {
          updatePaneActiveFilters([
            { name: 'ResourceType', value: 'core/Pod' },
            { name: 'Namespace', value: 'all-namespaces' }
          ]);
        } else {
          // seed history with initial filters
          updatePaneActiveFilters(paneActiveFilters());
        }
      } catch {
        // ignore
      }
    });

    const hasUserFilters = createMemo(() => {
      return paneActiveFilters().some(f => f.name !== 'ResourceType' && f.name !== 'Namespace');
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

    // Local Filters list builder
    const namespaceOptions = createMemo<FilterOption[]>(() => {
      const namespaces = apiResourceStore.namespaces;
      if (!namespaces) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
      return [{ value: 'all-namespaces', label: 'All Namespaces' }, ...namespaces.map((ns: string) => ({ value: ns, label: ns }))];
    });
    const nameFilter: Filter = {
      name: "Name",
      label: "Name",
      type: "text" as FilterType,
      placeholder: "glob support: *, ?, [abc], !pattern",
      filterFunction: (resource: any, value: string) => {
        // Basic contains for pane-local; advanced glob exists in store but not needed here
        const v = String(value || '').toLowerCase();
        return String(resource?.metadata?.name || '').toLowerCase().includes(v);
      }
    };
    const labelSelectorFilter: Filter = {
      name: "LabelSelector",
      label: "Label",
      type: "text" as FilterType,
      placeholder: "app=web,tier=frontend or key!=val or key",
      filterFunction: (_resource: any, _value: string) => true // noop filtering; server-side enrichment applies
    };
    const namespaceFilter = createMemo<Filter>(() => ({
      name: "Namespace",
      label: "Namespace",
      type: "select" as FilterType,
      get options() { return namespaceOptions(); },
      multiSelect: false,
      filterFunction: () => true
    }));
    const paneFilters = createMemo<Filter[]>(() => {
      const rt = getPaneResourceType();
      const base: Filter[] = [
        {
          name: "ResourceType",
          label: "Resource Type",
          type: "select",
          options: filterStore.k8sResources.map(type => ({ value: type.id, label: type.kind })),
          searchable: true,
          multiSelect: false,
          filterFunction: () => true
        }
      ];
      const selectedResource = filterStore.k8sResources.find(r => r.id === rt);
      if (!selectedResource) return base;
      const specific: Filter[] = [];
      if (selectedResource.namespaced) specific.push(namespaceFilter());
      specific.push(nameFilter);
      if (selectedResource.kind === 'Pod' || selectedResource.kind === 'Service') {
        specific.push(labelSelectorFilter);
      }
      specific.push(...(resourceTypeConfigs[rt || '']?.filter || []));
      return [...base, ...specific];
    });

    // Fetch Table and stream
    createEffect(() => {
      const ns = getPaneNamespace();
      const rt = getPaneResourceType();
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
        fetchResourceTable(getPaneNamespace(), getPaneResourceType()).catch(err => console.error('Error reloading after connection restoration:', err));
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
          setDynamicResources(prev => ({ ...prev, [k8sResource.id]: items }));
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
                  if (idx === undefined) {
                    nameToIndex.set(name, list.length);
                    list.push(nextItem);
                  } else {
                    list[idx] = nextItem;
                  }
                }
              }
              list.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
              if (resTypeId === getPaneResourceType()) {
                setResourceCount(list.length);
              }
              return { ...prev, [resTypeId]: list };
            });
          }, 40) as unknown as number;
        };
        const proj = (resourceType && resourceTypeConfigs[resourceType]?.projectFields) || undefined;
        const params = proj && proj.length > 0 ? { fields: JSON.stringify(proj) } : undefined;
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
            props.onWatchStatus(s);
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
                  try { return updater(item, extraList); } catch { return item; }
                });
                enriched.sort((a: any, b: any) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
                const next: Record<string, any[]> = { ...prev, [resTypeId]: extraList, [mainId]: enriched };
                return next;
              });
            }, 40) as unknown as number;
          };
          const extraParams = Array.isArray(ex.projectFields) && ex.projectFields.length > 0 ? { fields: JSON.stringify(ex.projectFields) } : undefined;
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

    const filteredResources = createMemo(() => {
      const resources = dynamicResources()[getPaneResourceType() || ''] || [];
      const filters = paneActiveFilters().filter(filter => filter.name !== "ResourceType" && filter.name !== "Namespace");
      if (filters.length === 0) { return resources; }
      return resources.filter(resource => filters.some(filter => filterStore.filterRegistry[filter.name]?.filterFunction(resource, filter.value)));
    });

    // Keep resourceCount in sync with settle
    createEffect(() => {
      const hasFilters = paneActiveFilters().some(f => f.name !== 'ResourceType' && f.name !== 'Namespace');
      if (!hasFilters) {
        const all = dynamicResources()[getPaneResourceType() || ''] || [];
        setResourceCount(all.length);
        return;
      }
      if (loadingStage() === null) {
        setResourceCount(filteredResources().length);
      }
    });

    // Restart settle when filters change
    createEffect(() => {
      const _filters = paneActiveFilters();
      void _filters;
      untrack(() => bumpSettleTimer());
    });

    // Populate node filter options for pods
    createEffect(() => {
      const resourceType = getPaneResourceType();
      if (resourceType !== 'core/Pod') return;
      const allPods = dynamicResources()[resourceType] || [];
      const uniqueNodes = [...new Set(
        allPods.map((pod: any) => pod.spec?.nodeName).filter((nodeName: string) => nodeName)
      )].sort();
      setNodeOptions(uniqueNodes.map((nodeName: string) => ({ value: nodeName, label: nodeName })));
    });
    // Populate node options for jobs
    createEffect(() => {
      const resourceType = getPaneResourceType();
      if (resourceType !== 'batch/Job') return;
      const allJobs = dynamicResources()[resourceType] || [];
      const uniqueNodes = [...new Set(
        allJobs.flatMap((job: any) => (job.pods || []).map((p: any) => p.spec?.nodeName)).filter((nodeName: string) => nodeName)
      )].sort();
      setJobNodeOptions(uniqueNodes.map((nodeName: string) => ({ value: nodeName, label: nodeName })));
    });

    const effectiveColumns = createMemo<Column<any>[]>(() => {
      const resourceType = getPaneResourceType();
      const cfg = resourceType ? resourceTypeConfigs[resourceType] : undefined;
      const tblCols = tableColumns();
      const tblNames = Array.isArray(tblCols) ? tblCols.map(c => String((c as any)?.header || '').toLowerCase()) : [];
      const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
      const namespaced = Boolean(k8sResource?.namespaced);
      const ns = getPaneNamespace();
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
            activeFilters={paneActiveFilters()}
            setActiveFilters={updatePaneActiveFilters}
            isolated
            keyboardEnabled={props.focused}
          />
          <div class="vertical-separator" />
          <div class="filterbar-flex">
            <FilterBar
              filters={paneFilters()}
              activeFilters={paneActiveFilters()}
              onFilterChange={updatePaneActiveFilters}
              initialLoadComplete={initialLoadComplete()}
              loadingStage={loadingStage()}
              resourceCount={resourceCount()}
              keyboardEnabled={props.focused}
              onGoBack={paneGoBack}
              onGoForward={paneGoForward}
              canGoBack={paneCanGoBack()}
              canGoForward={paneCanGoForward()}
            />
          </div>
          <div class="filter-history-nav">
            <div class="keyboard-shortcut-container">
              <KeyboardShortcuts 
                shortcuts={[{ key: `Mod+1..9`, description: 'Switch view' }]}
                resourceSelected
              />
            </div>
          </div>
          <div class="filter-history-nav">
            <div class="filter-group">
              <button 
                class="filter-group-button"
                classList={{ "has-active-filters": false, "disabled": !paneCanGoBack() }}
                onClick={() => paneGoBack()}
                disabled={!paneCanGoBack()}
                title="Go back in filter history"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <div class="filter-group">
              <button 
                class="filter-group-button"
                classList={{ "has-active-filters": false, "disabled": !paneCanGoForward() }}
                onClick={() => paneGoForward()}
                disabled={!paneCanGoForward()}
                title="Go forward in filter history"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <section class="resource-section full-width">
          <Show when={errorStore.currentError} fallback={
            <Show when={effectiveColumns().length > 0}>
              <ResourceList 
                resources={filteredResources()}
                resourceTypeConfig={(resourceTypeConfigs[getPaneResourceType() || ''] as any) || { columns: [] }}
                resetKey={listResetKey()}
                columns={effectiveColumns()}
                navigate={navigate}
                keyboardEnabled={props.focused}
                isActive={props.focused}
              />
            </Show>
          }>
            <ErrorDisplay class="inline" />
          </Show>
        </section>
      </div>
    );
  }

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
          
          {/* Right-aligned settings button */}
        <div style={{ "flex-grow": 1 }} />
          {/* Split controls */}
          <div class="split-controls">
            <button
              type="button"
              class="split-button"
              title={`Split horizontally (${formatShortcutForDisplay('Mod+-')})`}
              onClick={() => {
                setOrientation('horizontal');
                setPanes(prev => {
                  const newIdx = prev.length;
                  setActivePaneIndex(newIdx);
                  return [...prev, { key: Date.now() }];
                });
              }}
            >
              ⎯⎯
            </button>
            <button
              type="button"
              class="split-button"
              title={`Split vertically (${formatShortcutForDisplay('Mod+|')})`}
              onClick={() => {
                setOrientation('vertical');
                setPanes(prev => {
                  const newIdx = prev.length;
                  setActivePaneIndex(newIdx);
                  return [...prev, { key: Date.now() }];
                });
              }}
            >
              ∥
            </button>
          </div>
          <button type="button" class="settings-button" title="Settings" onClick={() => setSettingsOpen(true)}>⚙︎</button>
        </div>

        <Show when={settingsOpen()}>
          <SettingsModal
            open
            onClose={() => setSettingsOpen(false)}
            theme={theme()}
            onChangeTheme={(t) => { setTheme(t); applyTheme(t); }}
            viewShortcutModifier={viewShortcutModifier()}
            onChangeViewShortcutModifier={(m) => setViewShortcutModifier(m as ShortcutPrefix)}
          />
        </Show>

        {/* Panes container */}
        <div classList={{
          "panes-container": true,
          "horizontal": orientation() === 'horizontal',
          "vertical": orientation() === 'vertical',
        }}>
          <For each={panes()}>
            {(p, idx) => (
              <>
                <DashboardPane
                  paneKey={p.key}
                  focused={idx() === activePaneIndex()}
                  onFocus={() => setActivePaneIndex(idx())}
                  onWatchStatus={(s) => setPaneStatuses(prev => ({ ...prev, [idx()]: s }))}
                />
                <Show when={idx() < panes().length - 1}>
                  <div classList={{
                    "pane-divider": true,
                    "pane-divider-horizontal": orientation() === 'horizontal',
                    "pane-divider-vertical": orientation() === 'vertical',
                  }} />
                </Show>
              </>
            )}
          </For>
        </div>
      </main>
    </div>
  );
}
