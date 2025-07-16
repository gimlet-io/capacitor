import { Accessor, Setter, createEffect, onMount, onCleanup, createSignal, createMemo, Show, JSX } from "solid-js";
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
    <div class="resource-card" style="--card-bg-color:rgb(209, 209, 209);">
      <div class="resource-card-header">
        <div class="resource-type">{resourceType.split('/')[1]}s</div>
      </div>
      <div class="resource-name pagination-buttons">
        <button 
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
        <button 
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

  // Add state for zoom and pan
  const [scale, setScale] = createSignal(1);
  const [translate, setTranslate] = createSignal({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });

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

  // Zoom and pan handlers
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    
    if (!svgRef) return;
    
    // Calculate the point where the mouse is hovering (in SVG coordinates)
    const svgRect = svgRef.getBoundingClientRect();
    const mouseX = (e.clientX - svgRect.left) / scale() - translate().x;
    const mouseY = (e.clientY - svgRect.top) / scale() - translate().y;
    
    // Calculate new scale
    const delta = e.deltaY > 0 ? 0.9 : 1.1; // Zoom in or out
    const newScale = Math.min(Math.max(scale() * delta, 0.1), 3); // Limit zoom between 0.1x and 3x
    
    // Calculate new translate to keep mouse position fixed
    const newTranslateX = mouseX - (mouseX - translate().x) * (newScale / scale());
    const newTranslateY = mouseY - (mouseY - translate().y) * (newScale / scale());
    
    setScale(newScale);
    setTranslate({ x: newTranslateX, y: newTranslateY });
  };

  const handleMouseDown = (e: MouseEvent) => {
    // Only start dragging if it's a middle-click or left-click on the background
    if ((e.button === 1) || (e.button === 0 && (e.target === svgRef || e.target === gRef))) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging()) {
      const dx = (e.clientX - dragStart().x) / scale();
      const dy = (e.clientY - dragStart().y) / scale();
      
      setTranslate(prev => ({
        x: prev.x + dx,
        y: prev.y + dy
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isDragging() && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - dragStart().x) / scale();
      const dy = (e.touches[0].clientY - dragStart().y) / scale();
      
      setTranslate(prev => ({
        x: prev.x + dx,
        y: prev.y + dy
      }));
      
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const zoomIn = () => {
    setScale(prev => Math.min(prev * 1.2, 3));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(prev / 1.2, 0.1));
  };

  const resetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
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

      // Calculate connection points - source at right side, target at left side
      const sourceX = sourceNode.x! + sourceNode.width / 2;
      const sourceY = sourceNode.y!;
      const targetX = targetNode.x! - targetNode.width / 2;
      const targetY = targetNode.y!;

      // Calculate path with square corners
      let pathData = `M ${sourceX} ${sourceY}`;
      
      // Determine the midpoint between nodes
      const midX = sourceX + (targetX - sourceX) / 2;
      
      // Create square path with right angles
      // First go horizontally to midpoint
      pathData += ` L ${midX} ${sourceY}`;
      // Then go vertically to target's y-coordinate
      pathData += ` L ${midX} ${targetY}`;
      // Finally go horizontally to target
      pathData += ` L ${targetX} ${targetY}`;

      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#999"); // Lighter gray
      path.setAttribute("stroke-width", "1");
      path.setAttribute("stroke-dasharray", "5,2"); // Dashed line
      gRef?.appendChild(path);
    });

    // Set the SVG size based on the graph dimensions
    const padding = 40;
    const minWidth = svgRef.parentElement?.clientWidth || 800;
    svgRef.setAttribute("width", `${Math.max(maxX + padding, minWidth)}px`);
    svgRef.setAttribute("height", `${maxY + padding}px`);
    
    // Apply transform to the group element for zoom and pan
    gRef.setAttribute("transform", `translate(${translate().x}, ${translate().y}) scale(${scale()})`);
  };

  createEffect(() => {
    renderGraph(g());
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    if (svgRef) {
      svgRef.addEventListener('click', handleSvgClick);
      svgRef.addEventListener('wheel', handleWheel, { passive: false });
      svgRef.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      svgRef.addEventListener('touchstart', handleTouchStart, { passive: false });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
    }
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    if (svgRef) {
      svgRef.removeEventListener('click', handleSvgClick);
      svgRef.removeEventListener('wheel', handleWheel);
      svgRef.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      svgRef.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
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

      {/* Zoom controls */}
      <div class="zoom-controls">
        <button class="zoom-button" onClick={zoomIn} title="Zoom In">
          <span>+</span>
        </button>
        <button class="zoom-button" onClick={resetZoom} title="Reset Zoom">
          <span>⟳</span>
        </button>
        <button class="zoom-button" onClick={zoomOut} title="Zoom Out">
          <span>−</span>
        </button>
      </div>

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
