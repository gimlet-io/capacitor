// deno-lint-ignore-file jsx-button-has-type
import { For, createSignal, Show, createEffect, onCleanup, createMemo, onMount } from "solid-js";
import { untrack } from "solid-js";
import { resourceTypeConfigs } from "../../resourceTypeConfigs.tsx";
import { useFilterStore } from "../../store/filterStore.tsx";
import { doesEventMatchShortcut, formatShortcutForDisplay } from "../../utils/shortcuts.ts";

export type FilterOption = {
  label: string;
  value: string;
  color?: string;
};

export type FilterType = "select" | "text";

export type Filter = {
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

export type ActiveFilter = {
  name: string;
  value: string;
};

// Preferred/common Kubernetes kinds used for highlighting when searching Resource Types
const preferredResourceKinds: string[] = [
  "Pod",
  "Deployment",
  "Service",
  "Ingress",
  "ConfigMap",
  "Secret",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "PersistentVolumeClaim",
  "PersistentVolume",
  "Namespace",
  "Node",
  "ReplicaSet",
];

// Determine preferred highlight index among options
const getPreferredHighlightIndex = (filter: Filter, options: FilterOption[]): number => {
  if (!options || options.length === 0) return -1;
  if (filter.name === "ResourceType") {
    const preferredSet = new Set(preferredResourceKinds.map(k => k.toLowerCase()));
    const preferredIndex = options.findIndex(opt => preferredSet.has(opt.label.toLowerCase()));
    if (preferredIndex >= 0) return preferredIndex;
    return 0;
  }
  return 0;
};

// Helper function to check if a search term matches any abbreviations for a resource kind
const matchesAbbreviation = (resourceKind: string, searchTerm: string): boolean => {
  // Find the resource config that matches this kind
  for (const key in resourceTypeConfigs) {
    const parts = key.split('/');
    if (parts.length > 1 && parts[1] === resourceKind) {
      const config = resourceTypeConfigs[key];
      
      if (config.abbreviations && config.abbreviations.length > 0) {
        // Check if any abbreviation matches the search term
        return config.abbreviations.some((abbrev: string) => 
          abbrev.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
      
      break;
    }
  }
  
  return false;
};

export function FilterBar(props: {
  filters: Filter[];
  activeFilters: ActiveFilter[];
  onFilterChange: (filters: ActiveFilter[]) => void;
  initialLoadComplete?: boolean;
  resourceCount?: number;
}) {
  const filterStore = useFilterStore();
  const [spinnerFrame, setSpinnerFrame] = createSignal(0);
  const spinnerFrames = ["|", "/", "-", "\\"];
  let spinnerTimer: number | undefined;
  
  // Update spinner animation
  createEffect(() => {
    if (props.initialLoadComplete === false) {
      spinnerTimer = setInterval(() => {
        setSpinnerFrame((prev) => (prev + 1) % spinnerFrames.length);
      }, 80) as unknown as number;
    } else {
      if (spinnerTimer !== undefined) {
        clearInterval(spinnerTimer);
        spinnerTimer = undefined;
      }
    }
  });
  
  onCleanup(() => {
    if (spinnerTimer !== undefined) {
      clearInterval(spinnerTimer);
    }
  });
  const [activeFilter, setActiveFilter] = createSignal<string | null>(null);
  const [textInputs, setTextInputs] = createSignal<Record<string, string>>({});
  const [pendingTextInputs, setPendingTextInputs] = createSignal<Record<string, string>>({});
  const [optionSearchInputs, setOptionSearchInputs] = createSignal<Record<string, string>>({});
  const [highlightedOptionIndex, setHighlightedOptionIndex] = createSignal<number>(-1);
  const filtersRef = new Map<string, HTMLDivElement>();
  const textInputRefs = new Map<string, HTMLInputElement>();
  const optionSearchInputRefs = new Map<string, HTMLInputElement>();

  const toggleFilter = (filter: string, value: string) => {
    let newFilters: ActiveFilter[] = [...props.activeFilters];
    const existingIndex = newFilters.findIndex(
      (f) => f.name === filter && f.value === value
    );

    const filterDef = props.filters.find(f => f.name === filter);
    
    if (existingIndex >= 0) {
      // Only allow deselection for multi-select filters
      if (filterDef?.multiSelect) {
        // Remove filter if it's already active
        newFilters.splice(existingIndex, 1);
      }
    } else {
      // Add new filter
      if (filterDef && !filterDef.multiSelect) {
        // If not multi-select, remove any existing filters from this filter
        newFilters = newFilters.filter(f => f.name !== filter);
      }
      newFilters.push({ name: filterDef!.name, value });
    }

    props.onFilterChange(newFilters);
  };

  const toggleAllOptions = (filter: string, selectAll: boolean) => {
    const filterDef = props.filters.find(f => f.name === filter);
    if (!filterDef || !filterDef.options) return;
    
    let newFilters = [...props.activeFilters.filter(f => f.name !== filter)];
    
    if (selectAll) {
      // Add all options for this filter
      const allOptions = filterDef.options.map(option => ({
        name: filterDef.name,
        value: option.value
      }));
      newFilters = [...newFilters, ...allOptions];
    }
    
    props.onFilterChange(newFilters);
  };

  // Update pending text input without applying filter
  const updatePendingTextInput = (filter: string, value: string) => {
    setPendingTextInputs(prev => ({ ...prev, [filter]: value }));
  };
  
  // Apply the text filter (used when Enter is pressed or filter is closed)
  const applyTextFilter = (filter: string, value: string) => {
    // Update text input state to match the value being applied
    setTextInputs(prev => ({ ...prev, [filter]: value }));
    
    // If value is empty, remove the filter
    if (!value.trim()) {
      const newFilters = props.activeFilters.filter(f => f.name !== filter);
      props.onFilterChange(newFilters);
      return;
    }
    
    // Update or add the text filter
    const newFilters = [...props.activeFilters];
    const existingIndex = newFilters.findIndex(f => f.name === filter);
    const filterDef = props.filters.find(f => f.name === filter);
    
    if (existingIndex >= 0) {
      // Replace existing filter
      newFilters[existingIndex] = { name: filterDef!.name, value };
    } else {
      // Add new filter
      newFilters.push({ name: filterDef!.name, value });
    }
    
    props.onFilterChange(newFilters);
  };

  const getFilterButtonText = (filter: Filter): string => {
    const filterName = filter.name;
    const activeInFilter = props.activeFilters.filter(f => f.name === filterName);

    if (activeInFilter.length === 0) {
      return `${filter.label}`;
    } else if (filter?.type === "text") {
      return `${filter.label}: ${activeInFilter[0].value}`;
    } else if (activeInFilter.length === 1) {
      const option = filter?.options?.find(o => o.value === activeInFilter[0].value);
      return `${filter.label} is ${option?.label || activeInFilter[0].value}`;
    } else {
      const totalOptions = filter?.options?.length || 0;
      if (activeInFilter.length === totalOptions - 1) {
        const remainingOption = filter?.options?.find(o =>
          !activeInFilter.some(active => active.value === o.value)
        );
        return `${filter.label} is not ${remainingOption?.label || 'selected option'}`;
      }
      return `${filter.label} is any of ${activeInFilter.length} options`;
    }
  };

  // Helper function to focus the appropriate input for a filter
  const focusFilterInput = (filterName: string, retryOnFail = true) => {
    const filter = props.filters.find(f => f.name === filterName);
    if (!filter) return;

    // Use setTimeout to ensure the DOM has updated before focusing
    setTimeout(() => {
      if (filter.type === "text") {
        // Focus the text input for text filters
        const inputRef = textInputRefs.get(filterName);
        if (inputRef) {
          inputRef.focus();
          inputRef.select(); // Also select any existing text for easy replacement
        }
      } else if (filterName === "Namespace" || filter.searchable) {
        // For Namespace filter or any searchable filter
        const searchInputRef = optionSearchInputRefs.get(filterName);
        if (searchInputRef) {
          searchInputRef.focus();
        } else if (retryOnFail) {
          // If we couldn't find the search input immediately, try again after a longer delay
          setTimeout(() => {
            focusFilterInput(filterName, false); // Retry once, but don't keep retrying
          }, 50);
        }
      }
    }, 20); // Small timeout to ensure DOM updates
  };

  // Open specific filter by name
  const openFilter = (filterName: string) => {
    const filter = props.filters.find(f => f.name === filterName);
    if (filter) {
      // Clear any existing search for this filter
      if (filter.type !== 'text' && (filter.searchable || filterName === "Namespace")) {
        setOptionSearchInputs(prev => ({ ...prev, [filterName]: "" }));
      }
      
      // For text filters, initialize the pending text input with current value
      if (filter.type === 'text') {
        const currentValue = textInputs()[filterName] || '';
        setPendingTextInputs(prev => ({ ...prev, [filterName]: currentValue }));
      }
      
      setActiveFilter(filterName);
      
      // Find active filter selection (if any)
      let initialIndex = -1;
      
      if (filter.type !== 'text' && filter.options) {
        // For multi-select, find the first selected option
        // For single-select, find the selected option
        const activeFilterForType = props.activeFilters.find(f => f.name === filterName);
        
        if (activeFilterForType && filter.options) {
          const selectedOptionIndex = filter.options.findIndex(
            option => option.value === activeFilterForType.value
          );
          
          if (selectedOptionIndex >= 0) {
            initialIndex = selectedOptionIndex;
          }
        }

        // If nothing is selected, default highlight behavior
        if (initialIndex < 0) {
          if (!filter.multiSelect) {
            // Default to first option for single-select filters
            const options = getFilteredOptions(filter);
            if (options.length > 0) {
              initialIndex = 0;
            }
          } else {
            // Keep "All" highlighted for multi-select
            initialIndex = -1;
          }
        }
      }
      
      // Set initial highlighted index and schedule scrolling
      setHighlightedOptionIndex(initialIndex);
      
      // Schedule focus and scrolling
      setTimeout(() => {
        focusFilterInput(filterName);
        if (initialIndex >= 0) {
          scrollHighlightedOptionIntoView(filterName);
        }
      }, 50);
    }
  };

  // Global keyboard shortcuts handler
  const handleKeyDown = (e: KeyboardEvent) => {
    // Always allow history navigation regardless of focused element
    if (doesEventMatchShortcut(e, 'mod+arrowleft')) {
      e.preventDefault();
      filterStore.goBack();
      return;
    }
    if (doesEventMatchShortcut(e, 'mod+arrowright')) {
      e.preventDefault();
      filterStore.goForward();
      return;
    }

    // Only handle other shortcuts when user is not typing in inputs
    if (e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    if (e.key === "n" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      openFilter("Namespace");
    } else if (e.key === "r" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      openFilter("ResourceType");
    }
  };

  // Set up click outside handler
  createEffect(() => {
    if (activeFilter()) {
      document.addEventListener('click', handleClickOutside);
    } else {
      document.removeEventListener('click', handleClickOutside);
    }
  });

  // Clean up event listener when component unmounts
  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('keydown', handleKeyDown);
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  // Initialize text input values from active filters
  createEffect(() => {
    const textFilters = props.activeFilters.filter(fl => {
      const filter = props.filters.find(f => f.name === fl.name);
      return filter?.type === "text";
    });
    
    if (textFilters.length > 0) {
      untrack(() => {
        const newTextInputs = { ...textInputs() };
        const newPendingTextInputs = { ...pendingTextInputs() };
        
        textFilters.forEach(filter => {
          newTextInputs[filter.name] = filter.value;
          // Only update pending if not currently being edited
          if (!activeFilter() || activeFilter() !== filter.name) {
            newPendingTextInputs[filter.name] = filter.value;
          }
        });
        
        setTextInputs(newTextInputs);
        setPendingTextInputs(newPendingTextInputs);
      });
    }
  });

  // Clear option search input when filter changes
  createEffect(() => {
    if (activeFilter()) {
      const currentFilter = activeFilter()!;
      untrack(() => {
        // Initialize empty search if needed
        if (!optionSearchInputs()[currentFilter]) {
          setOptionSearchInputs(prev => ({ ...prev, [currentFilter]: "" }));
        }
        
        // Find and set the highlighted index based on active filter selection
        const filter = props.filters.find(f => f.name === currentFilter);
        if (filter && filter.type !== 'text' && filter.options) {
          const activeFilterForType = props.activeFilters.find(f => f.name === currentFilter);
          
          if (activeFilterForType) {
            const options = getFilteredOptions(filter);
            const selectedOptionIndex = options.findIndex(
              option => option.value === activeFilterForType.value
            );
            
            if (selectedOptionIndex >= 0) {
              setHighlightedOptionIndex(selectedOptionIndex);
              // Schedule scrolling after DOM update
              setTimeout(() => scrollHighlightedOptionIntoView(currentFilter), 50);
            }
          }
        }
      });

      // Focus the appropriate input
      focusFilterInput(currentFilter, false); // No retry needed for normal filter changes
    }
  });

  // Watch for changes in option search inputs to highlight single remaining option
  createEffect(() => {
    const currentFilter = activeFilter();
    if (!currentFilter) return;
    
    const filter = props.filters.find(f => f.name === currentFilter);
    if (!filter || filter.type === "text" || !filter.options) return;
    
    const searchTerm = optionSearchInputs()[currentFilter]?.toLowerCase() || "";
    if (!searchTerm) {
      // No search: ensure default highlight is the first item for single-select
      if (!filter.multiSelect) {
        const options = getFilteredOptions(filter);
        if (options.length > 0) {
          setHighlightedOptionIndex(0);
          setTimeout(() => scrollHighlightedOptionIntoView(currentFilter), 0);
        } else {
          setHighlightedOptionIndex(-1);
        }
      } else {
        // Multi-select keeps the "All" option highlight by default
        setHighlightedOptionIndex(-1);
      }
      return;
    }
    
    // Get filtered options using the same logic as rendering (supports abbreviations)
    const filteredOptions = getFilteredOptions(filter);
    
    // Always highlight something when there is a search term
    if (filteredOptions.length >= 1) {
      const index = getPreferredHighlightIndex(filter, filteredOptions);
      setHighlightedOptionIndex(index);
      setTimeout(() => scrollHighlightedOptionIntoView(currentFilter), 0);
    } else {
      setHighlightedOptionIndex(-1);
    }
  });

  const handleFilterInputKeyDown = (event: KeyboardEvent, filter: Filter) => {
    // Stop event propagation to prevent triggering global shortcuts
    event.stopPropagation();

    // Ensure history navigation works even when typing in inputs
    if (doesEventMatchShortcut(event, 'mod+arrowleft')) {
      event.preventDefault();
      filterStore.goBack();
      return;
    }
    if (doesEventMatchShortcut(event, 'mod+arrowright')) {
      event.preventDefault();
      filterStore.goForward();
      return;
    }
    
    if (event.key === "Enter") {
      // For text filters, apply the pending text input value
      if (filter.type === "text") {
        const filterName = filter.name;
        const pendingValue = pendingTextInputs()[filterName] || "";
        applyTextFilter(filterName, pendingValue);
      }
      
      // Close the filter on Enter
      setActiveFilter(null);
    } else if (event.key === "Escape") {
      // For text filters, reset to the last applied value
      if (filter.type === "text") {
        const filterName = filter.name;
        const currentValue = textInputs()[filterName] || "";
        setPendingTextInputs(prev => ({ ...prev, [filterName]: currentValue }));
      }
      
      // Close the filter on Escape without making a selection
      setActiveFilter(null);
    } 
    
    // If this is a text filter, we don't need the navigation logic
    if (filter.type === "text") return;
    
    const filteredOptions = getFilteredOptions(filter);
    const currentHighlight = highlightedOptionIndex();
    
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredOptions.length > 0) {
        // First check if we need to move past the "All" option
        if (filter.multiSelect && currentHighlight === -1) {
          setHighlightedOptionIndex(0);
        } else {
          setHighlightedOptionIndex(prev => 
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
        }
        // Schedule scrolling of the newly highlighted element into view
        setTimeout(() => scrollHighlightedOptionIntoView(filter.name), 0);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredOptions.length > 0) {
        // If we have an "All" option, check if we need to move to it
        if (filter.multiSelect && currentHighlight === 0) {
          setHighlightedOptionIndex(-1);
        } else {
          setHighlightedOptionIndex(prev => prev > 0 ? prev - 1 : prev);
        }
        // Schedule scrolling of the newly highlighted element into view
        setTimeout(() => scrollHighlightedOptionIntoView(filter.name), 0);
      }
    } else if (event.key === "Enter" && currentHighlight >= 0 && currentHighlight < filteredOptions.length) {
      // Select the highlighted option on Enter
      toggleFilter(filter.name, filteredOptions[currentHighlight].value);
    }
  };
  
  // Filter options based on search input
  const getFilteredOptions = (filter: Filter) => {
    if (!filter.options) return [];
    
    const searchTerm = optionSearchInputs()[filter.name]?.toLowerCase() || "";
    if (!searchTerm) return filter.options;
    
    return filter.options.filter(option => {
      // Standard matching by label and value
      const standardMatch = option.label.toLowerCase().includes(searchTerm) || 
                           option.value.toLowerCase().includes(searchTerm);
      
      // For ResourceType filter, also check abbreviations
      if (filter.name === "ResourceType") {
        const abbreviationMatch = matchesAbbreviation(option.label, searchTerm);
        return standardMatch || abbreviationMatch;
      }
      
      return standardMatch;
    });
  };

  // Handle click outside to close filter options
  const handleClickOutside = (event: MouseEvent) => {
    if (!activeFilter()) return;
    
    const activeFilterRef = filtersRef.get(activeFilter()!);
    if (activeFilterRef && !activeFilterRef.contains(event.target as Node)) {
      // If there's an active text filter, apply its pending value
      const currentFilter = activeFilter();
      const filter = props.filters.find(f => f.name === currentFilter);
      
      if (filter && filter.type === "text") {
        const pendingValue = pendingTextInputs()[filter.name] || "";
        applyTextFilter(filter.name, pendingValue);
      }
      
      setActiveFilter(null);
    }
  };

  // Helper function to scroll the highlighted option into view
  const scrollHighlightedOptionIntoView = (filterName: string) => {
    const filterRef = filtersRef.get(filterName);
    if (!filterRef) return;
    
    const highlightIndex = highlightedOptionIndex();
    
    // Select the appropriate element to scroll to
    let elementToScroll: HTMLElement | null = null;
    
    if (highlightIndex === -1) {
      // This is the "All" option
      elementToScroll = filterRef.querySelector('.filter-option.all-option') as HTMLElement;
    } else {
      // This is a regular option
      const options = Array.from(
        filterRef.querySelectorAll('.filter-options-scroll-container .filter-option:not(.all-option)')
      ) as HTMLElement[];
      
      if (options.length > highlightIndex) {
        elementToScroll = options[highlightIndex];
      }
    }
    
    if (elementToScroll) {
      // Get the parent scrollable container
      const optionsContainer = filterRef.querySelector('.filter-options-scroll-container') as HTMLElement;
      if (!optionsContainer) return;
      
      // Calculate whether the element is in view
      const containerRect = optionsContainer.getBoundingClientRect();
      const elementRect = elementToScroll.getBoundingClientRect();
      
      // Check if element is not fully visible
      if (elementRect.top < containerRect.top || 
          elementRect.bottom > containerRect.bottom) {
        elementToScroll.scrollIntoView({
          block: 'nearest',
          behavior: 'instant'
        });
      }
    }
  };

  return (
    <div class="filter-bar">
      <div class="filter-groups">
        <For each={props.filters}>
          {(filter) => {
            const hasActiveFilters = createMemo(() => 
              props.activeFilters.some(f => f.name === filter.name)
            );
            
            const allOptionsSelected = createMemo(() => {
              if (!filter.options || !filter.multiSelect) return false;
              // Check if all regular options (not the "All" option) are selected
              return filter.options.every(option => 
                props.activeFilters.some(f => 
                  f.name === filter.name && f.value === option.value
                )
              );
            });
            
            return (
              <div 
                class="filter-group" 
                ref={el => filtersRef.set(filter.name, el)}
              >
                <button 
                  classList={{ 
                    "filter-group-button": true, 
                    "has-active-filters": hasActiveFilters() 
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveFilter(current => current === filter.name ? null : filter.name);
                  }}
                >
                  {getFilterButtonText(filter)}
                  {filter.name === "Namespace" && (
                    <span class="shortcut-key">n</span>
                  )}
                  {filter.name === "ResourceType" && (
                    <span class="shortcut-key">r</span>
                  )}
                </button>
                <Show when={activeFilter() === filter.name}>
                  <div class="filter-options">
                    {/* Text input filter */}
                    <Show when={filter.type === "text"}>
                      <div class="filter-options-search-container">
                        <div class="filter-text-input">
                          <input
                            type="text"
                            placeholder={filter.placeholder || `Filter by ${filter.name.toLowerCase()}`}
                            value={pendingTextInputs()[filter.name] || ""}
                            onInput={(e) => updatePendingTextInput(filter.name, e.currentTarget.value)}
                            ref={el => textInputRefs.set(filter.name, el)}
                            onKeyDown={(e) => handleFilterInputKeyDown(e, filter)}
                          />
                        </div>
                      </div>
                    </Show>
                    
                    {/* Select options filter */}
                    <Show when={filter.type !== "text" && filter.options}>
                      {/* Search input for options */}
                      <Show when={filter.searchable || filter.name === "Namespace"}>
                        <div class="filter-options-search-container">
                          <div class="option-search-input filter-text-input">
                            <input
                              type="text"
                              placeholder={`Search ${filter.name.toLowerCase()}...`}
                              value={optionSearchInputs()[filter.name] || ""}
                              onInput={(e) => {
                                setOptionSearchInputs(prev => ({ ...prev, [filter.name]: e.currentTarget.value }));
                                // Reset highlight handled by effect to set sensible default
                              }}
                              ref={el => optionSearchInputRefs.set(filter.name, el)}
                              onKeyDown={(e) => handleFilterInputKeyDown(e, filter)}
                            />
                          </div>
                        </div>
                      </Show>
                      
                      <div class="filter-options-scroll-container">
                        {/* "All" option for multiselect filters */}
                        <Show when={filter.multiSelect}>
                          <button 
                            class="filter-option all-option"
                            classList={{
                              "active": allOptionsSelected(),
                              "highlighted": highlightedOptionIndex() === -1
                            }}
                            onClick={() => toggleAllOptions(filter.name, !allOptionsSelected())}
                          >
                            <span class="checkbox">
                              {allOptionsSelected() ? '✓' : ''}
                            </span>
                            All
                          </button>
                        </Show>
                        
                        <For each={getFilteredOptions(filter)}>
                          {(option, index) => {
                            const isActive = createMemo(() => 
                              props.activeFilters.some(f => 
                                f.name === filter.name && f.value === option.value
                              )
                            );
                            
                            const isHighlighted = createMemo(() => 
                              highlightedOptionIndex() === index()
                            );
                            
                            // Check if this is a non-deselectable option (single select with active selection)
                            const isNonDeselectable = createMemo(() => 
                              !filter.multiSelect && isActive()
                            );
                            
                            return (
                              <button 
                                classList={{
                                  "filter-option": true,
                                  "active": isActive(),
                                  "highlighted": isHighlighted(),
                                  "non-deselectable": isNonDeselectable()
                                }}
                                style={option.color ? `border-color: ${option.color}` : ''}
                                onClick={() => {
                                  // Only allow toggling if it's multiselect or not currently active
                                  if (filter.multiSelect || !isActive()) {
                                    toggleFilter(filter.name, option.value);
                                  }
                                }}
                              >
                                <span class="checkbox">
                                  {isActive() ? '✓' : ''}
                                </span>
                                {filter.renderOption ? filter.renderOption(option) : option.label}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
        
        {/* Loading indicator with ANSI spinner */}
        <Show when={props.initialLoadComplete !== undefined}>
          <div class="filter-loading-indicator">
            <Show when={props.initialLoadComplete === false}>
              <span class="filter-spinner-text">
                [{spinnerFrames[spinnerFrame()]}] ({props.resourceCount || 0})
              </span>
            </Show>
            <Show when={props.initialLoadComplete === true && (props.resourceCount || 0) > 0}>
              <span class="filter-resource-count">
                {props.resourceCount} resources
              </span>
            </Show>
          </div>
        </Show>
      </div>
      
      {/* Filter history navigation */}
      <div class="filter-history-nav">
        <div class="filter-group">
          <button 
            class="filter-group-button"
            classList={{ "has-active-filters": false, "disabled": !filterStore.canGoBack }}
            onClick={() => filterStore.goBack()}
            disabled={!filterStore.canGoBack}
            title="Go back in filter history"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="shortcut-key">{formatShortcutForDisplay('Mod+←')}</span>
          </button>
        </div>
        <div class="filter-group">
          <button 
            class="filter-group-button"
            classList={{ "has-active-filters": false, "disabled": !filterStore.canGoForward }}
            onClick={() => filterStore.goForward()}
            disabled={!filterStore.canGoForward}
            title="Go forward in filter history"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="shortcut-key">{formatShortcutForDisplay('Mod+→')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
