import { Accessor, createEffect, onMount, onCleanup, createSignal, createMemo, Show, JSX } from "solid-js";
import { render } from "solid-js/web";
import * as dagre from "dagre";
import * as graphlib from "graphlib";
import { ResourceDrawer } from "./resourceDetail/ResourceDrawer.tsx";
import { HelmDrawer } from "./resourceDetail/HelmDrawer.tsx";
import { KeyboardShortcuts, KeyboardShortcut } from "./keyboardShortcuts/KeyboardShortcuts.tsx";
import { useNavigate } from "@solidjs/router";
import { resourceTypeConfigs, ResourceCommand, ResourceTypeConfig, ResourceCardRenderer } from "../resourceTypeConfigs.tsx";
import { builtInCommands, replaceHandlers } from "./resourceList/ResourceList.tsx";

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
        
        <div class="resource-name">
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
}

export function ResourceTree(props: ResourceTreeProps) {
  const { g } = props;
  const navigate = useNavigate();

  let svgRef: SVGSVGElement | undefined;
  let gRef: SVGGElement | undefined;

  // State for resource selection and drawers
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [selectedResource, setSelectedResource] = createSignal<any | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"describe" | "yaml" | "events" | "logs">("describe");
  const [helmDrawerOpen, setHelmDrawerOpen] = createSignal(false);
  const [helmActiveTab, setHelmActiveTab] = createSignal<"history" | "values" | "manifest">("history");

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

  // Import drawer-related functions from ResourceList component
  const openDrawer = (tab: "describe" | "yaml" | "events" | "logs", resource: any) => {
    setSelectedResource(resource);
    setActiveTab(tab);
    setDrawerOpen(true);
    // Prevent page scrolling when drawer is open
    document.body.style.overflow = 'hidden';
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    // Restore page scrolling when drawer is closed
    document.body.style.overflow = '';
  };

  const openHelmDrawer = (resource: any, tab: "history" | "values" | "manifest" = "history") => {
    setSelectedResource(resource);
    setHelmActiveTab(tab);
    setHelmDrawerOpen(true);
    // Prevent page scrolling when drawer is open
    document.body.style.overflow = 'hidden';
  };

  const closeHelmDrawer = () => {
    setHelmDrawerOpen(false);
    // Restore page scrolling when drawer is closed
    document.body.style.overflow = '';
  };

  // Generate a list of all commands including built-in ones
  const getAllCommands = (): ResourceCommand[] => {
    const config = selectedResourceConfig();    
    const commands = [...(config?.commands || builtInCommands)];
    replaceHandlers(commands, {
      openDrawer,
      openHelmDrawer,
      navigate
    });
    return commands;
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
    const resourceNode = selectedResourceNode();
    if (!resourceNode || !resourceNode.resource) return;
    
    try {
      await command.handler(resourceNode.resource);
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

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    const nodes = resourceNodes();
    if (nodes.length === 0) return;
    
    // Don't process keyboard shortcuts if we should ignore them
    if (shouldIgnoreKeyboardEvents()) {
      return;
    }

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
      return;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const currentIndex = selectedNodeId() ? nodes.findIndex((n: ResourceNode) => n.id === selectedNodeId()) : -1;
      const prevIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
      const prevNode = nodes[prevIndex];
      if (prevNode) {
        setSelectedNodeId(prevNode.id);
        setSelectedResource(prevNode.resource);
      }
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Find the Enter command
      const enterCommand = findCommand('Enter', false);
      if (enterCommand) {
        executeCommand(enterCommand);
      }
      return;
    }

    // For all other keys, check if there's a resource selected
    if (!selectedNodeId()) return;

    // Find and execute the command
    const command = findCommand(e.key, e.ctrlKey);
    if (command) {
      e.preventDefault();
      executeCommand(command);
    }
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
        
        // Render the JSX content
        const solidRoot = document.createElement("div");
        foreignObject.appendChild(div);
        div.appendChild(solidRoot);
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

    // Render edges
    g.edges().forEach((e: graphlib.Edge) => {
      const edge = g.edge(e) as EdgeData;
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );

      // Get source and target nodes
      const sourceNode = g.node(e.v) as NodeData;
      const targetNode = g.node(e.w) as NodeData;

      // Calculate middle points
      const sourceX = sourceNode.x! + sourceNode.width / 2;
      const sourceY = sourceNode.y!;
      const targetX = targetNode.x! - targetNode.width / 2;
      const targetY = targetNode.y!;

      // Create Manhattan-style path
      let pathData = `M ${sourceX} ${sourceY}`;

      // Calculate intermediate points for Manhattan routing
      const midX = (sourceX + targetX) / 2;

      // First move horizontally to the midpoint
      pathData += ` H ${midX}`;
      // Then move vertically to target's y
      pathData += ` V ${targetY}`;
      // Finally move horizontally to target
      pathData += ` H ${targetX}`;

      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#999"); // Lighter gray
      path.setAttribute("stroke-width", "1");
      path.setAttribute("stroke-dasharray", "5,2"); // Dashed line
      gRef?.appendChild(path);
    });

    svgRef.setAttribute("width", `${maxX+40}px`);
    svgRef.setAttribute("height", `${maxY+40}px`);
  };

  createEffect(() => {
    renderGraph(g());
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    if (svgRef) {
      svgRef.addEventListener('click', handleSvgClick);
    }
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    if (svgRef) {
      svgRef.removeEventListener('click', handleSvgClick);
    }
    // Make sure to restore scrolling in case component is unmounted while drawer is open
    document.body.style.overflow = '';
  });

  return (
    <div class="resource-tree-container">
      <div class="graph-container">
        <svg ref={svgRef} class="graph-svg">
          <g ref={gRef}></g>
        </svg>
      </div>
      
      {/* Keyboard shortcuts display */}
      <Show when={selectedNodeId() && selectedResource()}>
        <div class="tree-keyboard-shortcuts">
          <KeyboardShortcuts
            shortcuts={getAvailableShortcuts()}
            resourceSelected={!!selectedNodeId()}
          />
        </div>
      </Show>

      {/* Resource drawer */}
      <ResourceDrawer
        resource={selectedResource()}
        isOpen={drawerOpen()}
        onClose={closeDrawer}
        initialTab={activeTab()}
      />

      {/* Helm drawer */}
      <HelmDrawer
        resource={selectedResource()}
        isOpen={helmDrawerOpen()}
        onClose={closeHelmDrawer}
        initialTab={helmActiveTab()}
      />
    </div>
  );
}
