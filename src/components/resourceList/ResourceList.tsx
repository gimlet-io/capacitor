import { For, createSignal, onMount, onCleanup, createEffect, JSX } from "solid-js";
import { ResourceDrawer } from "../resourceDetail/ResourceDrawer.tsx";
import { KeyboardShortcuts, KeyboardShortcut } from "../keyboardShortcuts/KeyboardShortcuts.tsx";
import { useNavigate } from "@solidjs/router";

type Column<T> = {
  header: string;
  width: string;
  accessor: (item: T) => JSX.Element;
  title?: (item: T) => string;
};

type DetailRowRenderer<T> = (item: T) => JSX.Element;

export interface ResourceCommand {
  shortcut: KeyboardShortcut;
  handler: (item: any) => void | Promise<void>;
}

export function ResourceList<T>(props: { 
  resources: T[];
  columns: Column<T>[];
  noSelectClass?: boolean;
  onItemClick?: (item: any, navigate: any) => void;
  detailRowRenderer?: DetailRowRenderer<T>;
  rowKeyField?: string; // String key for resource.metadata
  commands?: ResourceCommand[];
}) {
  const navigate = useNavigate();

  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [selectedResource, setSelectedResource] = createSignal<T | null>(null);
  const [activeTab, setActiveTab] = createSignal<"describe" | "yaml" | "events" | "logs">("describe");

  const openDrawer = (tab: "describe" | "yaml" | "events" | "logs", resource: T) => {
    setSelectedResource(() => resource);
    setActiveTab(tab);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const handleDeleteResource = async (resource: any) => {
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
    }
  };

  // Generate a list of all commands including built-in ones
  const getAllCommands = (): ResourceCommand[] => {
    // Built-in commands that apply to all resources
    const builtInCommands: ResourceCommand[] = [
      {
        shortcut: { key: "Ctrl+d", description: "Delete resource", isContextual: true },
        handler: handleDeleteResource
      },
      {
        shortcut: { key: "d", description: "Describe", isContextual: true },
        handler: (resource) => openDrawer("describe", resource)
      },
      {
        shortcut: { key: "y", description: "YAML", isContextual: true },
        handler: (resource) => openDrawer("yaml", resource)
      },
      {
        shortcut: { key: "e", description: "Events", isContextual: true },
        handler: (resource) => openDrawer("events", resource)
      },
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: (resource) => openDrawer("logs", resource)
      }
    ];
    
    // Combine with provided commands
    return [...builtInCommands, ...(props.commands || [])];
  };

  // Find a command by its shortcut key
  const findCommand = (key: string, ctrlKey: boolean): ResourceCommand | undefined => {
    const allCommands = getAllCommands();
    
    return allCommands.find(cmd => {
      const shortcutKey = cmd.shortcut.key;
      // Handle both formats: "Ctrl+X" and direct ctrl key checks
      const hasCtrl = shortcutKey.toLowerCase().includes('ctrl+');
      const actualKey = hasCtrl ? shortcutKey.split('+')[1].toLowerCase() : shortcutKey.toLowerCase();
      
      return actualKey === key.toLowerCase() && (ctrlKey === hasCtrl);
    });
  };

  // Execute a command with the current selected resource
  const executeCommand = async (command: ResourceCommand) => {
    const index = selectedIndex();
    if (index === -1 || index >= props.resources.length) return;
    
    try {
      const resource = props.resources[index];
      await command.handler(resource);
    } catch (error) {
      console.error(`Error executing command ${command.shortcut.description}:`, error);
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

  // Generic function to handle keyboard shortcuts by mapping keys to commands and built-in actions
  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.resources.length === 0) return;
    
    // Don't process keyboard shortcuts if we should ignore them
    if (shouldIgnoreKeyboardEvents()) {
      return;
    }

    // Handle navigation keys first (these don't need a selected resource)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, props.resources.length - 1);
        return newIndex;
      });
      return;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 1, 0);
        return newIndex;
      });
      return;
    } else if (e.key === 'Enter') {
      const index = selectedIndex();
      if (index !== -1 && index < props.resources.length && props.onItemClick) {
        props.onItemClick(props.resources[index], navigate);
      }
      return;
    }

    // For all other keys, check if there's a resource selected
    if (selectedIndex() === -1) return;

    // Find and execute the command
    const command = findCommand(e.key, e.ctrlKey);
    if (command) {
      e.preventDefault();
      executeCommand(command);
    }
  };

  // Reset selectedIndex when filtered results change
  createEffect(() => {
    if (props.resources.length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex() >= props.resources.length) {
      setSelectedIndex(props.resources.length - 1);
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

  // Get all available shortcuts including custom commands
  const getAvailableShortcuts = () => {
    return getAllCommands().map(cmd => cmd.shortcut);
  };

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
          shortcuts={getAvailableShortcuts()}
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
            <For each={props.resources}>
              {(resource, index) => {
                const handleClick = () => {
                  setSelectedIndex(index());
                  if (props.onItemClick) {
                    props.onItemClick(resource, navigate);
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