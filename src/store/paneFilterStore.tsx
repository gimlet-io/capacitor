// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createContext, createSignal, useContext, JSX, createMemo, onMount, onCleanup, createEffect } from "solid-js";
import type { ActiveFilter } from "../components/filterBar/FilterBar.tsx";

interface PaneFilterState {
  // Active filters for this pane
  activeFilters: ActiveFilter[];
  setActiveFilters: (filters: ActiveFilter[]) => void;
  
  // Selected view for this pane
  selectedView: string;
  setSelectedView: (viewId: string) => void;
  
  // Filter history for back/forward navigation
  filterHistory: { filters: ActiveFilter[]; viewId: string }[];
  currentHistoryIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  
  // Sorting state
  sortColumn: string | null;
  setSortColumn: (column: string | null) => void;
  sortAscending: boolean;
  setSortAscending: (ascending: boolean) => void;
  
  // Helper functions
  getResourceType: () => string | undefined;
  getNamespace: () => string | undefined;
}

const PaneFilterContext = createContext<PaneFilterState>();

// Default filters for new panes
export const DEFAULT_PANE_FILTERS: ActiveFilter[] = [
  { name: 'ResourceType', value: 'core/Pod' },
  { name: 'Namespace', value: 'all-namespaces' }
];

// Registry to track pane filter states for split operations
const paneFilterRegistry = new Map<number, () => ActiveFilter[]>();

export function registerPaneFilters(paneId: number, getFilters: () => ActiveFilter[]) {
  paneFilterRegistry.set(paneId, getFilters);
}

export function unregisterPaneFilters(paneId: number) {
  paneFilterRegistry.delete(paneId);
}

export function getPaneFilters(paneId: number): ActiveFilter[] {
  const getFilters = paneFilterRegistry.get(paneId);
  return getFilters ? getFilters() : [];
}

export function PaneFilterProvider(props: { 
  paneId: number;
  initialFilters?: ActiveFilter[];
  onStateChange?: (filters: ActiveFilter[]) => void;
  children: JSX.Element;
}) {
  const [activeFilters, setActiveFiltersInternal] = createSignal<ActiveFilter[]>(props.initialFilters || DEFAULT_PANE_FILTERS);
  const [selectedView, setSelectedView] = createSignal<string>('');
  const [filterHistory, setFilterHistory] = createSignal<{ filters: ActiveFilter[]; viewId: string }[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = createSignal<number>(-1);
  const [isNavigating, setIsNavigating] = createSignal<boolean>(false);
  const [sortColumn, setSortColumn] = createSignal<string | null>(null);
  const [sortAscending, setSortAscending] = createSignal<boolean>(true);

  // Register this pane's filter getter in the registry
  onMount(() => {
    registerPaneFilters(props.paneId, () => activeFilters());
  });

  // Clean up registry on unmount
  onCleanup(() => {
    unregisterPaneFilters(props.paneId);
  });

  // Notify parent of state changes
  createEffect(() => {
    const filters = activeFilters();
    props.onStateChange?.(filters);
  });

  // Helper to get resource type from active filters
  const getResourceType = () => {
    return activeFilters().find(f => f.name === "ResourceType")?.value;
  };

  // Helper to get namespace from active filters
  const getNamespace = () => {
    return activeFilters().find(f => f.name === "Namespace")?.value;
  };

  // Add to history when filters change
  const addToHistory = (filters: ActiveFilter[], viewId: string) => {
    if (isNavigating()) return; // Don't add to history when navigating

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
  };

  // Custom setActiveFilters that manages history
  const setActiveFilters = (filters: ActiveFilter[]) => {
    setActiveFiltersInternal(filters);
    addToHistory(filters, selectedView());
  };

  const canGoBack = createMemo(() => currentHistoryIndex() >= 1);
  const canGoForward = createMemo(() => currentHistoryIndex() < filterHistory().length - 1);

  const goBack = () => {
    if (!canGoBack()) return;

    setIsNavigating(true);
    const newIndex = currentHistoryIndex() - 1;
    setCurrentHistoryIndex(newIndex);
    const historyState = filterHistory()[newIndex];
    setActiveFiltersInternal([...historyState.filters]);
    setSelectedView(historyState.viewId);
    setIsNavigating(false);
  };

  const goForward = () => {
    if (!canGoForward()) return;

    setIsNavigating(true);
    const newIndex = currentHistoryIndex() + 1;
    setCurrentHistoryIndex(newIndex);
    const historyState = filterHistory()[newIndex];
    setActiveFiltersInternal([...historyState.filters]);
    setSelectedView(historyState.viewId);
    setIsNavigating(false);
  };

  // Initialize history with initial filters
  onMount(() => {
    addToHistory(activeFilters(), selectedView());
  });

  const store: PaneFilterState = {
    get activeFilters() { return activeFilters(); },
    setActiveFilters,
    get selectedView() { return selectedView(); },
    setSelectedView,
    get filterHistory() { return filterHistory(); },
    get currentHistoryIndex() { return currentHistoryIndex(); },
    get canGoBack() { return canGoBack(); },
    get canGoForward() { return canGoForward(); },
    goBack,
    goForward,
    get sortColumn() { return sortColumn(); },
    setSortColumn,
    get sortAscending() { return sortAscending(); },
    setSortAscending,
    getResourceType,
    getNamespace,
  };

  return (
    <PaneFilterContext.Provider value={store}>
      {props.children}
    </PaneFilterContext.Provider>
  );
}

export function usePaneFilterStore() {
  const context = useContext(PaneFilterContext);
  if (!context) {
    throw new Error("usePaneFilterStore must be used within a PaneFilterProvider");
  }
  return context;
}

