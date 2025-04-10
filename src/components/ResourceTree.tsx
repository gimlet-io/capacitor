import { createEffect, onMount } from "solid-js";
import type { KustomizationWithInventory } from "../types/k8s.ts";
import * as dagre from "dagre";
import * as graphlib from "graphlib";

interface ResourceTreeProps {
  kustomization: KustomizationWithInventory;
}

interface NodeData {
  label: string;
  width: number;
  height: number;
  type: "kustomization" | "deployment" | "replicaset" | "pod" | "service";
  status?: boolean | string;
  x?: number;
  y?: number;
}

interface EdgeData {
  points: Array<{ x: number; y: number }>;
}

export function ResourceTree(props: ResourceTreeProps) {
  let svgRef: SVGSVGElement | undefined;
  let gRef: SVGGElement | undefined;

  const createGraph = () => {
    const g = new graphlib.Graph({ directed: true });
    g.setGraph({
      rankdir: "LR",
      nodesep: 100,
      ranksep: 80,
      marginx: 20,
      marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add Kustomization as root node
    const kustomizationId = `kustomization-${props.kustomization.metadata.name}`;
    g.setNode(kustomizationId, {
      label: `Kustomization: ${props.kustomization.metadata.name}`,
      width: 180,
      height: 50,
      type: "kustomization",
      status: props.kustomization.status?.conditions?.some(c => c.type === "Ready" && c.status === "True"),
    });

    // Add nodes and edges for deployments
    props.kustomization.inventoryItems.deployments.forEach((deployment) => {
      const deploymentId = `deployment-${deployment.metadata.name}`;
      g.setNode(deploymentId, {
        label: `Deployment: ${deployment.metadata.name}`,
        width: 160,
        height: 40,
        type: "deployment",
        status: deployment.status.availableReplicas === deployment.status.replicas,
      });
      g.setEdge(kustomizationId, deploymentId);

      // Add replica sets
      deployment.replicaSets.forEach((replicaSet) => {
        const rsId = `replicaset-${replicaSet.metadata.name}`;
        g.setNode(rsId, {
          label: `ReplicaSet: ${replicaSet.metadata.name}`,
          width: 140,
          height: 35,
          type: "replicaset",
        });
        g.setEdge(deploymentId, rsId);

        // Add pods
        replicaSet.pods.forEach((pod) => {
          const podId = `pod-${pod.metadata.name}`;
          g.setNode(podId, {
            label: `Pod: ${pod.metadata.name}`,
            width: 120,
            height: 30,
            type: "pod",
            status: pod.status.phase,
          });
          g.setEdge(rsId, podId);
        });
      });
    });

    // Add nodes for services
    props.kustomization.inventoryItems.services.forEach((service) => {
      const serviceId = `service-${service.metadata.name}`;
      g.setNode(serviceId, {
        label: `Service: ${service.metadata.name}`,
        width: 160,
        height: 40,
        type: "service",
      });
      g.setEdge(kustomizationId, serviceId);
    });

    return g;
  };

  const renderGraph = () => {
    if (!svgRef || !gRef) return;

    const g = createGraph();
    dagre.layout(g);

    // Clear previous content
    gRef.innerHTML = "";

    // Render nodes
    g.nodes().forEach((v: string) => {
      const node = g.node(v) as NodeData;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("transform", `translate(${node.x! - node.width / 2},${node.y! - node.height / 2})`);

      // Create rectangle
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", node.width.toString());
      rect.setAttribute("height", node.height.toString());
      rect.setAttribute("rx", "4");
      rect.setAttribute("ry", "4");
      
      // Set colors based on type and status
      if (node.type === "kustomization") {
        rect.setAttribute("fill", node.status ? "#e6f4ea" : "#fce8e6");
        rect.setAttribute("stroke", node.status ? "#137333" : "#c5221f");
        rect.setAttribute("stroke-width", "2");
      } else if (node.type === "deployment") {
        rect.setAttribute("fill", node.status ? "#e6f4ea" : "#fce8e6");
        rect.setAttribute("stroke", node.status ? "#137333" : "#c5221f");
      } else if (node.type === "replicaset") {
        rect.setAttribute("fill", "#e8f0fe");
        rect.setAttribute("stroke", "#1a73e8");
      } else if (node.type === "pod") {
        rect.setAttribute("fill", "#fff");
        rect.setAttribute("stroke", "#666");
      } else if (node.type === "service") {
        rect.setAttribute("fill", "#e6f4ea");
        rect.setAttribute("stroke", "#137333");
      }

      // Create text
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", (node.width / 2).toString());
      text.setAttribute("y", (node.height / 2).toString());
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("font-size", node.type === "kustomization" ? "14" : "12");
      text.setAttribute("font-weight", node.type === "kustomization" ? "bold" : "normal");
      text.textContent = node.label;

      group.appendChild(rect);
      group.appendChild(text);
      gRef?.appendChild(group);
    });

    // Render edges
    g.edges().forEach((e: graphlib.Edge) => {
      const edge = g.edge(e) as EdgeData;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edge.points.map((p: { x: number; y: number }, i: number) => 
        i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
      ).join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#666");
      path.setAttribute("stroke-width", "1");
      gRef?.appendChild(path);
    });
  };

  onMount(() => {
    renderGraph();
  });

  createEffect(() => {
    renderGraph();
  });

  return (
    <div class="resource-tree-visualization">
      <svg ref={svgRef} width="100%" height="400">
        <g ref={gRef} />
      </svg>
    </div>
  );
} 