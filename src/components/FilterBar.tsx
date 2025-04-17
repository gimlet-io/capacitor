import { For, createSignal, Show, JSX, createEffect, onCleanup, createMemo } from "solid-js";

export type FilterOption = {
  label: string;
  value: string;
  color?: string;
};

export type FilterGroup = {
  name: string;
  options: FilterOption[];
  multiSelect?: boolean;
};

export type ActiveFilter = {
  group: string;
  value: string;
};

export function FilterBar(props: {
  filterGroups: FilterGroup[];
  activeFilters: ActiveFilter[];
  onFilterChange: (filters: ActiveFilter[]) => void;
}) {
  const [activeGroup, setActiveGroup] = createSignal<string | null>(null);
  const filterGroupsRef = new Map<string, HTMLDivElement>();

  const toggleFilter = (group: string, value: string) => {
    let newFilters: ActiveFilter[] = [...props.activeFilters];
    const existingIndex = newFilters.findIndex(
      (f) => f.group === group && f.value === value
    );

    const groupDef = props.filterGroups.find(g => g.name === group);
    
    if (existingIndex >= 0) {
      // Remove filter if it's already active
      newFilters.splice(existingIndex, 1);
    } else {
      // Add new filter
      if (groupDef && !groupDef.multiSelect) {
        // If not multi-select, remove any existing filters from this group
        newFilters = newFilters.filter(f => f.group !== group);
      }
      newFilters.push({ group, value });
    }

    props.onFilterChange(newFilters);
  };

  const removeFilter = (index: number) => {
    const newFilters = [...props.activeFilters];
    newFilters.splice(index, 1);
    props.onFilterChange(newFilters);
  };

  const getFilterLabel = (filter: ActiveFilter): string => {
    const group = props.filterGroups.find((g) => g.name === filter.group);
    if (!group) return `${filter.group}: ${filter.value}`;
    
    const option = group.options.find((o) => o.value === filter.value);
    if (!option) return `${filter.group}: ${filter.value}`;
    
    return `${filter.group}: ${option.label}`;
  };

  const getFilterColor = (filter: ActiveFilter): string => {
    const group = props.filterGroups.find((g) => g.name === filter.group);
    if (!group) return "var(--linear-border)";
    
    const option = group.options.find((o) => o.value === filter.value);
    return option?.color || "var(--linear-border)";
  };

  const getGroupButtonText = (groupName: string): string => {
    const activeInGroup = props.activeFilters.filter(f => f.group === groupName);
    
    if (activeInGroup.length === 0) {
      return `${groupName}`;
    } else if (activeInGroup.length === 1) {
      const option = props.filterGroups
        .find(g => g.name === groupName)?.options
        .find(o => o.value === activeInGroup[0].value);
      
      return `${groupName} is ${option?.label || activeInGroup[0].value}`;
    } else {
      return `${groupName} is any of ${activeInGroup.length} options`;
    }
  };

  // Handle click outside to close filter options
  const handleClickOutside = (event: MouseEvent) => {
    if (!activeGroup()) return;
    
    const activeGroupRef = filterGroupsRef.get(activeGroup()!);
    if (activeGroupRef && !activeGroupRef.contains(event.target as Node)) {
      setActiveGroup(null);
    }
  };

  // Set up click outside handler
  createEffect(() => {
    if (activeGroup()) {
      document.addEventListener('click', handleClickOutside);
    } else {
      document.removeEventListener('click', handleClickOutside);
    }
  });

  // Clean up event listener when component unmounts
  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside);
  });

  return (
    <div class="filter-bar">
      <div class="filter-groups">
        <For each={props.filterGroups}>
          {(group) => {
            const hasActiveFilters = createMemo(() => 
              props.activeFilters.some(f => f.group === group.name)
            );
            
            return (
              <div 
                class="filter-group" 
                ref={el => filterGroupsRef.set(group.name, el)}
              >
                <button 
                  classList={{ 
                    "filter-group-button": true, 
                    "has-active-filters": hasActiveFilters() 
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveGroup(current => current === group.name ? null : group.name);
                  }}
                >
                  {getGroupButtonText(group.name)}
                </button>
                <Show when={activeGroup() === group.name}>
                  <div class="filter-options">
                    <For each={group.options}>
                      {(option) => {
                        const isActive = createMemo(() => 
                          props.activeFilters.some(f => 
                            f.group === group.name && f.value === option.value
                          )
                        );
                        
                        return (
                          <button 
                            classList={{
                              "filter-option": true,
                              "active": isActive()
                            }}
                            style={option.color ? `border-color: ${option.color}` : ''}
                            onClick={() => toggleFilter(group.name, option.value)}
                          >
                            <span class="checkbox">
                              {isActive() ? '✓' : ''}
                            </span>
                            {option.label}
                          </button>
                        );
                      }}
                    </For>
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