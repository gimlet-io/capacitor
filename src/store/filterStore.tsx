import { createContext, createSignal, useContext, JSX, createEffect, createMemo, untrack } from "solid-js";
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
}

const FilterContext = createContext<FilterState>();

export function FilterProvider(props: { children: JSX.Element }) {
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);
  const [selectedView, setSelectedView] = createSignal<string>('');
  const [previousSelectedView, setPreviousSelectedView] = createSignal<string | null>(null);
  const [k8sResources, setK8sResources] = createSignal<K8sResource[]>([]);
  const [filterRegistry, setFilterRegistry] = createSignal<Record<string, Filter>>({});
  const [filterHistory, setFilterHistory] = createSignal<{ filters: ActiveFilter[]; viewId: string }[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = createSignal<number>(-1);
  const [isNavigating, setIsNavigating] = createSignal<boolean>(false);
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

  // Custom setActiveFilters that manages history
  const setActiveFiltersWithHistory = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
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
    
    // Create a completely new array of filters
    const newFilters = [
      // Add the ResourceType filter first
      { 
        name: resourceTypeFilter().name, 
        value: currentResourceType 
      },
      // Include all other non-ResourceType filters
      ...activeFilters().filter(f => f.name !== "ResourceType")
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