import { createContext, createSignal, useContext, JSX } from "solid-js";
import type { ActiveFilter } from "../components/filterBar/FilterBar.tsx";

interface FilterState {
  activeFilters: ActiveFilter[];
  setActiveFilters: (filters: ActiveFilter[]) => void;
  getResourceType: () => string;
  getNamespace: () => string;
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

  const setFilters = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
  };

  const store: FilterState = {
    get activeFilters() { return activeFilters(); },
    setActiveFilters: setFilters,
    getResourceType,
    getNamespace
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