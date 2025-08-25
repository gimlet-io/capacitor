import { For, createSignal, onMount, onCleanup, createEffect, createMemo } from "solid-js";
import { ResourceDrawer } from "../resourceDetail/ResourceDrawer.tsx";
import { KeyboardShortcuts, KeyboardShortcut } from "../keyboardShortcuts/KeyboardShortcuts.tsx";
import { doesEventMatchShortcut } from "../../utils/shortcuts.ts";
import { useNavigate } from "@solidjs/router";
import { ResourceTypeConfig, navigateToKustomization, navigateToApplication, navigateToSecret, showPodsInNamespace, navigateToHelmClassicReleaseDetails } from "../../resourceTypeConfigs.tsx";
import { helmReleaseColumns as _helmReleaseColumns } from "./HelmReleaseList.tsx";
import { useFilterStore } from "../../store/filterStore.tsx";
import { namespaceColumn } from "../../resourceTypeConfigs.tsx";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";

export interface ResourceCommand {
  shortcut: KeyboardShortcut;
  handler: (item: any) => void | Promise<void>;
}

export const builtInCommands = [
  {
    shortcut: { key: "d", description: "Describe", isContextual: true },
    handler: null as any  // Will be implemented in ResourceList
  },
  {
    shortcut: { key: "y", description: "YAML", isContextual: true },
    handler: null as any  // Will be implemented in ResourceList
  },
  {
    shortcut: { key: "e", description: "Events", isContextual: true },
    handler: null as any  // Will be implemented in ResourceList
  },
  {
    shortcut: { key: "Mod+d", description: "Delete resource", isContextual: true },
    handler: null as any  // Will be implemented in ResourceList
  },
]

// Shared function to handle resource deletion
export const handleDeleteResource = async (resource: any) => {
  if (!resource || !resource.metadata) return;
  
  const resourceName = resource.metadata.name;
  const resourceKind = resource.kind;
  
  // Show browser's native confirmation dialog
  const confirmed = globalThis.confirm(`Are you sure you want to delete ${resourceKind} "${resourceName}"?`);
  
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

// Build a kubectl port-forward command for supported resource kinds
function buildPortForwardCommand(resource: any): string {
  if (!resource || !resource.metadata) return '';
  const namespace = resource.metadata.namespace || '';
  const name = resource.metadata.name;
  let type = '';
  let remotePort: number | string | undefined;

  switch (resource.kind) {
    case 'Pod':
      type = 'pod';
      remotePort = resource?.spec?.containers?.find((c: any) => Array.isArray(c?.ports) && c.ports.length > 0)?.ports?.[0]?.containerPort;
      break;
    case 'Service':
      type = 'service';
      remotePort = resource?.spec?.ports?.[0]?.port;
      break;
    case 'Deployment':
      type = 'deployment';
      remotePort = resource?.spec?.template?.spec?.containers?.find((c: any) => Array.isArray(c?.ports) && c.ports.length > 0)?.ports?.[0]?.containerPort;
      break;
    case 'ReplicaSet':
      type = 'replicaset';
      remotePort = resource?.spec?.template?.spec?.containers?.find((c: any) => Array.isArray(c?.ports) && c.ports.length > 0)?.ports?.[0]?.containerPort;
      break;
    case 'StatefulSet':
      type = 'statefulset';
      remotePort = resource?.spec?.template?.spec?.containers?.find((c: any) => Array.isArray(c?.ports) && c.ports.length > 0)?.ports?.[0]?.containerPort;
      break;
    default:
      type = String(resource.kind || '').toLowerCase();
  }

  if (!remotePort) remotePort = 80;
  let localPort: number | string = remotePort as number | string;
  const numericRemote = typeof remotePort === 'string' ? parseInt(remotePort, 10) : remotePort;
  if (typeof numericRemote === 'number' && !Number.isNaN(numericRemote) && numericRemote < 1024) {
    localPort = 10000 + numericRemote;
  }
  const nsArg = namespace ? `-n ${namespace} ` : '';
  return `kubectl port-forward ${nsArg}${type}/${name} ${localPort}:${remotePort}`.trim();
}

// Shared function to replace command handlers with actual implementations
export const replaceHandlers = (
  commands: ResourceCommand[],
  handlers: {
    openDrawer: (tab: "describe" | "yaml" | "events" | "logs" | "exec", resource: any) => void;
    navigate?: (path: string) => void;
    updateFilters?: (filters: any[]) => void;
  }
) => {
  // Replace the null handlers with actual implementations for built-in commands
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    
    // Check for built-in command key combinations and replace null handlers
    if (cmd.handler === null) {
      if (cmd.shortcut.key === 'd' && cmd.shortcut.description === 'Describe') {
        commands[i] = {
          ...cmd,
          handler: (resource) => handlers.openDrawer("describe", resource)
        };
      } else if (cmd.shortcut.key === 'y' && cmd.shortcut.description === 'YAML') {
        commands[i] = {
          ...cmd,
          handler: (resource) => handlers.openDrawer("yaml", resource)
        };
      } else if (cmd.shortcut.key === 'e' && cmd.shortcut.description === 'Events') {
        commands[i] = {
          ...cmd,
          handler: (resource) => handlers.openDrawer("events", resource)
        };
      } else if (cmd.shortcut.key === 'l' && cmd.shortcut.description === 'Logs') {
        commands[i] = {
          ...cmd,
          handler: (resource) => handlers.openDrawer("logs", resource)
        };
      } else if (cmd.shortcut.key === 'x' && cmd.shortcut.description === 'Exec') {
        commands[i] = {
          ...cmd,
          handler: (resource) => handlers.openDrawer("exec", resource)
        };
      } else if (cmd.shortcut.description === 'Delete resource') {
        commands[i] = {
          ...cmd,
          handler: handleDeleteResource
        };
      } else if (cmd === navigateToKustomization && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/kustomization/${resource.metadata.namespace}/${resource.metadata.name}`);
          }
        };
      } else if (cmd === navigateToHelmClassicReleaseDetails && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/helmclassic/${resource.metadata.namespace}/${resource.metadata.name}`);
          }
        };
      } else if (cmd === navigateToApplication && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/application/${resource.metadata.namespace}/${resource.metadata.name}`);
          }
        };
      } else if (cmd === navigateToSecret && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/secret/${resource.metadata.namespace}/${resource.metadata.name}`);
          }
        };
      } else if (cmd.shortcut.key === 'Enter' && cmd.shortcut.description.toLowerCase().includes('classic') && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/helmclassic/${resource.metadata.namespace}/${resource.metadata.name}`);
          }
        };
      } else if (cmd.shortcut.key === 'Enter' && cmd.shortcut.description.toLowerCase().includes('helm release') && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/helmrelease/${resource.metadata.namespace}/${resource.metadata.name}`);
          }
        };
      } else if (cmd === showPodsInNamespace && handlers.updateFilters) {
        commands[i] = {
          ...cmd,
          handler: (namespace) => {
            // Update filters to show pods in the selected namespace
            const newFilters = [
              { name: 'ResourceType', value: 'core/Pod' },
              { name: 'Namespace', value: namespace.metadata.name }
            ];
            
            handlers.updateFilters!(newFilters);
          }
        };
      } else if (cmd.shortcut.description === 'Copy port-forward') {
        commands[i] = {
          ...cmd,
          handler: async (resource) => {
            try {
              const command = buildPortForwardCommand(resource);
              if (command) {
                await navigator.clipboard.writeText(command);
              }
            } catch (error) {
              console.error('Failed to copy port-forward command:', error);
            }
          }
        };
      }
    }
  }
};

export function ResourceList<T>(props: { 
  resources: T[];
  resourceTypeConfig: ResourceTypeConfig;
}) {
  const navigate = useNavigate();
  const filterStore = useFilterStore();

  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [selectedResource, setSelectedResource] = createSignal<T | null>(null);
  const [activeTab, setActiveTab] = createSignal<"describe" | "yaml" | "events" | "logs" | "exec">("describe");
  const [commandPermissions, setCommandPermissions] = createSignal<Record<string, boolean | undefined>>({});
  // Use filterStore for sorting state
  const sortColumn = () => filterStore.sortColumn;
  const sortAscending = () => filterStore.sortAscending;
  const setSortColumn = (column: string | null) => filterStore.setSortColumn(column);
  const setSortAscending = (ascending: boolean) => filterStore.setSortAscending(ascending);

  // Initialize sort column from config if not already set
  createEffect(() => {
    if (!filterStore.sortColumn && props.resourceTypeConfig.defaultSortColumn) {
      filterStore.setSortColumn(props.resourceTypeConfig.defaultSortColumn);
    }
  });

  // Get the selected namespace
  const selectedNamespace = createMemo(() => {
    return filterStore.getNamespace();
  });

  // Process columns with namespace column insertion
  const visibleColumns = createMemo(() => {
    const namespace = selectedNamespace();
    const resourceColumns = props.resourceTypeConfig.columns;
    
    // If no specific namespace is selected or it's "all-namespaces", inject the namespace column
    if (!namespace || namespace === 'all-namespaces') {
      // Check if the resource has a namespace field (is namespaced)
      const isNamespaced = props.resources.length > 0 && 
                           props.resources[0] && 
                           (props.resources[0] as any).metadata && 
                           (props.resources[0] as any).metadata.namespace !== undefined;
      
      if (isNamespaced) {
        // Create a new array with namespace column inserted as the second column
        return [
          resourceColumns[0],
          namespaceColumn,
          ...resourceColumns.slice(1)
        ];
      }
      
      return resourceColumns;
    }
    
    return resourceColumns;
  });

  // Apply sorting based on the current sort column and direction
  const sortedResources = createMemo(() => {
    let resources = props.resources;
    
    // Apply column-specific sorting
    const currentSortColumn = sortColumn();
    if (currentSortColumn) {
      const columns = visibleColumns();
      const sortingColumn = columns.find(col => col.header === currentSortColumn);
      if (sortingColumn?.sortFunction) {
        resources = sortingColumn.sortFunction(resources, sortAscending());
      }
    }
    
    return resources;
  });

  const openDrawer = (tab: "describe" | "yaml" | "events" | "logs" | "exec", resource: T) => {
    setSelectedResource(() => resource);
    setActiveTab(tab);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  // Resolve plural resource name using the API resource list
  const apiResourceStore = useApiResourceStore();
  type MinimalK8sResource = { apiVersion?: string; kind: string; metadata: { name: string; namespace?: string } };
  const getPluralForResource = (resource: MinimalK8sResource): string => {
    try {
      const apiVersion: string = resource.apiVersion || "v1";
      const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
      const version = apiVersion.includes('/') ? apiVersion.split('/')[1] : apiVersion;
      const kind = resource.kind;
      const apiResources = apiResourceStore.apiResources || [];
      const match = apiResources.find(r => r.kind === kind && r.group === group && r.version === version);
      if (match?.name) return match.name;
    } catch (_) {
      // ignore and fall back to naive plural
    }
    return `${String(resource.kind || '').toLowerCase()}s`;
  };

  // Generic permission check via SelfSubjectAccessReview
  const checkPermission = async (
    resource: MinimalK8sResource,
    opts: { verb: string; subresource?: string; resourceOverride?: string; groupOverride?: string; nameOverride?: string | null }
  ): Promise<boolean> => {
    if (!resource || !resource.metadata) return false;
    try {
      const apiVersion: string = resource.apiVersion || "v1";
      const group = opts.groupOverride !== undefined ? opts.groupOverride : (apiVersion.includes('/') ? apiVersion.split('/')[0] : '');
      const resourceName = opts.resourceOverride || getPluralForResource(resource);
      const body: any = {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectAccessReview",
        spec: {
          resourceAttributes: {
            group,
            resource: resourceName,
            namespace: resource.metadata.namespace,
            verb: opts.verb,
          }
        }
      };
      const name = opts.nameOverride === undefined ? resource.metadata.name : opts.nameOverride;
      if (name) body.spec.resourceAttributes.name = name;
      if (opts.subresource) body.spec.resourceAttributes.subresource = opts.subresource;

      const resp = await fetch('/k8s/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!resp.ok) return true; // be permissive on SSAR failure
      const data = await resp.json();
      return !!data?.status?.allowed;
    } catch (_) {
      return true; // permissive on error
    }
  };

  // Unique id for a command
  const commandId = (cmd: ResourceCommand) => `${cmd.shortcut.key}::${cmd.shortcut.description}`;

  // Derive which permission a command needs
  const derivePermission = async (cmd: ResourceCommand, resource: MinimalK8sResource): Promise<boolean | undefined> => {
    const desc = cmd.shortcut.description.toLowerCase();
    const key = cmd.shortcut.key.toLowerCase();
    // Read-only commands
    if (desc === 'describe' || desc === 'yaml' || desc === 'events' || desc === 'manifest' || desc === 'values' || desc === 'release history') {
      return undefined;
    }
    // Delete
    if (desc.includes('delete') && (key.includes('+d'))) {
      return checkPermission(resource, { verb: 'delete', nameOverride: resource.metadata.name });
    }
    // Logs
    if (key === 'l' && desc.includes('logs')) {
      return checkPermission(resource, { verb: 'get', subresource: 'log', resourceOverride: 'pods', groupOverride: '', nameOverride: resource.kind === 'Pod' ? resource.metadata.name : null });
    }
    // Exec
    if (key === 'x' && desc.includes('exec')) {
      return checkPermission(resource, { verb: 'create', subresource: 'exec', resourceOverride: 'pods', groupOverride: '', nameOverride: resource.kind === 'Pod' ? resource.metadata.name : null });
    }
    // Scale
    if (desc.includes('scale') && key.includes('+s')) {
      return checkPermission(resource, { verb: 'update', subresource: 'scale' });
    }
    // Rollout restart
    if (desc.includes('rollout restart') && key.includes('+r')) {
      return checkPermission(resource, { verb: 'patch' });
    }
    // Flux reconcile
    if (desc.startsWith('reconcile')) {
      const mainAllowed = await checkPermission(resource, { verb: 'patch' });
      if (!mainAllowed) return false;
      if (desc.includes('with sources')) {
        const src: any = (resource as any)?.spec?.sourceRef;
        if (src?.kind && src?.name) {
          const srcGroup = typeof src?.apiVersion === 'string' && src.apiVersion.includes('/') ? src.apiVersion.split('/')[0] : undefined;
          const tempResource = { ...resource, kind: src.kind, apiVersion: src.apiVersion || '', metadata: { name: src.name, namespace: src.namespace || resource.metadata.namespace } } as MinimalK8sResource;
          const srcAllowed = await checkPermission(tempResource, { verb: 'patch', groupOverride: srcGroup });
          if (!srcAllowed) return false;
        }
      }
      return true;
    }
    return undefined;
  };

  // Recompute all command permissions on selection change
  createEffect(() => {
    const res = selectedResource() as unknown as MinimalK8sResource | null;
    if (!res) {
      setCommandPermissions({});
      return;
    }
    const cmds = getAllCommands();
    (async () => {
      const entries = await Promise.all(cmds.map(async (c) => [commandId(c), await derivePermission(c, res)] as const));
      const map: Record<string, boolean | undefined> = {};
      for (const [id, allowed] of entries) map[id] = allowed;
      setCommandPermissions(map);
    })();
  });

  const handleColumnHeaderClick = (columnHeader: string) => {
    const columns = visibleColumns();
    const column = columns.find(col => col.header === columnHeader);
    
    if (!column?.sortable) return;
    
    if (sortColumn() === columnHeader) {
      // Toggle sort direction
      setSortAscending(!sortAscending());
    } else {
      // Set new sort column
      setSortColumn(columnHeader);
      setSortAscending(true);
    }
  };

  // Generate a list of all commands including built-in ones
  const getAllCommands = (): ResourceCommand[] => {
    // Get the commands from the resource config
    const commands = [...(props.resourceTypeConfig.commands || builtInCommands)];
    replaceHandlers(commands, {
      openDrawer,
      navigate: navigate,
      updateFilters: (filters) => filterStore.setActiveFilters(filters)
    });
    return commands;
  };

  // Find a command by its shortcut key
  const findCommand = (e: KeyboardEvent): ResourceCommand | undefined => {
    const allCommands = getAllCommands();
    
    return allCommands.find(cmd => {
      const sk = cmd.shortcut.key;
      if (sk.toLowerCase().includes('+')) {
        return doesEventMatchShortcut(e, sk);
      }
      return sk.toLowerCase() === (e.key || '').toLowerCase() && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    });
  };

  // Execute a command with the current selected resource
  const executeCommand = async (command: ResourceCommand) => {
    const index = selectedIndex();
    if (index === -1 || index >= sortedResources().length) return;
    
    try {
      const resource = sortedResources()[index];
      const id = commandId(command);
      const allowed = commandPermissions()[id];
      if (allowed === false) return;
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
    if (sortedResources().length === 0) return;
    
    // Don't process keyboard shortcuts if we should ignore them
    if (shouldIgnoreKeyboardEvents()) {
      return;
    }

    // Handle navigation keys first (these don't need a selected resource)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, sortedResources().length - 1);
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
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 20, sortedResources().length - 1);
        return newIndex;
      });
      return;
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 20, 0);
        return newIndex;
      });
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Find the Enter command
      const enterCommand = getAllCommands().find(c => c.shortcut.key.toLowerCase() === 'enter');
      if (enterCommand) {
        executeCommand(enterCommand);
      }
      return;
    }

    // For all other keys, check if there's a resource selected
    if (selectedIndex() === -1) return;

    // Find and execute the command
    const command = findCommand(e);
    if (command) {
      e.preventDefault();
      executeCommand(command);
    }
  };

  // Reset selectedIndex when filtered results change
  createEffect(() => {
    if (sortedResources().length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex() >= sortedResources().length) {
      setSelectedIndex(sortedResources().length - 1);
    }
  });

  // Keep selectedResource in sync with selectedIndex for accurate permission checks
  createEffect(() => {
    const index = selectedIndex();
    if (index >= 0 && index < sortedResources().length) {
      setSelectedResource(() => sortedResources()[index]);
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
      if (props.resourceTypeConfig.detailRowRenderer) {
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
    const allCommands = getAllCommands();

    return allCommands.map(cmd => {
      const id = commandId(cmd);
      const allowed = commandPermissions()[id];
      return { ...cmd.shortcut, disabled: allowed === false } as KeyboardShortcut;
    });
  };

  onMount(() => {
    globalThis.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    globalThis.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class={`resource-list-container ${props.resourceTypeConfig.noSelectClass ? 'no-select' : ''}`}>      
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
              {visibleColumns().map(column => (
                <th 
                  style={`width: ${column.width}; ${column.sortable ? 'cursor: pointer; user-select: none;' : ''}`}
                  onClick={() => handleColumnHeaderClick(column.header)}
                  title={column.sortable ? 'Click to sort' : undefined}
                >
                  <div style="display: flex; align-items: center; gap: 4px;">
                    {column.header}
                    {column.sortable && (
                      <span class="sort-indicator">
                        {sortColumn() === column.header ? (
                          sortAscending() ? '▲' : '▼'
                        ) : (
                          <span style="color: var(--linear-text-tertiary);">▲▼</span>
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <For each={sortedResources()} fallback={
              <tr>
                <td colSpan={visibleColumns().length} class="no-results">
                  {props.resources.length === 0 ? 'No resources found' : 'No resources match the current filters'}
                </td>
              </tr>
            }>
              {(resource, index) => {
                const handleClick = () => {
                  setSelectedIndex(index());
                  setSelectedResource(() => resource);
                };
                
                return (
                  <>
                    <tr 
                      class={selectedIndex() === index() ? 'selected' : ''} 
                      onClick={handleClick}
                    >
                      {visibleColumns().map(column => (
                        <td title={column.title ? column.title(resource) : undefined}>
                          {column.accessor(resource)}
                        </td>
                      ))}
                    </tr>
                    {props.resourceTypeConfig.detailRowRenderer && (
                      <tr class={selectedIndex() === index() ? 'selected' : ''}
                        onClick={handleClick}
                      >
                        {props.resourceTypeConfig.detailRowRenderer(resource, visibleColumns().length)}
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
