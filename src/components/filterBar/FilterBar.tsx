// deno-lint-ignore-file jsx-button-has-type
import { For, createSignal, Show, createEffect, onCleanup, createMemo } from "solid-js";
import { untrack } from "solid-js";
export type FilterOption = {
  label: string;
  value: string;
  color?: string;
};

export type FilterType = "select" | "text";

export type Filter = {
  name: string;
  type?: FilterType;
  options?: FilterOption[];
  multiSelect?: boolean;
  placeholder?: string;
  filterFunction: (resource: any, value: string) => boolean;
};

export type ActiveFilter = {
  filter: Filter;
  value: string;
};

export function FilterBar(props: {
  filters: Filter[];
  activeFilters: ActiveFilter[];
  onFilterChange: (filters: ActiveFilter[]) => void;
}) {
  const [activeFilter, setActiveFilter] = createSignal<string | null>(null);
  const [textInputs, setTextInputs] = createSignal<Record<string, string>>({});
  const filtersRef = new Map<string, HTMLDivElement>();
  const textInputRefs = new Map<string, HTMLInputElement>();

  const toggleFilter = (filter: string, value: string) => {
    let newFilters: ActiveFilter[] = [...props.activeFilters];
    const existingIndex = newFilters.findIndex(
      (f) => f.filter.name === filter && f.value === value
    );

    const filterDef = props.filters.find(f => f.name === filter);
    
    if (existingIndex >= 0) {
      // Remove filter if it's already active
      newFilters.splice(existingIndex, 1);
    } else {
      // Add new filter
      if (filterDef && !filterDef.multiSelect) {
        // If not multi-select, remove any existing filters from this filter
        newFilters = newFilters.filter(f => f.filter.name !== filter);
      }
      newFilters.push({ filter: filterDef!, value });
    }

    props.onFilterChange(newFilters);
  };

  const toggleAllOptions = (filter: string, selectAll: boolean) => {
    const filterDef = props.filters.find(f => f.name === filter);
    if (!filterDef || !filterDef.options) return;
    
    let newFilters = [...props.activeFilters.filter(f => f.filter.name !== filter)];
    
    if (selectAll) {
      // Add all options for this filter
      const allOptions = filterDef.options.map(option => ({
        filter: filterDef,
        value: option.value
      }));
      newFilters = [...newFilters, ...allOptions];
    }
    
    props.onFilterChange(newFilters);
  };

  const applyTextFilter = (filter: string, value: string) => {
    // Update text input state
    setTextInputs(prev => ({ ...prev, [filter]: value }));
    
    // If value is empty, remove the filter
    if (!value.trim()) {
      const newFilters = props.activeFilters.filter(f => f.filter.name !== filter);
      props.onFilterChange(newFilters);
      return;
    }
    
    // Update or add the text filter
    const newFilters = [...props.activeFilters];
    const existingIndex = newFilters.findIndex(f => f.filter.name === filter);
    const filterDef = props.filters.find(f => f.name === filter);
    if (existingIndex >= 0) {
      // Replace existing filter
      newFilters[existingIndex] = { filter: filterDef!, value };
    } else {
      // Add new filter
      newFilters.push({ filter: filterDef!, value });
    }
    
    props.onFilterChange(newFilters);
  };

  const getFilterButtonText = (filterName: string): string => {
    const filter = props.filters.find(f => f.name === filterName);
    const activeInFilter = props.activeFilters.filter(f => f.filter.name === filterName);
    
    if (activeInFilter.length === 0) {
      return `${filterName}`;
    } else if (filter?.type === "text") {
      return `${filterName}: ${activeInFilter[0].value}`;
    } else if (activeInFilter.length === 1) {
      const option = filter?.options?.find(o => o.value === activeInFilter[0].value);
      return `${filterName} is ${option?.label || activeInFilter[0].value}`;
    } else {
      const totalOptions = filter?.options?.length || 0;
      if (activeInFilter.length === totalOptions - 1) {
        const remainingOption = filter?.options?.find(o =>
          !activeInFilter.some(active => active.value === o.value)
        );
        return `${filterName} is not ${remainingOption?.label || 'selected option'}`;
      }
      return `${filterName} is any of ${activeInFilter.length} options`;
    }
  };

  // Handle click outside to close filter options
  const handleClickOutside = (event: MouseEvent) => {
    if (!activeFilter()) return;
    
    const activeFilterRef = filtersRef.get(activeFilter()!);
    if (activeFilterRef && !activeFilterRef.contains(event.target as Node)) {
      setActiveFilter(null);
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
  });

  // Initialize text input values from active filters
  createEffect(() => {
    const textFilters = props.activeFilters.filter(fl => {
      const filter = props.filters.find(f => f.name === fl.filter.name);
      return filter?.type === "text";
    });
    
    if (textFilters.length > 0) {
      untrack(() => {
        const newTextInputs = { ...textInputs() };
        textFilters.forEach(filter => {
          newTextInputs[filter.filter.name] = filter.value;
        });
        setTextInputs(newTextInputs);
      });
    }
  });

  // Focus and select text input when the filter is opened
  createEffect(() => {
    if (activeFilter()) {
      const inputRef = textInputRefs.get(activeFilter()!);
      if (inputRef) {
        inputRef.focus();
        inputRef.select();
      }
    }
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Escape") {
      // Close the filter on Enter or Escape
      setActiveFilter(null);
    }
  };

  return (
    <div class="filter-bar">
      <div class="filter-groups">
        <For each={props.filters}>
          {(filter) => {
            const hasActiveFilters = createMemo(() => 
              props.activeFilters.some(f => f.filter.name === filter.name)
            );
            
            const allOptionsSelected = createMemo(() => {
              if (!filter.options || !filter.multiSelect) return false;
              // Check if all regular options (not the "All" option) are selected
              return filter.options.every(option => 
                props.activeFilters.some(f => 
                  f.filter.name === filter.name && f.value === option.value
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
                  {getFilterButtonText(filter.name)}
                </button>
                <Show when={activeFilter() === filter.name}>
                  <div class="filter-options">
                    {/* Text input filter */}
                    <Show when={filter.type === "text"}>
                      <div class="filter-text-input">
                        <input
                          type="text"
                          placeholder={filter.placeholder || `Filter by ${filter.name.toLowerCase()}`}
                          value={textInputs()[filter.name] || ""}
                          onInput={(e) => applyTextFilter(filter.name, e.currentTarget.value)}
                          ref={el => textInputRefs.set(filter.name, el)}
                          onKeyDown={handleKeyDown}
                        />
                      </div>
                    </Show>
                    
                    {/* Select options filter */}
                    <Show when={filter.type !== "text" && filter.options}>
                      {/* "All" option for multiselect filters */}
                      <Show when={filter.multiSelect}>
                        <button 
                          class="filter-option all-option"
                          classList={{
                            "active": allOptionsSelected()
                          }}
                          onClick={() => toggleAllOptions(filter.name, !allOptionsSelected())}
                        >
                          <span class="checkbox">
                            {allOptionsSelected() ? '✓' : ''}
                          </span>
                          All
                        </button>
                      </Show>
                      
                      <For each={filter.options}>
                        {(option) => {
                          const isActive = createMemo(() => 
                            props.activeFilters.some(f => 
                              f.filter.name === filter.name && f.value === option.value
                            )
                          );
                          
                          return (
                            <button 
                              classList={{
                                "filter-option": true,
                                "active": isActive()
                              }}
                              style={option.color ? `border-color: ${option.color}` : ''}
                              onClick={() => toggleFilter(filter.name, option.value)}
                            >
                              <span class="checkbox">
                                {isActive() ? '✓' : ''}
                              </span>
                              {option.label}
                            </button>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
