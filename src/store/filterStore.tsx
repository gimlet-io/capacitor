import { createContext, createSignal, useContext, JSX, createEffect, createMemo, untrack, onMount } from "solid-js";
import type { ActiveFilter, Filter, FilterOption, FilterType } from "../components/filterBar/FilterBar.tsx";
import { useApiResourceStore } from "./apiResourceStore.tsx";
import type { K8sResource } from "../types/k8s.ts";
import { resourceTypeConfigs } from "../resourceTypeConfigs.tsx";
import { parseGlobFilter, matchGlobPatterns } from "../utils/glob.ts";
interface FilterState {
  filters: Filter[]; // all filters
  filterRegistry: Record<string, Filter>;

  activeFilters: ActiveFilter[]; // filters that have set with a value
  setActiveFilters: (filters: ActiveFilter[]) => void;

  k8sResources: K8sResource[];

  getResourceType: () => string | undefined;
  getNamespace: () => string | undefined;
  
  selectedView: string;
  previousSelectedView: string | null;
  setSelectedView: (viewId: string) => void;

  // Filter history
  filterHistory: { filters: ActiveFilter[]; viewId: string }[];
  currentHistoryIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;

  // Sorting
  sortColumn: string | null;
  setSortColumn: (column: string | null) => void;
  sortAscending: boolean;
  setSortAscending: (ascending: boolean) => void;
}

const FilterContext = createContext<FilterState>();

// URL parameter utilities
const serializeFilters = (filters: ActiveFilter[]): string => {
  if (filters.length === 0) return '';
  const filterParams = filters.map(f => `${f.name}=${encodeURIComponent(f.value)}`).join('&');
  return filterParams;
};

const deserializeFilters = (searchParams: URLSearchParams): ActiveFilter[] => {
  const filters: ActiveFilter[] = [];
  for (const [name, value] of searchParams) {
    if (name !== 'view' && name !== 'sortColumn' && name !== 'sortAscending') { // Skip view and sort parameters
      filters.push({ name, value: decodeURIComponent(value) });
    }
  }
  return filters;
};

const updateURL = (filters: ActiveFilter[], view: string, sortColumn: string | null, sortAscending: boolean) => {
  const url = new URL(window.location.href);
  url.search = '';
  
  // Add view parameter
  if (view) {
    url.searchParams.set('view', view);
  }
  
  // Add sort parameters
  if (sortColumn) {
    url.searchParams.set('sortColumn', sortColumn);
    url.searchParams.set('sortAscending', sortAscending.toString());
  }
  
  // Add filter parameters
  filters.forEach(filter => {
    url.searchParams.set(filter.name, filter.value);
  });
  
  window.history.replaceState(null, '', url.toString());
};

const loadFromURL = (): { filters: ActiveFilter[], view: string, sortColumn: string | null, sortAscending: boolean } => {
  const url = new URL(window.location.href);
  const view = url.searchParams.get('view') || '';
  const sortColumn = url.searchParams.get('sortColumn') || null;
  const sortAscending = url.searchParams.get('sortAscending') !== 'false'; // Default to true
  const filters = deserializeFilters(url.searchParams);
  return { filters, view, sortColumn, sortAscending };
};

export function FilterProvider(props: { children: JSX.Element }) {
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);
  const [selectedView, setSelectedView] = createSignal<string>('');
  const [previousSelectedView, setPreviousSelectedView] = createSignal<string | null>(null);
  const [k8sResources, setK8sResources] = createSignal<K8sResource[]>([]);
  const [filterRegistry, setFilterRegistry] = createSignal<Record<string, Filter>>({});
  const [filterHistory, setFilterHistory] = createSignal<{ filters: ActiveFilter[]; viewId: string }[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = createSignal<number>(-1);
  const [isNavigating, setIsNavigating] = createSignal<boolean>(false);
  const [isInitialized, setIsInitialized] = createSignal<boolean>(false);
  const [sortColumn, setSortColumn] = createSignal<string | null>(null);
  const [sortAscending, setSortAscending] = createSignal<boolean>(true);
  const apiResourceStore = useApiResourceStore();

  const nameFilter: Filter = {
    name: "Name",
    label: "Name",
    type: "text" as FilterType,
    placeholder: "glob support: *, ?, [abc], !pattern",
    filterFunction: (resource: any, value: string) => {
      const patterns = parseGlobFilter(value);
      return matchGlobPatterns(patterns, resource.metadata.name);
    }
  };

  // Parse a simple label selector string like:
  // key=value, key!=value, key (existence)
  const parseLabelSelector = (value: string): Array<{ key: string; op: 'eq' | 'neq' | 'exists'; val?: string }> => {
    return value
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(token => {
        const neqIndex = token.indexOf('!=');
        if (neqIndex > -1) {
          const key = token.slice(0, neqIndex).trim();
          const val = token.slice(neqIndex + 2).trim();
          return { key, op: 'neq' as const, val };
        }
        const eqIndex = token.indexOf('=');
        if (eqIndex > -1) {
          const key = token.slice(0, eqIndex).trim();
          const val = token.slice(eqIndex + 1).trim();
          return { key, op: 'eq' as const, val };
        }
        return { key: token.trim(), op: 'exists' as const };
      });
  };

  const getLabelMapForResource = (resource: any): Record<string, string> => {
    if (!resource) return {};
    // Services use spec.selector to select pods
    if (resource?.kind === 'Service') {
      const selector = resource?.spec?.selector || {};
      return selector || {};
    }
    // Default to metadata.labels
    return (resource?.metadata?.labels || {}) as Record<string, string>;
  };

  const labelSelectorFilter: Filter = {
    name: "LabelSelector",
    label: "Label",
    type: "text" as FilterType,
    placeholder: "app=web,tier=frontend or key!=val or key",
    filterFunction: (resource: any, value: string) => {
      const constraints = parseLabelSelector(value);
      if (constraints.length === 0) return true;
      const labels = getLabelMapForResource(resource);
      for (const c of constraints) {
        const current = labels[c.key];
        if (c.op === 'exists') {
          if (current === undefined) return false;
          continue;
        }
        if (c.op === 'eq') {
          if (current !== c.val) return false;
          continue;
        }
        if (c.op === 'neq') {
          if (current === c.val) return false;
          continue;
        }
      }
      return true;
    }
  };

  const getResourceType = () => {
   return activeFilters().find(f => f.name === "ResourceType")?.value;
  };

  const getNamespace = () => {
    return activeFilters().find(f => f.name === "Namespace")?.value;
  };

  // Filter history management
  const addToHistory = (filters: ActiveFilter[], viewId: string) => {
    if (isNavigating()) return; // Don't add to history when navigating
    if (filters.length === 0) return;

    untrack(() => {
      const current = filterHistory();
      const currentIndex = currentHistoryIndex();
      
      // Remove any history after current index (when branching from middle of history)
      const newHistory = current.slice(0, currentIndex + 1);
      
      // Add new state to history
      newHistory.push({ filters: [...filters], viewId });
      
      // Keep history size reasonable (last 50 states)
      if (newHistory.length > 50) {
        newHistory.shift();
      } else {
        setCurrentHistoryIndex(currentIndex + 1);
      }
    
      setFilterHistory(newHistory);
    });
  };

  const canGoBack = createMemo(() => currentHistoryIndex() >= 1);
  const canGoForward = createMemo(() => currentHistoryIndex() < filterHistory().length - 1);

  const goBack = () => {
    if (!canGoBack()) return;

    setIsNavigating(true);
    const newIndex = currentHistoryIndex() - 1;
    setCurrentHistoryIndex(newIndex);
    const historyState = filterHistory()[newIndex];
    setActiveFilters([...historyState.filters]);
    setSelectedView(historyState.viewId);
    setIsNavigating(false);
  };

  const goForward = () => {
    if (!canGoForward()) return;

    setIsNavigating(true);
    const newIndex = currentHistoryIndex() + 1;
    setCurrentHistoryIndex(newIndex);
    const historyState = filterHistory()[newIndex];
    setActiveFilters([...historyState.filters]);
    setSelectedView(historyState.viewId);
    setIsNavigating(false);
  };

  // Custom setActiveFilters that manages history and URL
  const setActiveFiltersWithHistory = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
    if (isInitialized()) {
      updateURL(filters, selectedView(), sortColumn(), sortAscending());
    }
    addToHistory(filters, selectedView());
  };

  const namespaceOptions = createMemo<FilterOption[]>(() => {
    const namespaces = apiResourceStore.namespaces;
    if (!namespaces) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
    return [
      { value: 'all-namespaces', label: 'All Namespaces' },
      ...namespaces.map((ns: string) => ({ value: ns, label: ns }))
    ];
  });

  const namespaceFilter = createMemo<Filter>(() => ({
    name: "Namespace",
    label: "Namespace",
    type: "select" as FilterType,
    get options() { return namespaceOptions(); },
    multiSelect: false,
    filterFunction: () => true
  }));

  const resourceTypeFilter = createMemo<Filter>(() => ({
    name: "ResourceType",
    label: "Resource Type",
    type: "select" as FilterType,
    options: k8sResources().map(type => ({ value: type.id, label: type.kind })),
    multiSelect: false,
    searchable: true,
    filterFunction: () => true,
    renderOption: (option: FilterOption) => {
      const resource = k8sResources().find(res => res.id === option.value);
      if (!resource) {
        return option.label;
      }
      
      // Always show group, using "core" for resources without a specific group
      const groupName = resource.group || "core";
      
      return (
        <>
          {resource.kind} <span style="color: var(--linear-text-tertiary);">&nbsp;{groupName}</span>
        </>
      );
    }
  }));

  // Update active filters when resourceType changes
  createEffect(() => {
    const currentResourceType = getResourceType();
    if (!currentResourceType) return;
    
    const selectedResource = k8sResources().find(res => res.id === currentResourceType);
    if (!selectedResource) return;
    
    // Only keep filters that are supported by the newly selected resource type
    const allowedFilterNames = new Set<string>([
      ...selectedResource.filters.map(f => f.name),
    ]);

    // Create a new filter set: ResourceType + applicable filters only
    const newFilters = [
      { name: resourceTypeFilter().name, value: currentResourceType },
      ...activeFilters().filter(f => f.name !== "ResourceType" && allowedFilterNames.has(f.name))
    ];
    
    // Only update if needed to avoid infinite loops
    if (JSON.stringify(newFilters) !== JSON.stringify(activeFilters())) {
      setActiveFilters(newFilters);
    }
  });

  // Setup k8sResources when apiResources changes
  createEffect(() => {        
    const apiResources = apiResourceStore.apiResources;
    if (!apiResources) {
      return;
    }

    const resources: K8sResource[] = apiResources
      .map((resource: any) => {
        const resourceId = `${resource.group || 'core'}/${resource.kind}`;
        const resourceFilters = [];
        if (resource.namespaced) {
          resourceFilters.push(namespaceFilter());
        }
        resourceFilters.push(nameFilter);
        // Add label selector filter to Pods and Services
        if (resource.kind === 'Pod' || resource.kind === 'Service') {
          resourceFilters.push(labelSelectorFilter);
        }
        
        resourceFilters.push(...(resourceTypeConfigs[resourceId]?.filter || []));

        return {
          id: resourceId,
          filters: resourceFilters,
          group: resource.group || 'core',
          version: resource.version || 'v1',
          kind: resource.kind,
          apiPath: resource.apiPath || '/k8s/api/v1',
          name: resource.name,
          namespaced: resource.namespaced
        };
      });

    // Add Helm releases as a special resource type
    const helmReleaseResource: K8sResource = {
      id: 'helm.sh/Release',
      filters: [namespaceFilter(), nameFilter, ...(resourceTypeConfigs['helm.sh/Release']?.filter || [])],
      group: 'helm.sh',
      version: 'v3',
      kind: 'Release',
      apiPath: '/api/helm/releases',
      name: 'releases',
      namespaced: true
    };

    resources.push(helmReleaseResource);

    setK8sResources(resources);
  });

  const filters = createMemo<Filter[]>(() => {
    return [resourceTypeFilter(), ...(k8sResources().find(res => res.id === getResourceType())?.filters || [])];
  });
  
  // Create filterRegistry dynamically from Available Resources
  createEffect(() => {
    const registry: Record<string, Filter> = {
      "ResourceType": resourceTypeFilter(),
    };

    // Add all filters from all resources to the registry
    k8sResources().forEach(type => {
      type.filters.forEach(filter => {
        if (!registry[filter.name]) {
          registry[filter.name] = filter;
        }
      });
    });

    setFilterRegistry(registry);
  });

  // Initialize from URL on mount
  onMount(() => {
    const urlState = loadFromURL();
    if (urlState.filters.length > 0 || urlState.view || urlState.sortColumn) {
      setActiveFilters(urlState.filters);
      setSelectedView(urlState.view);
      setSortColumn(urlState.sortColumn);
      setSortAscending(urlState.sortAscending);
    }
    setIsInitialized(true);

    // Handle browser back/forward navigation
    const handlePopState = () => {
      const urlState = loadFromURL();
      setActiveFilters(urlState.filters);
      setSelectedView(urlState.view);
      setSortColumn(urlState.sortColumn);
      setSortAscending(urlState.sortAscending);
    };
    
    window.addEventListener('popstate', handlePopState);
    
    // Cleanup
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  });

  // Sync URL when selectedView or sorting changes
  createEffect(() => {
    if (isInitialized()) {
      updateURL(activeFilters(), selectedView(), sortColumn(), sortAscending());
    }
  });

  // Handle view changes - keep this simple for integration with ViewBar
  createEffect(() => {
    const currentViewId = selectedView();
    // Always update previousSelectedView when selectedView changes
    // Removed the condition that was blocking tracking when reselecting a view
    setPreviousSelectedView(currentViewId);
  });

  const store: FilterState = {
    get filters() { return filters(); },
    get filterRegistry() { return filterRegistry(); },

    get activeFilters() { return activeFilters(); },
    setActiveFilters: setActiveFiltersWithHistory,
    getResourceType,
    getNamespace,

    get k8sResources() { return k8sResources(); },

    
    get selectedView() { return selectedView(); },
    get previousSelectedView() { return previousSelectedView(); },
    setSelectedView: setSelectedView,

    get filterHistory() { return filterHistory(); },
    get currentHistoryIndex() { return currentHistoryIndex(); },
    get canGoBack() { return canGoBack(); },
    get canGoForward() { return canGoForward(); },
    goBack,
    goForward,
    get sortColumn() { return sortColumn(); },
    setSortColumn: setSortColumn,
    get sortAscending() { return sortAscending(); },
    setSortAscending: setSortAscending,
  };

  return (
    <FilterContext.Provider value={store}>
      {props.children}
    </FilterContext.Provider>
  );
}

export function useFilterStore() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error("useFilterStore must be used within a FilterProvider");
  }
  return context;
} 