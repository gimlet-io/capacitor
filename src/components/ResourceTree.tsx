// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { Accessor, Setter, createEffect, onMount, onCleanup, createSignal, createMemo, Show, JSX } from "solid-js";
import { render } from "solid-js/web";
import * as dagre from "dagre";
import * as graphlib from "graphlib";
import { ResourceDrawer } from "./resourceDetail/ResourceDrawer.tsx";
import { KeyboardShortcuts, KeyboardShortcut } from "./keyboardShortcuts/KeyboardShortcuts.tsx";
import { useNavigate } from "@solidjs/router";
import { resourceTypeConfigs, ResourceCommand, ResourceTypeConfig, ResourceCardRenderer } from "../resourceTypeConfigs.tsx";
import { builtInCommands, replaceHandlers } from "./resourceList/ResourceList.tsx";
import { keyboardManager } from "../utils/keyboardManager.ts";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";

// Helper function to determine resource type from resource object
const getResourceType = (resource: any): string => {
  if (!resource || !resource.kind) return '';
  
  const apiVersion = resource.apiVersion || 'v1';
  const kind = resource.kind;
  
  if (apiVersion === 'v1') {
    return `core/${kind}`;
  } else if (apiVersion.includes('/')) {
    const [group, version] = apiVersion.split('/');
    return `${group}/${kind}`;
  } else {
    return `${apiVersion}/${kind}`;
  }
};

// Helper function to get resource type without version
const getResourceTypeWithoutVersion = (resourceType: string): string => {
  if (!resourceType) return '';
  
  // If the format is group/version/kind (e.g., apps/v1/Deployment)
  if (resourceType.split('/').length === 3) {
    const [group, , kind] = resourceType.split('/');
    return `${group}/${kind}`;
  }
  
  // Already in the right format (group/kind)
  return resourceType;
};

interface NodeData {
  label: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  stroke: string;
  strokeWidth: string;
  resource?: any;
  resourceType?: string;
  jsxContent?: JSX.Element;
}

interface EdgeData {
  points: Array<{ x: number; y: number }>;
}

interface ResourceNode {
  id: string;
  node: NodeData;
  resource: any;
  resourceType?: string;
}

// Helper function to calculate text width
const getTextWidth = (
  text: string,
  fontSize: number,
  fontWeight: string = "normal",
) => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;
  context.font = `${fontWeight} ${fontSize}px sans-serif`;
  return context.measureText(text).width;
};

// Helper function to create a node
export function createNode(
  g: graphlib.Graph,
  id: string,
  label: string,
  options: {
    fontSize?: number;
    fontWeight?: string;
    fill: string;
    stroke: string;
    strokeWidth: string;
    resource?: any;
    resourceType?: string;
    jsxContent?: JSX.Element;
    width?: number;
    height?: number;
  },
) {
  const {
    fontSize = 12,
    fontWeight = "normal",
    fill,
    stroke,
    strokeWidth,
    resource,
    resourceType,
    jsxContent,
    width: customWidth,
    height: customHeight,
  } = options;

  const textWidth = getTextWidth(label, fontSize, fontWeight);
  // If custom dimensions are provided, use them, otherwise calculate based on text
  const width = customWidth || Math.max(140, textWidth + 40); // Min width of 140
  const height = customHeight || (jsxContent ? 80 : 40); // Custom height for JSX content or default

  g.setNode(id, {
    width,
    height,
    fill,
    stroke,
    strokeWidth,
    resource,
    resourceType,
    jsxContent,
  });

  return id;
}

export function createPaginationNode(
  resourceType: string,
  startIndex: number,
  endIndex: number,
  totalPages: number,
  currentPage: number,
  setPaginationState: Setter<Record<string, number>>,
  paginationKey: string,
  totalResources: number,
) {
  return (
    <div class="resource-card">
      <div class="resource-card-header">
        <div class="resource-type">{resourceType.split('/')[1]}s</div>
      </div>
      <div class="resource-name pagination-buttons">
        <button type="button"
          onClick={() => {
            if (currentPage > 0) {
              setPaginationState(prev => ({
                ...prev,
                [paginationKey]: currentPage - 1
              }));
            }
          }}
          disabled={currentPage === 0}
          class="pagination-btn"
        >
          ‹
        </button>
        <span class="page-indicator">{startIndex + 1}-{endIndex} of {totalResources}</span>
        <button type="button"
          onClick={() => {
            if (currentPage < totalPages - 1) {
              setPaginationState(prev => ({
                ...prev,
                [paginationKey]: currentPage + 1
              }));
            }
          }}
          disabled={currentPage >= totalPages - 1}
          class="pagination-btn"
        >
          ›
        </button>
      </div>
    </div>
  )
}

// Helper function to create a node with card renderer
export function createNodeWithCardRenderer(
  g: graphlib.Graph,
  id: string,
  resource: any,
  resourceType: string,
  options: {
    fill: string;
    stroke: string;
    strokeWidth: string;
  }
) {
  const { fill, stroke, strokeWidth } = options;

  const lookupKey = getResourceTypeWithoutVersion(resourceType);
  let cardRenderer = resourceTypeConfigs[lookupKey]?.treeCardRenderer;
  if (!cardRenderer) {
    cardRenderer = defaultCardRenderer
  }

  return createNode(g, id, resource.metadata.name, {
    fill,
    stroke,
    strokeWidth,
    resource,
    resourceType,
    jsxContent: cardRenderer.render(resource),
    width: cardRenderer.width,
    height: cardRenderer.height
  });
}

const defaultCardRenderer: ResourceCardRenderer = {
  render: (resource) => {
    return (
      <div class="resource-card">
        <div class="resource-card-header">
          <div class="resource-type">{resource.kind}</div>
        </div>
        
        <div class="resource-name" title={resource.metadata.namespace+'/'+resource.metadata.name}>
          {resource.metadata.namespace}/{resource.metadata.name}
        </div>
      </div>
    );
  },
  width: 250,
  height: 70
}

interface ResourceTreeProps {
  g: Accessor<graphlib.Graph>
  resourceTypeVisibilityDropdown: JSX.Element
}

import { doesEventMatchShortcut } from "../utils/shortcuts.ts";

export function ResourceTree(props: ResourceTreeProps) {
  const { g } = props;
  const navigate = useNavigate();
  const apiStore = useApiResourceStore();

  let svgRef: SVGSVGElement | undefined;
  let gRef: SVGGElement | undefined;

  // State for resource selection and drawers
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [selectedResource, setSelectedResource] = createSignal<any | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"describe" | "yaml" | "events" | "logs">("describe");

  // Pan state (horizontal only)
  const [translate, setTranslate] = createSignal({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });
  const [canPanHorizontally, setCanPanHorizontally] = createSignal(false);

  // Get all nodes with their resources
  const resourceNodes = createMemo(() => {
    const graph = g();
    if (!graph) return [];
    
    return graph.nodes().map((nodeId: string) => {
      const node = graph.node(nodeId) as NodeData;
      return {
        id: nodeId,
        node,
        resource: node.resource,
        resourceType: node.resourceType || (node.resource ? getResourceType(node.resource) : undefined)
      };
    }).filter((item: ResourceNode) => item.resource); // Only include nodes with actual resources
  });

  // Get selected resource node
  const selectedResourceNode = createMemo(() => {
    const nodeId = selectedNodeId();
    if (!nodeId) return null;
    
    return resourceNodes().find((item: ResourceNode) => item.id === nodeId);
  });

  // Get resource type config for selected resource
  const selectedResourceConfig = createMemo((): ResourceTypeConfig | null => {
    const resourceNode = selectedResourceNode();
    if (!resourceNode || !resourceNode.resourceType) return null;
    
    const lookupKey = getResourceTypeWithoutVersion(resourceNode.resourceType);
    return resourceTypeConfigs[lookupKey] || null;
  });

  // Auto-select root resource node when graph loads or selection is invalid
  createEffect(() => {
    const graph = g();
    if (!graph) return;

    const allNodeIds = graph.nodes();
    const current = selectedNodeId();
    // If there is a current selection and it's still present, keep it
    if (current && allNodeIds.includes(current)) return;

    // Find a resource node with no predecessors (root); fallback to first resource node
    let rootId: string | null = null;
    for (const nodeId of allNodeIds) {
      const node = graph.node(nodeId) as NodeData;
      if (!node?.resource) continue;
      const predecessors = graph.predecessors(nodeId) || [];
      if (predecessors.length === 0) {
        rootId = nodeId;
        break;
      }
    }
    if (!rootId) {
      const firstResourceNodeId = allNodeIds.find((id: string) => !!(graph.node(id) as NodeData)?.resource);
      if (firstResourceNodeId) rootId = firstResourceNodeId;
    }

    if (rootId) {
      setSelectedNodeId(rootId);
      const node = graph.node(rootId) as NodeData;
      setSelectedResource(node?.resource || null);
    }
  });

  // Import drawer-related functions from ResourceList component
  const openDrawer = (tab: "describe" | "yaml" | "events" | "logs", resource: any) => {
    setSelectedResource(resource);
    setActiveTab(tab);
    setDrawerOpen(true);
    // Prevent page scrolling when drawer is open
    document.body.style.overflow = 'hidden';
  };

  // Wrapper to satisfy command handler signature that may include 'exec' or 'edit' tabs.
  const openDrawerWithExec = (tab: "describe" | "yaml" | "events" | "logs" | "exec" | "edit", resource: any) => {
    // Map unsupported tabs to nearest equivalents for the tree view
    const mappedTab = (tab === 'exec' ? 'logs' : tab === 'edit' ? 'yaml' : tab) as "describe" | "yaml" | "events" | "logs";
    openDrawer(mappedTab, resource);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    // Restore page scrolling when drawer is closed
    document.body.style.overflow = '';
  };

  // Generate a list of all commands including built-in ones
  const getAllCommands = (): ResourceCommand[] => {
    const config = selectedResourceConfig();    
    const commands = [...(config?.commands || builtInCommands)];
    replaceHandlers(commands, {
      openDrawer: openDrawerWithExec,
      navigate,
      getContextName: () => apiStore.contextInfo?.current
    }, apiStore.apiResources);
    return commands;
  };

  // Find a command by its shortcut key
  const findCommand = (e: KeyboardEvent): ResourceCommand | undefined => {
    const allCommands = getAllCommands();
    
    return allCommands.find(cmd => {
      const shortcutKey = cmd.shortcut.key;
      // Handle generic Mod+ and plain keys similarly to ResourceList
      if (shortcutKey.toLowerCase().includes('+')) {
        return doesEventMatchShortcut(e, shortcutKey);
      }
      return shortcutKey.toLowerCase() === (e.key || '').toLowerCase() && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    });
  };

  // Execute a command with the current selected resource
  const executeCommand = async (command: ResourceCommand) => {
    const resourceNode = selectedResourceNode();
    if (!resourceNode || !resourceNode.resource) return;
    
    try {
      await command.handler(resourceNode.resource, apiStore.contextInfo?.current);
    } catch (error) {
      console.error(`Error executing command ${command.shortcut.description}:`, error);
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent): boolean | void => {
    const nodes = resourceNodes();
    if (nodes.length === 0) return false;

    // Handle navigation keys first
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const currentIndex = selectedNodeId() ? nodes.findIndex((n: ResourceNode) => n.id === selectedNodeId()) : -1;
      const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, nodes.length - 1);
      const nextNode = nodes[nextIndex];
      if (nextNode) {
        setSelectedNodeId(nextNode.id);
        setSelectedResource(nextNode.resource);
      }
      return true;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const currentIndex = selectedNodeId() ? nodes.findIndex((n: ResourceNode) => n.id === selectedNodeId()) : -1;
      const prevIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
      const prevNode = nodes[prevIndex];
      if (prevNode) {
        setSelectedNodeId(prevNode.id);
        setSelectedResource(prevNode.resource);
      }
      return true;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Find the Enter command
      const enterCommand = getAllCommands().find(c => c.shortcut.key.toLowerCase() === 'enter');
      if (enterCommand) {
        executeCommand(enterCommand);
      }
      return true;
    }

    // For all other keys, check if there's a resource selected
    if (!selectedNodeId()) return false;

    // Find and execute the command
    const command = findCommand(e);
    if (command) {
      e.preventDefault();
      executeCommand(command);
      return true;
    }
    
    return false;
  };

  // Handle click outside nodes to deselect
  const handleSvgClick = (e: MouseEvent) => {
    // Only deselect if clicking directly on the SVG/container, not on a node
    if (e.target === svgRef || e.target === gRef) {
      setSelectedNodeId(null);
      setSelectedResource(null);
    }
  };

  // Get available shortcuts for the selected resource
  const getAvailableShortcuts = (): KeyboardShortcut[] => {
    const allCommands = getAllCommands();
    return allCommands.map(cmd => cmd.shortcut);
  };

  // Pan handlers (horizontal only)

  const handleMouseDown = (e: MouseEvent) => {
    // Only start dragging if it's a middle-click or left-click on the background
    if (((e.button === 1) || (e.button === 0 && (e.target === svgRef || e.target === gRef))) && canPanHorizontally()) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging()) {
      const dx = (e.clientX - dragStart().x);
      // vertical panning is disabled to allow normal page scroll
      setTranslate(prev => ({
        x: prev.x + dx,
        y: 0
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch events are not used; allow native vertical scrolling on touch devices
  
  const renderGraph = (g: graphlib.Graph) => {
    if (!svgRef || !gRef || !g) return;

    // Clear previous content
    gRef.innerHTML = "";

    // Default dimensions
    let maxX = 0;
    let maxY = 0;

    dagre.layout(g);

    // Get graph dimensions to set SVG size
    maxX = 0;
    maxY = 0;

    // Determine orientation
    const graphAttrsForNodes = (g.graph() as any) || {};
    const rankdirForNodes = (graphAttrsForNodes.rankdir as string) || "LR";

    // Render nodes
    g.nodes().forEach((v: string) => {
      const node = g.node(v) as NodeData;

      // Update max dimensions
      maxX = Math.max(maxX, node.x! + node.width / 2);
      maxY = Math.max(maxY, node.y! + node.height / 2);

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute(
        "transform",
        `translate(${node.x! - node.width / 2},${node.y! - node.height / 2})`,
      );

      // Add click handler for resource nodes
      if (node.resource) {
        group.style.cursor = "pointer";
        group.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedNodeId(v);
          setSelectedResource(node.resource);
        });
      }

      // Create rectangle
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rect.setAttribute("width", node.width.toString());
      rect.setAttribute("height", node.height.toString());
      rect.setAttribute("rx", "4");
      rect.setAttribute("ry", "4");
      // Apply theme-aware colors
      rect.setAttribute("fill", "var(--linear-bg-secondary)");
      rect.setAttribute("stroke", "var(--linear-border)");

      group.appendChild(rect);

      // Check if we have JSX content to render
      if (node.jsxContent) {
        // Create foreignObject for JSX content
        const foreignObject = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
        foreignObject.setAttribute("width", node.width.toString());
        foreignObject.setAttribute("height", node.height.toString());
        foreignObject.setAttribute("x", "0");
        foreignObject.setAttribute("y", "0");
        
        // Create a div container for the JSX content
        const div = document.createElement("div");
        div.style.width = "100%";
        div.style.height = "100%";
        div.style.boxSizing = "border-box";
        // Ensure solid background and text color inside foreignObject
        ;(div.style as any).backgroundColor = "var(--linear-bg-secondary)";
        ;(div.style as any).color = "var(--linear-text-primary)";
        // If a node-specific fill is provided, pass it down to the card via CSS var (only for TB graphs)
        if ((rankdirForNodes === "TB") && (node as any).fill) {
          try {
            (div.style as any).setProperty('--card-bg-color', (node as any).fill);
            (div.style as any).setProperty('--card-accent-color', (node as any).fill);
          } catch (_) {
            // noop
          }
        }
        // Node coloring is applied to the outer rect; no extra border styling here
        
        // Render the JSX content
        const solidRoot = document.createElement("div");
        foreignObject.appendChild(div);
        div.appendChild(solidRoot);
        // Ensure CSS var propagates to the rendered card (only for TB graphs)
        if ((rankdirForNodes === "TB") && (node as any).fill) {
          try {
            (solidRoot.style as any).setProperty('--card-bg-color', (node as any).fill);
            (solidRoot.style as any).setProperty('--card-accent-color', (node as any).fill);
          } catch (_) {
            // noop
          }
        }
        if (selectedNodeId() === v) {
          div.classList.add("selected-resource");
        }
        
        // Use solid-js's render to insert the JSX content
        const dispose = render(() => node.jsxContent!, solidRoot);
        onCleanup(() => dispose());
        
        group.appendChild(foreignObject);
      }
      
      gRef?.appendChild(group);
    });

    // Render edges with orientation-aware elbow paths
    const graphAttrs = (g.graph() as any) || {};
    const rankdir = (graphAttrs.rankdir as string) || "LR";

    g.edges().forEach((e: graphlib.Edge) => {
      const edge = g.edge(e) as EdgeData;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

      const sourceNode = g.node(e.v) as NodeData;
      const targetNode = g.node(e.w) as NodeData;

      let pathData = "";

      if (rankdir === "TB" || rankdir === "BT") {
        // Vertical orientation: connect bottom of source to top of target via horizontal elbow
        const sourceX = sourceNode.x!;
        const sourceY = sourceNode.y! + sourceNode.height / 2;
        const targetX = targetNode.x!;
        const targetY = targetNode.y! - targetNode.height / 2;

        const midY = sourceY + (targetY - sourceY) / 2;
        pathData = `M ${sourceX} ${sourceY}`;
        pathData += ` L ${sourceX} ${midY}`; // go down to midpoint
        pathData += ` L ${targetX} ${midY}`; // go horizontally to target column
        pathData += ` L ${targetX} ${targetY}`; // go down to target top
      } else {
        // Horizontal orientation: connect right of source to left of target via vertical elbow
        const sourceX = sourceNode.x! + sourceNode.width / 2;
        const sourceY = sourceNode.y!;
        const targetX = targetNode.x! - targetNode.width / 2;
        const targetY = targetNode.y!;

        const midX = sourceX + (targetX - sourceX) / 2;
        pathData = `M ${sourceX} ${sourceY}`;
        pathData += ` L ${midX} ${sourceY}`; // horizontally to midpoint
        pathData += ` L ${midX} ${targetY}`; // vertically to target row
        pathData += ` L ${targetX} ${targetY}`; // horizontally to target
      }

      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("class", "edge");
      path.setAttribute("stroke-dasharray", "5,2");
      gRef?.appendChild(path);
    });

    // Set the SVG size based on the graph dimensions
    const padding = 40;
    const minWidth = svgRef.parentElement?.clientWidth || 800;
    svgRef.setAttribute("width", `${Math.max(maxX + padding, minWidth)}px`);
    svgRef.setAttribute("height", `${maxY + padding}px`);
    // Allow panning only when content width exceeds container width
    setCanPanHorizontally((maxX + padding) > minWidth);
    
    // Apply transform to the group element for zoom and pan
    gRef.setAttribute("transform", `translate(${translate().x}, 0)`);
  };

  createEffect(() => {
    renderGraph(g());
  });

  onMount(() => {
    // Register with centralized keyboard manager (priority 3 = resource navigation)
    const unregister = keyboardManager.register({
      id: 'resource-tree',
      priority: 3,
      handler: handleKeyDown,
      ignoreInInput: true
    });
    
    if (svgRef) {
      svgRef.addEventListener('click', handleSvgClick);
      svgRef.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    onCleanup(() => {
      unregister();
      if (svgRef) {
        svgRef.removeEventListener('click', handleSvgClick);
        svgRef.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }
      // Make sure to restore scrolling in case component is unmounted while drawer is open
      document.body.style.overflow = '';
    });
  });

  return (
    <div class="resource-tree-container">
      <div class="graph-container">
        <svg ref={svgRef} class="graph-svg">
          <g ref={gRef}></g>
        </svg>
      </div>
      
      <div class="tree-controls">
        {props.resourceTypeVisibilityDropdown}
        {/* Keyboard shortcuts display */}
        <Show when={selectedNodeId() && selectedResource()}>
          <div class="tree-keyboard-shortcuts">
            <KeyboardShortcuts
              shortcuts={getAvailableShortcuts()}
              resourceSelected={!!selectedNodeId()}
            />
          </div>
        </Show>
      </div>

      {/* Zoom controls removed */}

      {/* Resource drawer */}
      <ResourceDrawer
        resource={selectedResource()}
        isOpen={drawerOpen()}
        onClose={closeDrawer}
        initialTab={activeTab()}
      />

    </div>
  );
}
