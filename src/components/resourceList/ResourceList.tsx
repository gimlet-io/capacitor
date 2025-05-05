import { For, createSignal, onMount, onCleanup, createEffect, JSX, createMemo } from "solid-js";
import { ActiveFilter } from "../filterBar/FilterBar.tsx";
import { ResourceDrawer } from "../resourceDetail/ResourceDrawer.tsx";
import { KeyboardShortcuts, getResourceShortcuts } from "../keyboardShortcuts/KeyboardShortcuts.tsx";

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

  const deleteResource = async () => {
    const index = selectedIndex();
    console.log(index);
    
    if (index !== -1 && index < filteredResources().length) {
      const resource = filteredResources()[index] as any;
      if (!resource || !resource.metadata) return;
      
      const resourceName = resource.metadata.name;
      const resourceKind = resource.kind;
      
      // Show browser's native confirmation dialog
      const confirmed = window.confirm(`Are you sure you want to delete ${resourceKind} "${resourceName}"?`);
      
      if (!confirmed) return;
      
      try {
        // Determine API path based on resource kind and group
        const group = resource.apiVersion?.includes('/') 
          ? resource.apiVersion.split('/')[0] 
          : '';
        const version = resource.apiVersion?.includes('/') 
          ? resource.apiVersion.split('/')[1] 
          : resource.apiVersion || 'v1';
        
        let apiPath = '';
        if (!group || group === 'core') {
          apiPath = `/k8s/api/${version}`;
        } else {
          apiPath = `/k8s/apis/${group}/${version}`;
        }
        
        // Build the full delete URL
        let deleteUrl = '';
        if (resource.metadata.namespace) {
          deleteUrl = `${apiPath}/namespaces/${resource.metadata.namespace}/${resource.kind.toLowerCase()}s/${resource.metadata.name}`;
        } else {
          deleteUrl = `${apiPath}/${resource.kind.toLowerCase()}s/${resource.metadata.name}`;
        }
        
        // Send delete request
        const response = await fetch(deleteUrl, {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to delete resource: ${response.statusText}`);
        }
        
        // Resource will be removed from the UI when the watch detects the DELETE event
      } catch (error) {
        console.error('Error deleting resource:', error);
        // Show error in an alert
        window.alert(`Error deleting resource: ${error}`);
      }
    }
  };

  const shouldIgnoreKeyboardEvents = () => {
    // Ignore keyboard events when:
    // 1. Any input element is focused
    // 2. Any .filter-options element is visible in the DOM
    if (document.activeElement instanceof HTMLInputElement || 
        document.activeElement instanceof HTMLTextAreaElement) {
      return true;
    }
    
    // Check if any filter dropdown is open
    const openFilterOptions = document.querySelector('.filter-options');
    if (openFilterOptions) {
      return true;
    }
    
    return false;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const resources = filteredResources();
    if (resources.length === 0) return;
    
    // Don't process keyboard shortcuts if we should ignore them
    if (shouldIgnoreKeyboardEvents()) {
      return;
    }

    if (e.key === 'd' && e.ctrlKey) {
        e.preventDefault();
        deleteResource(); 
    } else if (e.key === 'ArrowDown') {
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
    } else if (e.key === 'Enter') {
      const index = selectedIndex();
      if (index !== -1 && index < resources.length && props.onItemClick) {
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
      <div class="keyboard-shortcut-container">
        <KeyboardShortcuts
          shortcuts={getResourceShortcuts()}
          resourceSelected={selectedIndex() !== -1}
        />
      </div>
      
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