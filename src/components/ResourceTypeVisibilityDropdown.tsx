import { createSignal, createEffect, For, Show, Accessor } from "solid-js";

interface ResourceTypeVisibilityDropdownProps {
  resourceTypes: string[];
  visibleResourceTypes: Accessor<Set<string>>;
  toggleResourceTypeVisibility: (resourceType: string) => void;
  setAllResourceTypesVisibility: (isVisible: boolean) => void;
}

export function ResourceTypeVisibilityDropdown(props: ResourceTypeVisibilityDropdownProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchTerm, setSearchTerm] = createSignal("");
  
  // Get sorted resource types
  const sortedResourceTypes = () => {
    return [...props.resourceTypes].sort((a, b) => {
      // Sort by kind (second part after the slash)
      const kindA = a.split('/')[1] || '';
      const kindB = b.split('/')[1] || '';
      return kindA.localeCompare(kindB);
    });
  };
  
  // Filter resource types based on search term
  const filteredResourceTypes = () => {
    const sorted = sortedResourceTypes();

    if (!searchTerm()) {
      return sorted;
    }
    
    const term = searchTerm().toLowerCase();
    
    return sorted.filter(type => {
      const [group, kind] = type.split('/');
      return kind.toLowerCase().includes(term) || group.toLowerCase().includes(term);
    });
  };
  
  // Handle click outside to close dropdown
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (isOpen() && !target.closest('.resource-type-visibility-dropdown')) {
      setIsOpen(false);
    }
  };
  
  // Set up event listener for click outside
  createEffect(() => {
    if (isOpen()) {
      document.addEventListener('click', handleClickOutside);
    } else {
      document.removeEventListener('click', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });

  // Check if a resource type is visible
  const isResourceTypeVisible = (resourceType: string): boolean => {
    const visibleTypes = props.visibleResourceTypes();
    return visibleTypes.has(resourceType);
  };
  
  // Toggle visibility for a specific resource type
  const toggleVisibility = (resourceType: string, event: Event) => {
    event.stopPropagation();
    props.toggleResourceTypeVisibility(resourceType);
  };
  
  // Count visible resource types
  const visibleCount = () => {
    let count = 0;
    const visibleTypes = props.visibleResourceTypes();
    props.resourceTypes.forEach(type => {
      if (visibleTypes.has(type)) {
        count++;
      }
    });
    return count;
  };
  
  return (
    <div class="resource-type-visibility-dropdown">
      <button 
        style="width: 100%"
        class="filter-group-button" 
        onClick={() => setIsOpen(!isOpen())}
        title="Configure which resource types are shown in the tree"
      >
        <span>Visible Types: {visibleCount() === props.resourceTypes.length ? 'All' : visibleCount()}</span>
        <span class="shortcut-key">▼</span>
      </button>
      
      <Show when={isOpen()}>
        <div class="filter-options">
          <div class="filter-options-search-container">
            <input
              type="text"
              placeholder="Search resource types..."
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.target.value)}
              class="filter-text-input"
            />
          </div>
          
          <div class="filter-options-scroll-container">
            <div class="filter-option">
              <label>
                <input
                  type="checkbox"
                  checked={visibleCount() === props.resourceTypes.length}
                  ref={(el) => setIndeterminate(el, props.visibleResourceTypes().size > 0 && visibleCount() < props.resourceTypes.length)}
                  onChange={(e) => {
                    const shouldCheck = visibleCount() < props.resourceTypes.length;
                    props.setAllResourceTypesVisibility(shouldCheck);
                  }}
                />
                <span>All Resource Types</span>
              </label>
            </div>
            
            <For each={filteredResourceTypes()}>
              {(resourceType) => {
                const [group, kind] = resourceType.split('/');
                return (
                  <div class="filter-option">
                    <label>
                      <input
                        type="checkbox"
                        checked={isResourceTypeVisible(resourceType)}
                        onChange={(e) => toggleVisibility(resourceType, e)}
                      />
                      <span>{kind} <span style="color: var(--linear-text-tertiary); font-size: 11px;">({group})</span></span>
                    </label>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

// Handle indeterminate state for checkboxes
const setIndeterminate = (el: HTMLInputElement, indeterminate: boolean) => {
  if (el) {
    el.indeterminate = indeterminate;
  }
}; 