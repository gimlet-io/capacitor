import { createContext, createSignal, useContext, JSX } from "solid-js";
import type { ActiveFilter } from "../components/filterBar/FilterBar.tsx";

interface FilterState {
  activeFilters: ActiveFilter[];
  setActiveFilters: (filters: ActiveFilter[]) => void;
  getResourceType: () => string;
  getNamespace: () => string;
  updateFilters: (resourceType: string, filters: ActiveFilter[]) => void;
}

const FilterContext = createContext<FilterState>();

export function FilterProvider(props: { children: JSX.Element }) {
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);

  const getResourceType = () => {
    const rtFilter = activeFilters().find(f => f.filter.name === "ResourceType");
    return rtFilter ? rtFilter.value : 'core/Pod'; // Default value
  };

  const getNamespace = () => {
    const nsFilter = activeFilters().find(f => f.filter.name === "Namespace");
    return nsFilter ? nsFilter.value : '';
  };

  const updateFilters = (resourceType: string, filters: ActiveFilter[]) => {
    // Ensure we have a ResourceType filter
    const withoutResourceTypeFilter = filters.filter(f => f.filter.name !== "ResourceType");
    
    // Find the ResourceType filter in the existing filters
    const existingResourceTypeFilter = activeFilters().find(f => f.filter.name === "ResourceType");

    if (existingResourceTypeFilter) {
      // Create a new filter with the updated value but same filter object
      setActiveFilters([
        { filter: existingResourceTypeFilter.filter, value: resourceType },
        ...withoutResourceTypeFilter
      ]);
    } else {
      // Just set the filters as is (should have ResourceType already)
      setActiveFilters(filters);
    }
  };

  const store: FilterState = {
    get activeFilters() { return activeFilters(); },
    setActiveFilters,
    getResourceType,
    getNamespace,
    updateFilters
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