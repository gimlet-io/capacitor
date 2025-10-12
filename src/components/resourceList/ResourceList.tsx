import { For, createSignal, onMount, onCleanup, createEffect, createMemo } from "solid-js";
import { ResourceDrawer } from "../resourceDetail/ResourceDrawer.tsx";
import { KeyboardShortcuts, KeyboardShortcut } from "../keyboardShortcuts/KeyboardShortcuts.tsx";
import { doesEventMatchShortcut } from "../../utils/shortcuts.ts";
import { useNavigate } from "@solidjs/router";
import { ResourceTypeConfig, navigateToKustomization, navigateToApplication, navigateToSecret, showPodsInNamespace, navigateToHelmClassicReleaseDetails, showRelatedPods, navigateToTerraform, type Column } from "../../resourceTypeConfigs.tsx";
import { helmReleaseColumns as _helmReleaseColumns } from "./HelmReleaseList.tsx";
import { useFilterStore } from "../../store/filterStore.tsx";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { checkPermissionSSAR, type MinimalK8sResource } from "../../utils/permissions.ts";

export interface ResourceCommand {
  shortcut: KeyboardShortcut;
  handler: (item: any, contextName?: string) => void | Promise<void>;
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
export const handleDeleteResource = async (resource: any, contextName?: string) => {
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
    
    const ctxName = encodeURIComponent(contextName || '');
    let apiPath = '';
    if (!group || group === 'core') {
      apiPath = ctxName ? `/k8s/${ctxName}/api/${version}` : `/k8s/api/${version}`;
    } else {
      apiPath = ctxName ? `/k8s/${ctxName}/apis/${group}/${version}` : `/k8s/apis/${group}/${version}`;
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
  if (localPort === 10080) {
    localPort = 10081;
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
    getContextName?: () => string | undefined;
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
          handler: (resource) => handleDeleteResource(resource, handlers.getContextName?.())
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
      } else if (cmd === navigateToTerraform && handlers.navigate) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            handlers.navigate!(`/terraform/${resource.metadata.namespace}/${resource.metadata.name}`);
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
      } else if (cmd === showRelatedPods && handlers.updateFilters) {
        commands[i] = {
          ...cmd,
          handler: (resource) => {
            try {
              const namespace = resource?.metadata?.namespace;
              // Prefer spec.selector.matchLabels (workloads), fallback to metadata.labels
              const labelMap = resource?.spec?.selector?.matchLabels || resource?.spec?.selector || resource?.metadata?.labels || {};
              const parts: string[] = [];
              for (const key in labelMap) {
                if (Object.prototype.hasOwnProperty.call(labelMap, key)) {
                  const val = String(labelMap[key]);
                  if (key && val) parts.push(`${key}=${val}`);
                }
              }
              const selector = parts.join(',');
              const newFilters: any[] = [
                { name: 'ResourceType', value: 'core/Pod' },
              ];
              if (namespace) newFilters.push({ name: 'Namespace', value: namespace });
              if (selector) newFilters.push({ name: 'LabelSelector', value: selector });
              handlers.updateFilters!(newFilters);
            } catch (err) {
              console.error('Failed to build related pods filter:', err);
            }
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
  resetKey?: unknown;
  columns: Column<any>[];
}) {
  const navigate = useNavigate();
  const filterStore = useFilterStore();
  const apiStore = useApiResourceStore();

  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [selectedResource, setSelectedResource] = createSignal<T | null>(null);
  const [activeTab, setActiveTab] = createSignal<"describe" | "yaml" | "events" | "logs" | "exec">("describe");
  const [commandPermissions, setCommandPermissions] = createSignal<Record<string, boolean | undefined>>({});
  // Debounce and cache for permission checks
  let permissionTimer: number | undefined;
  const permissionCache = new Map<string, Record<string, boolean | undefined>>();
  // Virtualization state
  const rowHeight = 36;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(600);
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

  // Reset UI state when resetKey changes
  createEffect(() => {
    const key = props.resetKey;
    // Only used for reactive dependency
    void key;
    setSelectedIndex(-1);
    setSelectedKey(null);
    setDrawerOpen(false);
    setSelectedResource(null);
    setActiveTab("describe");
    setScrollTop(0);
    const container = listContainer();
    if (container) {
      container.scrollTop = 0;
    }
  });


  // Apply sorting based on the current sort column and direction
  const sortedResources = createMemo(() => {
    let resources = props.resources;
    
    // Apply column-specific sorting
    const currentSortColumn = sortColumn();
    if (currentSortColumn) {
      const columns = props.columns;
      const sortingColumn = columns.find(col => col.header === currentSortColumn);
      if (sortingColumn?.sortFunction) {
        resources = sortingColumn.sortFunction(resources, sortAscending());
      }
    }
    
    return resources;
  });

  // Virtualization helpers (disabled when detail rows are present)
  const canVirtualize = createMemo(() => !props.resourceTypeConfig.detailRowRenderer);
  const totalCount = createMemo(() => sortedResources().length);
  const bufferRows = 10;
  const startIndex = createMemo(() => {
    if (!canVirtualize()) return 0;
    return Math.max(0, Math.floor(scrollTop() / rowHeight));
  });
  const visibleCount = createMemo(() => {
    if (!canVirtualize()) return totalCount();
    return Math.min(totalCount(), Math.ceil(viewportHeight() / rowHeight) + bufferRows);
  });
  const endIndex = createMemo(() => {
    if (!canVirtualize()) return totalCount();
    return Math.min(totalCount(), startIndex() + visibleCount());
  });
  const topSpacerHeight = createMemo(() => (canVirtualize() ? startIndex() * rowHeight : 0));
  const bottomSpacerHeight = createMemo(() => (canVirtualize() ? Math.max(0, (totalCount() - endIndex()) * rowHeight) : 0));
  const visibleSlice = createMemo(() => {
    if (!canVirtualize()) return sortedResources();
    const slice = sortedResources().slice(startIndex(), endIndex());
    return slice;
  });

  type KeyableResource = {
    kind?: string;
    apiVersion?: string;
    metadata?: { uid?: string; namespace?: string; name?: string };
  };

  const getResourceKey = (resource: KeyableResource): string => {
    // Prefer UID if available; otherwise compose a stable key
    const uid = resource?.metadata?.uid;
    if (uid) return String(uid);
    const kind = String(resource?.kind || "");
    const apiVersion = String(resource?.apiVersion || "");
    const namespace = String(resource?.metadata?.namespace || "");
    const name = String(resource?.metadata?.name || "");
    return `${apiVersion}|${kind}|${namespace}|${name}`;
  };

  const openDrawer = (tab: "describe" | "yaml" | "events" | "logs" | "exec", resource: T) => {
    setSelectedResource(() => resource);
    setSelectedKey(getResourceKey(resource as unknown as KeyableResource));
    setActiveTab(tab);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  // Resolve plural resource name using the API resource list
  const apiResourceStore = useApiResourceStore();

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
      const allowed = await checkPermissionSSAR(resource, { verb: 'delete', nameOverride: resource.metadata.name }, apiResourceStore.apiResources as any);
      return allowed;
    }
    // Logs
    if (key === 'l' && desc.includes('logs')) {
      const allowed = await checkPermissionSSAR(resource, { verb: 'get', subresource: 'log', resourceOverride: 'pods', groupOverride: '', nameOverride: resource.kind === 'Pod' ? resource.metadata.name : null }, apiResourceStore.apiResources as any);
      return allowed;
    }
    // Exec
    if (key === 'x' && desc.includes('exec')) {
      const allowed = await checkPermissionSSAR(resource, { verb: 'create', subresource: 'exec', resourceOverride: 'pods', groupOverride: '', nameOverride: resource.kind === 'Pod' ? resource.metadata.name : null }, apiResourceStore.apiResources as any);
      return allowed;
    }
    // Scale
    if (desc.includes('scale') && key.includes('+s')) {
      const allowed = await checkPermissionSSAR(resource, { verb: 'update', subresource: 'scale' }, apiResourceStore.apiResources as any);
      return allowed;
    }
    // Rollout restart
    if (desc.includes('rollout restart') && key.includes('+r')) {
      const allowed = await checkPermissionSSAR(resource, { verb: 'patch' }, apiResourceStore.apiResources as any);
      return allowed;
    }
    // Flux reconcile
    if (desc.startsWith('reconcile')) {
      const mainAllowed = await checkPermissionSSAR(resource, { verb: 'patch' }, apiResourceStore.apiResources as any);
      if (!mainAllowed) return false;
      if (desc.includes('with sources')) {
        const src: any = (resource as any)?.spec?.sourceRef;
        if (src?.kind && src?.name) {
          const srcGroup = typeof src?.apiVersion === 'string' && src.apiVersion.includes('/') ? src.apiVersion.split('/')[0] : undefined;
          const tempResource = { ...resource, kind: src.kind, apiVersion: src.apiVersion || '', metadata: { name: src.name, namespace: src.namespace || resource.metadata.namespace } } as MinimalK8sResource;
          const srcAllowed = await checkPermissionSSAR(tempResource, { verb: 'patch', groupOverride: srcGroup }, apiResourceStore.apiResources as any);
          if (!srcAllowed) return false;
        }
      }
      return true;
    }
    return undefined;
  };

  // Recompute all command permissions on selection change (debounced + cached)
  createEffect(() => {
    const res = selectedResource() as unknown as MinimalK8sResource | null;
    if (!res) {
      setCommandPermissions({});
      return;
    }
    const key = `${res.kind}|${res.metadata?.namespace || ''}|${res.metadata?.name || ''}`;
    if (permissionTimer !== undefined) {
      clearTimeout(permissionTimer);
      permissionTimer = undefined;
    }
    permissionTimer = setTimeout(async () => {
      const cached = permissionCache.get(key);
      if (cached) {
        setCommandPermissions(cached);
        return;
      }
      const cmds = getAllCommands();
      const entries = await Promise.all(cmds.map(async (c) => [commandId(c), await derivePermission(c, res)] as const));
      const map: Record<string, boolean | undefined> = {};
      for (const [id, allowed] of entries) map[id] = allowed;
      permissionCache.set(key, map);
      setCommandPermissions(map);
    }, 80) as unknown as number;
  });

  const handleColumnHeaderClick = (columnHeader: string) => {
    const columns = props.columns;
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
      updateFilters: (filters) => filterStore.setActiveFilters(filters),
      getContextName: () => apiStore.contextInfo?.current
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
      await command.handler(resource, apiStore.contextInfo?.current);
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
    const resources = sortedResources();
    const key = selectedKey();
    if (key) {
      const idx = resources.findIndex(r => getResourceKey(r as unknown as KeyableResource) === key);
      if (idx !== -1) {
        if (selectedIndex() !== idx) setSelectedIndex(idx);
        setSelectedResource(() => resources[idx]);
        return;
      } else {
        // Selected resource disappeared; clear key and fall back to index selection
        setSelectedKey(null);
      }
    }

    const index = selectedIndex();
    if (index >= 0 && index < resources.length) {
      const res = resources[index];
      setSelectedResource(() => res);
      // Ensure key follows current selection when navigating by index
      setSelectedKey(getResourceKey(res as unknown as KeyableResource));
    } else {
      setSelectedResource(null);
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
      
      // When virtualization is enabled, the target row might not be in the DOM.
      // In that case, adjust the scrollTop directly to bring the row into view.
      if (canVirtualize()) {
        const rh = rowHeight;
        const targetTop = index * rh;
        const targetBottom = targetTop + rh;
        const viewHeight = container.clientHeight || viewportHeight();
        const currentTop = container.scrollTop;
        const currentBottom = currentTop + viewHeight;

        if (targetTop < currentTop || targetBottom > currentBottom) {
          // Center the selected row within the viewport when scrolling
          const centerOffset = Math.max(0, Math.floor((viewHeight - rh) / 2));
          const newTop = Math.max(0, targetTop - centerOffset);
          container.scrollTop = newTop;
        }
        return;
      }
      
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
    const container = listContainer();
    if (container) {
      const onScroll = () => {
        setScrollTop(container.scrollTop);
        setViewportHeight(container.clientHeight || 600);
      };
      container.addEventListener('scroll', onScroll);
      // initialize measurements
      onScroll();
      // Save cleanup on element
      (container as any).__onScroll = onScroll;
    }
  });

  onCleanup(() => {
    globalThis.removeEventListener('keydown', handleKeyDown);
    const container = listContainer();
    if (container && (container as any).__onScroll) {
      container.removeEventListener('scroll', (container as any).__onScroll);
      delete (container as any).__onScroll;
    }
  });

  return (
    <div class={`resource-list-container`}>      
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
            {canVirtualize() && totalCount() > 0 && (
              <tr aria-hidden="true">
                <td colSpan={props.columns.length} style={`height: ${topSpacerHeight()}px; padding: 0; border: 0;`}></td>
              </tr>
            )}
            <For each={canVirtualize() ? visibleSlice() : sortedResources()} fallback={
              <tr>
                <td colSpan={props.columns.length} class="no-results">
                  {props.resources.length === 0 ? 'No resources found' : 'No resources match the current filters'}
                </td>
              </tr>
            }>
              {(resource, index) => {
                const globalIndex = () => canVirtualize() ? startIndex() + index() : index();
                const handleClick = () => {
                  setSelectedIndex(globalIndex());
                  setSelectedResource(() => resource);
                  setSelectedKey(getResourceKey(resource as unknown as KeyableResource));
                };
                
                return (
                  <>
                    <tr 
                      class={selectedIndex() === globalIndex() ? 'selected' : ''} 
                      onClick={handleClick}
                    >
                      {props.columns.map(column => (
                        <td title={column.title ? column.title(resource) : undefined}>
                          {column.accessor(resource)}
                        </td>
                      ))}
                    </tr>
                    {props.resourceTypeConfig.detailRowRenderer && (
                      <tr 
                        class={`detail-row ${selectedIndex() === globalIndex() ? 'selected' : ''}`}
                        onClick={handleClick}
                      >
                        {props.resourceTypeConfig.detailRowRenderer(resource, props.columns.length)}
                      </tr>
                    )}
                  </>
                );
              }}
            </For>
            {canVirtualize() && totalCount() > 0 && (
              <tr aria-hidden="true">
                <td colSpan={props.columns.length} style={`height: ${bottomSpacerHeight()}px; padding: 0; border: 0;`}></td>
              </tr>
            )}
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
