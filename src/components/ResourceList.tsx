import { For, createSignal, onMount, onCleanup, createEffect, JSX, createMemo } from "solid-js";
import { FilterBar, Filter, ActiveFilter } from "./FilterBar.tsx";

// Generic Resource type with required metadata properties
type Resource = {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

// Column definition
type Column<T> = {
  header: string;
  width: string;
  accessor: (item: T) => JSX.Element;
  title?: (item: T) => string;
};

// Detail row renderer type
type DetailRowRenderer<T> = (item: T) => JSX.Element;

// Filter function type
type FilterFunction<T> = (resource: T, activeFilters: ActiveFilter[]) => boolean;

// Common name filter group
const nameFilter: Filter = {
  name: "Name",
  type: "text",
  placeholder: "Filter by name"
};

// Common filter function to check name
const filterName = <T extends Resource>(resource: T, filter: ActiveFilter): boolean => {
  if (filter.filter !== "Name") return true;
  return resource.metadata.name.toLowerCase().includes(filter.value.toLowerCase());
};

export function ResourceList<T extends Resource>(props: { 
  resources: T[];
  columns: Column<T>[];
  noSelectClass?: boolean;
  onItemClick?: (item: T) => void;
  detailRowRenderer?: DetailRowRenderer<T>;
  rowKeyField?: string; // String key for resource.metadata
  filters?: Filter[];
  filterFunction?: FilterFunction<T>;
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);

  // Add name filter to the filters
  const allFilters = createMemo(() => {
    return [nameFilter, ...(props.filters || [])];
  });

  // Enhanced filter function that also handles name filter
  const applyFilters = (resource: T, filters: ActiveFilter[]): boolean => {
    // Check name filter first
    const nameFilters = filters.filter(f => f.filter === "Name");
    if (nameFilters.length > 0 && !nameFilters.every(f => filterName(resource, f))) {
      return false;
    }
    
    // If there's a custom filter function, apply it for other filters
    if (props.filterFunction) {
      const otherFilters = filters.filter(f => f.filter !== "Name");
      if (otherFilters.length > 0) {
        return props.filterFunction(resource, otherFilters);
      }
    }
    
    return true;
  };

  const filteredResources = createMemo(() => {
    if (activeFilters().length === 0) {
      return props.resources;
    }
    return props.resources.filter(resource => applyFilters(resource, activeFilters()));
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const resources = filteredResources();
    if (resources.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, resources.length - 1);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 1, 0);
        return newIndex;
      });
    } else if (e.key === 'Enter' && props.onItemClick) {
      const index = selectedIndex();
      if (index !== -1 && index < resources.length) {
        props.onItemClick(resources[index]);
      }
    }
  };

  // Reset selectedIndex when filtered results change
  createEffect(() => {
    if (filteredResources().length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex() >= filteredResources().length) {
      setSelectedIndex(filteredResources().length - 1);
    }
  });

  // Scroll selected item into view whenever selectedIndex changes
  createEffect(() => {
    const index = selectedIndex();
    if (index === -1) return;
    
    // Use requestAnimationFrame to ensure the DOM is updated before scrolling
    requestAnimationFrame(() => {
      const container = listContainer();
      if (!container) return;
      
      // If we have detail rows, we need to select the main row
      let rows: NodeListOf<HTMLTableRowElement>;
      if (props.detailRowRenderer) {
        rows = container.querySelectorAll('tbody tr:nth-child(odd)');
      } else {
        rows = container.querySelectorAll('tbody tr');
      }
      
      if (index >= 0 && index < rows.length) {
        const selectedRow = rows[index];
        
        // Calculate if element is in view
        const containerRect = container.getBoundingClientRect();
        const rowRect = selectedRow.getBoundingClientRect();
        
        // Check if the element is not fully visible
        if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
          // Use scrollIntoView with block: 'center' for better positioning
          selectedRow.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      }
    });
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class={`resource-list-container ${props.noSelectClass ? 'no-select' : ''}`}>
      <FilterBar 
        filters={allFilters()} 
        activeFilters={activeFilters()} 
        onFilterChange={setActiveFilters} 
      />
      
      <div ref={setListContainer} class="resource-table-wrapper">
        <table class="resource-table">
          <thead>
            <tr>
              {props.columns.map(column => (
                <th style={`width: ${column.width}`}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <For each={filteredResources()}>
              {(resource, index) => {
                const handleClick = () => {
                  if (props.onItemClick) {
                    props.onItemClick(resource);
                  }
                };
                
                return (
                  <>
                    <tr 
                      class={selectedIndex() === index() ? 'selected' : ''} 
                      onClick={handleClick}
                    >
                      {props.columns.map(column => (
                        <td title={column.title ? column.title(resource) : undefined}>
                          {column.accessor(resource)}
                        </td>
                      ))}
                    </tr>
                    {props.detailRowRenderer && (
                      <tr class={selectedIndex() === index() ? 'selected' : ''}>
                        {props.detailRowRenderer(resource)}
                      </tr>
                    )}
                  </>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
} 