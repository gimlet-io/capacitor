import { createContext, createSignal, useContext, JSX, createEffect } from "solid-js";
import type { ActiveFilter } from "../components/filterBar/FilterBar.tsx";
import { useApiResourceStore } from "./apiResourceStore.tsx";

interface FilterState {
  activeFilters: ActiveFilter[];
  setActiveFilters: (filters: ActiveFilter[]) => void;
  getResourceType: () => string;
  getNamespace: () => string;
  selectedView: string;
  previousSelectedView: string | null;
  setSelectedView: (viewId: string) => void;
}

const FilterContext = createContext<FilterState>();

export function FilterProvider(props: { children: JSX.Element }) {
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);
  const [selectedView, setSelectedView] = createSignal<string>('');
  const [previousSelectedView, setPreviousSelectedView] = createSignal<string | null>(null);
  const apiResourceStore = useApiResourceStore();

  const getResourceType = () => {
    const rtFilter = activeFilters().find(f => f.filter.name === "ResourceType");
    return rtFilter ? rtFilter.value : 'core/Pod'; // Default value
  };

  const getNamespace = () => {
    const nsFilter = activeFilters().find(f => f.filter.name === "Namespace");
    return nsFilter ? nsFilter.value : '';
  };

  const setFilters = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
  };

  // Update active filters when resourceType changes
  createEffect(() => {
    const currentResourceType = getResourceType();
    if (!currentResourceType) return;
    
    const selectedResource = apiResourceStore.availableResources.find(res => res.id === currentResourceType);
    if (!selectedResource) return;
    
    // Create a completely new array of filters
    const newFilters = [
      // Add the ResourceType filter first
      { 
        filter: apiResourceStore.resourceTypeFilter, 
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
    if (!apiResourceStore.namespaces || apiResourceStore.availableResources.length === 0) {
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
      const namespaceFilter = apiResourceStore.filterRegistry["Namespace"];
      
      if (namespaceFilter) {
        // Add a namespace filter
        setActiveFilters([
          ...activeFilters(),
          { filter: namespaceFilter, value: defaultNamespace }
        ]);
      }
    }
  };

  // Auto-initialize filters when store data is ready
  createEffect(() => {
    if (apiResourceStore.namespaces && apiResourceStore.availableResources.length > 0) {
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
    setSelectedView: setSelectedView
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