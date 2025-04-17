import { For, createSignal, Show, JSX, createEffect, onCleanup, createMemo } from "solid-js";

export type FilterOption = {
  label: string;
  value: string;
  color?: string;
};

export type FilterGroupType = "select" | "text";

export type FilterGroup = {
  name: string;
  type?: FilterGroupType;
  options?: FilterOption[];
  multiSelect?: boolean;
  placeholder?: string;
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
  const [textInputs, setTextInputs] = createSignal<Record<string, string>>({});
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

  const applyTextFilter = (group: string, value: string) => {
    // Update text input state
    setTextInputs(prev => ({ ...prev, [group]: value }));
    
    // If value is empty, remove the filter
    if (!value.trim()) {
      const newFilters = props.activeFilters.filter(f => f.group !== group);
      props.onFilterChange(newFilters);
      return;
    }
    
    // Update or add the text filter
    let newFilters = [...props.activeFilters];
    const existingIndex = newFilters.findIndex(f => f.group === group);
    
    if (existingIndex >= 0) {
      // Replace existing filter
      newFilters[existingIndex] = { group, value };
    } else {
      // Add new filter
      newFilters.push({ group, value });
    }
    
    props.onFilterChange(newFilters);
  };

  const getGroupButtonText = (groupName: string): string => {
    const group = props.filterGroups.find(g => g.name === groupName);
    const activeInGroup = props.activeFilters.filter(f => f.group === groupName);
    
    if (activeInGroup.length === 0) {
      return `${groupName}`;
    } else if (group?.type === "text") {
      return `${groupName}: ${activeInGroup[0].value}`;
    } else if (activeInGroup.length === 1) {
      const option = group?.options?.find(o => o.value === activeInGroup[0].value);
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

  // Initialize text input values from active filters
  createEffect(() => {
    const textFilters = props.activeFilters.filter(f => {
      const group = props.filterGroups.find(g => g.name === f.group);
      return group?.type === "text";
    });
    
    if (textFilters.length > 0) {
      const newTextInputs = { ...textInputs() };
      textFilters.forEach(filter => {
        newTextInputs[filter.group] = filter.value;
      });
      setTextInputs(newTextInputs);
    }
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
                    {/* Text input filter */}
                    <Show when={group.type === "text"}>
                      <div class="filter-text-input">
                        <input
                          type="text"
                          placeholder={group.placeholder || `Filter by ${group.name.toLowerCase()}`}
                          value={textInputs()[group.name] || ""}
                          onInput={(e) => applyTextFilter(group.name, e.currentTarget.value)}
                        />
                      </div>
                    </Show>
                    
                    {/* Select options filter */}
                    <Show when={group.type !== "text" && group.options}>
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