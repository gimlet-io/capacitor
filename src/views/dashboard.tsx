// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, Show, onMount, createMemo, untrack, For, Index, onCleanup } from "solid-js";
import { ResourceList } from "../components/index.ts";
import { useNavigate } from "@solidjs/router";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import { FilterBar, type ActiveFilter } from "../components/filterbar/FilterBar.tsx";
import { SettingsModal } from "../components/settings/SettingsModal.tsx";
import { applyTheme, loadInitialTheme, type ThemeName } from "../utils/theme.ts";
import { KeyboardShortcuts } from "../components/keyboardShortcuts/KeyboardShortcuts.tsx";
import { ShortcutPrefix, getShortcutPrefix, getDefaultShortcutPrefix, setShortcutPrefix, formatShortcutForDisplay } from "../utils/shortcuts.ts";
import { watchResource } from "../watches.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { PaneFilterProvider, usePaneFilterStore } from "../store/paneFilterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { ErrorDisplay } from "../components/ErrorDisplay.tsx";
import { resourceTypeConfigs, type Column, namespaceColumn, type ExtraWatchConfig } from "../resourceTypeConfigs.tsx";
import { setNodeOptions } from "../components/resourceList/PodList.tsx";
import { setJobNodeOptions } from "../components/resourceList/JobList.tsx";
import { keyboardManager } from "../utils/keyboardManager.ts";

export function Dashboard() {
  const navigate = useNavigate();
  const filterStore = useFilterStore();
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  // Pane management - tree structure for nested splits
  type Orientation = 'horizontal' | 'vertical';
  type PaneNode = {
    type: 'pane';
    key: number;
  } | {
    type: 'split';
    orientation: Orientation;
    children: PaneNode[];
  };
  
  const [paneTree, setPaneTree] = createSignal<PaneNode>({
    type: 'split',
    orientation: 'horizontal',
    children: [
      { type: 'pane', key: 0 },
      { type: 'pane', key: 1 }
    ]
  });
  const [activePaneKey, setActivePaneKey] = createSignal(0);
  const [paneStatuses, setPaneStatuses] = createSignal<Record<number, string>>({});
  
  // Store per-pane filter state to persist across pane tree changes
  const [paneStates, setPaneStates] = createSignal<Record<number, ActiveFilter[]>>({
    0: [
      { name: 'ResourceType', value: 'core/Pod' },
      { name: 'Namespace', value: 'all-namespaces' }
    ],
    1: [
      { name: 'ResourceType', value: 'core/Pod' },
      { name: 'Namespace', value: 'all-namespaces' }
    ]
  });
  
  // Separate store for pane sizes to avoid re-creating pane objects
  // Key format: "path:orientation" e.g. "0,1:horizontal" for the split at path [0,1]
  const [paneSizes, setPaneSizes] = createSignal<Record<string, number[]>>({});
  
  // Resize state
  const [resizing, setResizing] = createSignal<{
    startPos: number;
    startSizes: number[];
    resizeIndices: [number, number];
    orientation: Orientation;
    parentPath: number[];
  } | null>(null);

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
    const s = paneStatuses()[activePaneKey()];
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
  
  // Helper functions for tree manipulation
  const findAndReplacePaneWithSplit = (node: PaneNode, targetKey: number, orientation: Orientation, newKey: number): PaneNode => {
    if (node.type === 'pane') {
      if (node.key === targetKey) {
        return {
          type: 'split',
          orientation,
          children: [
            { type: 'pane', key: node.key },
            { type: 'pane', key: newKey }
          ]
        };
      }
      return node;
    }
    
    return {
      ...node,
      children: node.children.map(child => findAndReplacePaneWithSplit(child, targetKey, orientation, newKey))
    };
  };
  
  const findAndRemovePane = (node: PaneNode, targetKey: number): PaneNode | null => {
    if (node.type === 'pane') {
      return node.key === targetKey ? null : node;
    }
    
    const newChildren = node.children
      .map(child => findAndRemovePane(child, targetKey))
      .filter((child): child is PaneNode => child !== null);
    
    // If only one child left, collapse the split
    if (newChildren.length === 1) {
      return newChildren[0];
    }
    
    // If no children left, remove this split
    if (newChildren.length === 0) {
      return null;
    }
    
    return {
      ...node,
      children: newChildren
    };
  };
  
  const findFirstPaneKey = (node: PaneNode): number | null => {
    if (node.type === 'pane') {
      return node.key;
    }
    if (node.children.length > 0) {
      return findFirstPaneKey(node.children[0]);
    }
    return null;
  };
  
  const getAllPaneKeys = (node: PaneNode): number[] => {
    if (node.type === 'pane') {
      return [node.key];
    }
    return node.children.flatMap(child => getAllPaneKeys(child));
  };
  
  // Find the path (indices) to a pane by key. Returns array of child indexes or null.
  const findPanePath = (node: PaneNode, targetKey: number, path: number[] = []): number[] | null => {
    if (node.type === 'pane') {
      return node.key === targetKey ? path : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const found = findPanePath(child, targetKey, [...path, i]);
      if (found) return found;
    }
    return null;
  };
  
  // Get a node by path
  const getNodeAtPath = (node: PaneNode, path: number[]): PaneNode | null => {
    let current: PaneNode | null = node;
    for (const idx of path) {
      if (!current || current.type !== 'split') return null;
      current = current.children[idx] ?? null;
    }
    return current;
  };
  
  // Determine which pane key should become active when target pane is closed.
  // Prefers the next sibling (first leaf), otherwise previous sibling (first leaf).
  const chooseNextActivePaneKeyBeforeRemoval = (root: PaneNode, targetKey: number): number | null => {
    const path = findPanePath(root, targetKey);
    if (!path || path.length === 0) return null;
    const parentPath = path.slice(0, -1);
    const idx = path[path.length - 1];
    const parent = getNodeAtPath(root, parentPath);
    if (!parent || parent.type !== 'split') return null;
    // Try next sibling
    if (idx + 1 < parent.children.length) {
      const nextSibling = parent.children[idx + 1];
      const nextKey = findFirstPaneKey(nextSibling);
      if (nextKey !== null) return nextKey;
    }
    // Fallback to previous sibling
    if (idx - 1 >= 0) {
      const prevSibling = parent.children[idx - 1];
      const prevKey = findFirstPaneKey(prevSibling);
      if (prevKey !== null) return prevKey;
    }
    return null;
  };
  
  // Get a stable key for a node (pane key or hash of children keys for splits)
  const getNodeKey = (node: PaneNode): string => {
    if (node.type === 'pane') {
      return `pane-${node.key}`;
    }
    // For splits, create a stable key based on children keys
    const childKeys = node.children.map(c => getNodeKey(c)).join('|');
    return `split-${childKeys}`;
  };
  
  // Unified pane close behavior used by keyboard and buttons
  const closePane = (targetKey?: number) => {
    const keyToClose = targetKey ?? activePaneKey();
    const allKeys = getAllPaneKeys(paneTree());
    if (allKeys.length <= 1) return; // Don't close last pane
    const preferredNextKey = chooseNextActivePaneKeyBeforeRemoval(paneTree(), keyToClose);
    const newTree = findAndRemovePane(paneTree(), keyToClose);
    if (newTree) {
      setPaneTree(newTree);
      const fallbackKey = findFirstPaneKey(newTree);
      const nextKey = preferredNextKey ?? fallbackKey;
      if (nextKey !== null) setActivePaneKey(nextKey);
      
      // Clean up pane state when closing
      setPaneStates(prev => {
        const newStates = { ...prev };
        delete newStates[keyToClose];
        return newStates;
      });
    }
  };
  
  // Resize handlers
  const handleResizeStart = (e: MouseEvent, idx: number, orientation: Orientation, parentPath: number[]) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    
    const children = Array.from(container.children).filter(el => 
      el.classList.contains('pane-wrapper') || el.classList.contains('panes-container')
    );
    if (idx >= children.length - 1) return;
    
    // Capture ALL sibling sizes to lock the layout
    const allSizes = children.map(child => {
      const el = child as HTMLElement;
      return orientation === 'horizontal' ? el.offsetHeight : el.offsetWidth;
    });
    
    const startPos = orientation === 'horizontal' ? e.clientY : e.clientX;
    
    setResizing({
      startPos,
      startSizes: allSizes,
      resizeIndices: [idx, idx + 1],
      orientation,
      parentPath
    });
  };
  
  const handleResizeMove = (e: MouseEvent) => {
    const resize = resizing();
    if (!resize) return;
    
    const currentPos = resize.orientation === 'horizontal' ? e.clientY : e.clientX;
    const delta = currentPos - resize.startPos;
    
    const [idx1, idx2] = resize.resizeIndices;
    const totalSizeOfPair = resize.startSizes[idx1] + resize.startSizes[idx2];
    const newSize1 = Math.max(50, Math.min(totalSizeOfPair - 50, resize.startSizes[idx1] + delta));
    const newSize2 = totalSizeOfPair - newSize1;
    
    // Build new sizes array with all siblings
    const newSizes = [...resize.startSizes];
    newSizes[idx1] = newSize1;
    newSizes[idx2] = newSize2;
    
    // Store sizes separately to avoid re-creating pane objects
    const pathKey = resize.parentPath.join(',');
    setPaneSizes(prev => ({
      ...prev,
      [pathKey]: newSizes
    }));
  };
  
  const handleResizeEnd = () => {
    setResizing(null);
  };
  
  onMount(() => {
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
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
          const hasAnyMod = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
          if (hasAnyMod) {
            e.preventDefault();
            const newKey = Date.now();
            const currentKey = activePaneKey();
            // Copy current pane's state to new pane
            setPaneStates(prev => ({
              ...prev,
              [newKey]: [...(prev[currentKey] || [])]
            }));
            setPaneTree(prev => findAndReplacePaneWithSplit(prev, currentKey, 'vertical', newKey));
            setActivePaneKey(newKey);
            return true;
          }
        }
        // Split horizontal: Mod + -
        if (e.key === '-' && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
          e.preventDefault();
          const newKey = Date.now();
          const currentKey = activePaneKey();
          // Copy current pane's state to new pane
          setPaneStates(prev => ({
            ...prev,
            [newKey]: [...(prev[currentKey] || [])]
          }));
          setPaneTree(prev => findAndReplacePaneWithSplit(prev, currentKey, 'horizontal', newKey));
          setActivePaneKey(newKey);
          return true;
        }
        // Close current pane: Mod + x
        if ((e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
          e.preventDefault();
          closePane(activePaneKey());
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
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    document.removeEventListener('mousedown', handleOutsideClick);
  });

  createEffect(() => {
    setShortcutPrefix(viewShortcutModifier());
  });

  // Pane wrapper with provider
  function DashboardPaneWithProvider(props: {
    paneKey: number;
    focused: boolean;
    onFocus: () => void;
    onWatchStatus: (status: string) => void;
  }) {
    // Get persisted state or use defaults
    const initialFilters = paneStates()[props.paneKey] || [
      { name: 'ResourceType', value: 'core/Pod' },
      { name: 'Namespace', value: 'all-namespaces' }
    ];
    
    // Sync state changes back to paneStates
    const handleStateChange = (filters: ActiveFilter[]) => {
      setPaneStates(prev => ({
        ...prev,
        [props.paneKey]: filters
      }));
    };
    
    return (
      <PaneFilterProvider 
        paneId={props.paneKey} 
        initialFilters={initialFilters}
        onStateChange={handleStateChange}
      >
        <DashboardPane {...props} />
      </PaneFilterProvider>
    );
  }

  // Pane subcomponent encapsulating resources, filters, list and watchers
  function DashboardPane(props: {
    paneKey: number;
    focused: boolean;
    onFocus: () => void;
    onWatchStatus: (status: string) => void;
  }) {
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
              if (resTypeId === paneFilterStore.getResourceType()) {
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
            keyboardEnabled={props.focused}
          />
          <div class="vertical-separator" />
          <div class="filterbar-flex">
            <FilterBar
              initialLoadComplete={initialLoadComplete()}
              loadingStage={loadingStage()}
              resourceCount={resourceCount()}
              keyboardEnabled={props.focused}
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
                  const newKey = Date.now();
                  // Copy current pane's state to new pane
                  setPaneStates(prev => ({
                    ...prev,
                    [newKey]: [...(prev[props.paneKey] || [])]
                  }));
                  setPaneTree(prev => findAndReplacePaneWithSplit(prev, props.paneKey, 'horizontal', newKey));
                  setActivePaneKey(newKey);
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
                  const newKey = Date.now();
                  // Copy current pane's state to new pane
                  setPaneStates(prev => ({
                    ...prev,
                    [newKey]: [...(prev[props.paneKey] || [])]
                  }));
                  setPaneTree(prev => findAndReplacePaneWithSplit(prev, props.paneKey, 'vertical', newKey));
                  setActivePaneKey(newKey);
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
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); closePane(props.paneKey); }}
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

  // Component wrapper for a pane node to isolate reactivity
  function PaneNodeWrapper(props: { node: PaneNode; path: number[]; childIndex: number }) {
    // Memo to read size reactively only for this specific pane
    const size = createMemo(() => {
      if (props.path.length > 0) {
        const parentPathKey = props.path.slice(0, -1).join(',');
        const sizes = paneSizes()[parentPathKey];
        return sizes?.[props.childIndex];
      }
      return undefined;
    });
    
    const style = createMemo(() => {
      const s = size();
      return s !== undefined 
        ? { 'flex': `0 0 ${s}px` } 
        : { 'flex': '1 1 0px' };
    });
    
    if (props.node.type === 'pane') {
      return (
        <div style={style()} class="pane-wrapper">
          <DashboardPaneWithProvider
            paneKey={props.node.key}
            focused={props.node.key === activePaneKey()}
            onFocus={() => setActivePaneKey(props.node.key)}
            onWatchStatus={(s) => setPaneStatuses(prev => ({ ...prev, [props.node.key]: s }))}
          />
        </div>
      );
    }
    
    // It's a split container
    return (
      <div style={style()} class="pane-wrapper">
        <div classList={{
          "panes-container": true,
          "horizontal": props.node.orientation === 'horizontal',
          "vertical": props.node.orientation === 'vertical',
        }}>
          <Index each={props.node.children}>
            {(child, idx) => (
              <>
                <PaneNodeWrapper
                  node={child()}
                  path={[...props.path, idx]}
                  childIndex={idx}
                />
                <Show when={idx < props.node.children.length - 1}>
                  <div 
                    classList={{
                      "pane-divider": true,
                      "pane-divider-horizontal": props.node.orientation === 'horizontal',
                      "pane-divider-vertical": props.node.orientation === 'vertical',
                    }}
                    onMouseDown={(e) => handleResizeStart(e, idx, props.node.orientation, props.path)}
                  />
                </Show>
              </>
            )}
          </Index>
        </div>
      </div>
    );
  }
  
  // Recursive function to render pane tree
  const renderPaneNode = (node: PaneNode): any => {
    return <PaneNodeWrapper node={node} path={[]} childIndex={0} />;
  };

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
        {renderPaneNode(paneTree())}
      </main>
    </div>
  );
}
