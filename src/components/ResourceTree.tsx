import { Accessor, createEffect, onMount, Signal } from "solid-js";
import type { KustomizationWithInventory } from "../types/k8s.ts";
import * as dagre from "dagre";
import * as graphlib from "graphlib";

interface NodeData {
  label: string;
  width: number;
  height: number;
  type: "kustomization" | "deployment" | "replicaset" | "pod" | "service";
  x?: number;
  y?: number;
  fontSize?: number;
  fontWeight?: string;
  fill: string;
  stroke: string;
  strokeWidth: string;
}

interface EdgeData {
  points: Array<{ x: number; y: number }>;
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
  type: NodeData["type"],
  options: {
    fontSize?: number;
    fontWeight?: string;
    fill: string;
    stroke: string;
    strokeWidth: string;
  },
) {
  const {
    fontSize = 12,
    fontWeight = "normal",
    fill,
    stroke,
    strokeWidth,
  } = options;

  const textWidth = getTextWidth(label, fontSize, fontWeight);
  const width = Math.max(140, textWidth + 40); // Fixed minWidth of 140
  const height = 40; // Fixed height of 40

  g.setNode(id, {
    label,
    width,
    height,
    type,
    fontSize,
    fontWeight,
    fill,
    stroke,
    strokeWidth,
  });

  return id;
}

interface ResourceTreeProps {
  g: Accessor<graphlib.Graph>
}

export function ResourceTree(props: ResourceTreeProps) {
  const { g } = props;

  let svgRef: SVGSVGElement | undefined;
  let gRef: SVGGElement | undefined;

  const renderGraph = (g: graphlib.Graph) => {
    if (!svgRef || !gRef || !g) return; 
    dagre.layout(g);

    // Clear previous content
    gRef.innerHTML = "";

    // Render nodes
    g.nodes().forEach((v: string) => {
      const node = g.node(v) as NodeData;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute(
        "transform",
        `translate(${node.x! - node.width / 2},${node.y! - node.height / 2})`,
      );

      // Create rectangle
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rect.setAttribute("width", node.width.toString());
      rect.setAttribute("height", node.height.toString());
      rect.setAttribute("rx", "4");
      rect.setAttribute("ry", "4");
      rect.setAttribute("fill", node.fill);
      rect.setAttribute("stroke", node.stroke);
      rect.setAttribute("stroke-width", node.strokeWidth);

      // Create text
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      text.setAttribute("x", (node.width / 2).toString());
      text.setAttribute("y", (node.height / 2).toString());
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("font-size", node.fontSize?.toString() || "12");
      text.setAttribute("font-weight", node.fontWeight || "normal");
      text.textContent = node.label;

      group.appendChild(rect);
      group.appendChild(text);
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
  };

  createEffect(() => {
    renderGraph(g());
  });

  return (
    <div class="resource-tree-visualization">
      <svg ref={svgRef} width="100%" height="400">
        <g ref={gRef} />
      </svg>
    </div>
  );
}
