import { For, createSignal, onMount, onCleanup, createEffect, JSX, createMemo } from "solid-js";
import { ActiveFilter } from "../filterBar/FilterBar.tsx";
import { ResourceDrawer } from "../resourceDetail/ResourceDrawer.tsx";

type Column<T> = {
  header: string;
  width: string;
  accessor: (item: T) => JSX.Element;
  title?: (item: T) => string;
};

type DetailRowRenderer<T> = (item: T) => JSX.Element;

export function ResourceList<T>(props: { 
  resources: T[];
  columns: Column<T>[];
  noSelectClass?: boolean;
  onItemClick?: (item: T) => void;
  detailRowRenderer?: DetailRowRenderer<T>;
  rowKeyField?: string; // String key for resource.metadata
  activeFilters: ActiveFilter[];
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [selectedResource, setSelectedResource] = createSignal<T | null>(null);
  const [activeTab, setActiveTab] = createSignal<"describe" | "yaml" | "events" | "logs">("describe");

  const filteredResources = createMemo(() => {
    if (props.activeFilters.length === 0) {
      return props.resources;
    }
    return props.resources.filter(resource => props.activeFilters.some(filter => filter.filter.filterFunction(resource, filter.value)));
  });

  const openDrawer = (tab: "describe" | "yaml" | "events" | "logs", resource: T) => {
    setSelectedResource(() => resource);
    setActiveTab(tab);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

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
    } else if (e.key === 'd') {
      const index = selectedIndex();
      if (index !== -1 && index < resources.length) {
        openDrawer("describe", resources[index]);
      }
    } else if (e.key === 'y') {
      const index = selectedIndex();
      if (index !== -1 && index < resources.length) {
        openDrawer("yaml", resources[index]);
      }
    } else if (e.key === 'e') {
      const index = selectedIndex();
      if (index !== -1 && index < resources.length) {
        openDrawer("events", resources[index]);
      }
    } else if (e.key === 'l') {
      const index = selectedIndex();
      if (index !== -1 && index < resources.length) {
        openDrawer("logs", resources[index]);
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
                  setSelectedIndex(index());
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
      
      <ResourceDrawer
        resource={selectedResource()}
        isOpen={drawerOpen()}
        onClose={closeDrawer}
        initialTab={activeTab()}
      />
    </div>
  );
} 