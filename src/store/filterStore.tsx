import { createContext, createSignal, useContext, JSX, createEffect, createMemo } from "solid-js";
import type { ActiveFilter, Filter, FilterOption, FilterType } from "../components/filterBar/FilterBar.tsx";
import { useApiResourceStore } from "./apiResourceStore.tsx";
import type { K8sResource } from "../types/k8s.ts";
import { podsStatusFilter } from "../components/resourceList/PodList.tsx";
import { kustomizationReadyFilter } from "../components/resourceList/KustomizationList.tsx";
import { argocdApplicationSyncFilter, argocdApplicationHealthFilter } from "../components/resourceList/ApplicationList.tsx";

interface FilterState {
  activeFilters: ActiveFilter[];
  setActiveFilters: (filters: ActiveFilter[]) => void;
  getResourceType: () => string;
  getNamespace: () => string;
  selectedView: string;
  previousSelectedView: string | null;
  setSelectedView: (viewId: string) => void;
  availableResources: K8sResource[];
  filterRegistry: Record<string, Filter>;
  namespaceOptions: FilterOption[];
  resourceTypeFilter: Filter;
  nameFilter: Filter;
  namespaceFilter: Filter;
}

const FilterContext = createContext<FilterState>();

export function FilterProvider(props: { children: JSX.Element }) {
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);
  const [selectedView, setSelectedView] = createSignal<string>('');
  const [previousSelectedView, setPreviousSelectedView] = createSignal<string | null>(null);
  const [availableResources, setAvailableResources] = createSignal<K8sResource[]>([]);
  const [filterRegistry, setFilterRegistry] = createSignal<Record<string, Filter>>({});
  const apiResourceStore = useApiResourceStore();

  const nameFilter: Filter = {
    name: "Name",
    type: "text" as FilterType,
    placeholder: "Filter by name",
    filterFunction: (resource: any, value: string) => {
      return resource.metadata.name.toLowerCase().includes(value.toLowerCase());
    }
  };

  const getResourceType = () => {
    const rtFilter = activeFilters().find(f => f.filter.name === "ResourceType");
    return rtFilter ? rtFilter.value : 'core/Pod'; // Default value
  };

  const getNamespace = () => {
    const nsFilter = activeFilters().find(f => f.filter.name === "Namespace");
    return nsFilter ? nsFilter.value : '';
  };

  const namespaceOptions = createMemo<FilterOption[]>(() => {
    const namespaces = apiResourceStore.namespaces;
    if (!namespaces) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
    return [
      { value: 'all-namespaces', label: 'All Namespaces' },
      ...namespaces.map((ns: string) => ({ value: ns, label: ns }))
    ];
  });

  const namespaceFilter: Filter = {
    name: "Namespace",
    type: "select" as FilterType,
    get options() { return namespaceOptions(); },
    multiSelect: false,
    filterFunction: () => true
  };

  // Define dynamic resource filters
  const dynamicResourceFilters: Record<string, Filter[]> = {
    'kustomize.toolkit.fluxcd.io/Kustomization': [kustomizationReadyFilter],
    'argoproj.io/Application': [argocdApplicationSyncFilter, argocdApplicationHealthFilter],
    'core/Pod': [podsStatusFilter]
  };

  const resourceTypeFilter = (): Filter => ({
    name: "ResourceType",
    type: "select" as FilterType,
    options: availableResources().map(type => ({ value: type.id, label: type.kind })),
    multiSelect: false,
    searchable: true,
    filterFunction: () => true,
    renderOption: (option: FilterOption) => {
      const resource = availableResources().find(res => res.id === option.value);
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
  });

  const setFilters = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
  };

  // Update active filters when resourceType changes
  createEffect(() => {
    const currentResourceType = getResourceType();
    if (!currentResourceType) return;
    
    const selectedResource = availableResources().find(res => res.id === currentResourceType);
    if (!selectedResource) return;
    
    // Create a completely new array of filters
    const newFilters = [
      // Add the ResourceType filter first
      { 
        filter: resourceTypeFilter(), 
        value: currentResourceType 
      },
      // Include all other non-ResourceType filters
      ...activeFilters().filter(f => f.filter.name !== "ResourceType")
    ];
    
    // Only update if needed to avoid infinite loops
    if (JSON.stringify(newFilters) !== JSON.stringify(activeFilters())) {
      setActiveFilters(newFilters);
    }
  });

  // Check for necessary filter initialization
  const initializeFiltersIfNeeded = () => {
    if (!apiResourceStore.namespaces || availableResources().length === 0) {
      return; // Not ready to initialize yet
    }
    
    // Check if we need to set a default namespace filter
    const currentNamespace = getNamespace();
    if (!currentNamespace) {
      // Get available namespaces
      const namespaceList = apiResourceStore.namespaces;
      if (!namespaceList || namespaceList.length === 0) return;
      
      const defaultNamespace = namespaceList[0];
      
      // Find the namespace filter in filterRegistry
      const namespaceFilterFromRegistry = filterRegistry()["Namespace"];
      
      if (namespaceFilterFromRegistry) {
        // Add a namespace filter
        setActiveFilters([
          ...activeFilters(),
          { filter: namespaceFilterFromRegistry, value: defaultNamespace }
        ]);
      }
    }
  };

  // Setup availableResources when apiResources changes
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
          resourceFilters.push(namespaceFilter);
        }
        resourceFilters.push(nameFilter);
        
        resourceFilters.push(...(dynamicResourceFilters[resourceId] || []));

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

    setAvailableResources(resources);
  });
  
  // Create filterRegistry dynamically from Available Resources
  createEffect(() => {
    const registry: Record<string, Filter> = {
      "ResourceType": resourceTypeFilter(),
    };

    // Add all filters from all resources to the registry
    availableResources().forEach(type => {
      type.filters.forEach(filter => {
        if (!registry[filter.name]) {
          registry[filter.name] = filter;
        }
      });
    });

    setFilterRegistry(registry);
  });

  // Auto-initialize filters when store data is ready
  createEffect(() => {
    if (apiResourceStore.namespaces && availableResources().length > 0) {
      initializeFiltersIfNeeded();
    }
  });

  // Handle view changes - keep this simple for integration with ViewBar
  createEffect(() => {
    const currentViewId = selectedView();
    if (currentViewId === previousSelectedView() || !currentViewId) {
      return;
    }
    setPreviousSelectedView(currentViewId);
  });

  const store: FilterState = {
    get activeFilters() { return activeFilters(); },
    setActiveFilters: setFilters,
    getResourceType,
    getNamespace,
    get selectedView() { return selectedView(); },
    get previousSelectedView() { return previousSelectedView(); },
    setSelectedView: setSelectedView,
    get availableResources() { return availableResources(); },
    get filterRegistry() { return filterRegistry(); },
    get namespaceOptions() { return namespaceOptions(); },
    get resourceTypeFilter() { return resourceTypeFilter(); },
    get nameFilter() { return nameFilter; },
    get namespaceFilter() { return namespaceFilter; }
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