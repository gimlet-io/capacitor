import { JSX } from "solid-js";
import type { Node } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";

// Helper function to determine node readiness status
function getNodeReadiness(node: Node): { status: string; message: string } {
  if (!node.status.conditions) {
    return { status: "Unknown", message: "No conditions reported" };
  }

  const readyCondition = node.status.conditions.find(
    (condition) => condition.type === "Ready"
  );

  if (!readyCondition) {
    return { status: "Unknown", message: "Ready condition not found" };
  }

  if (readyCondition.status === "True") {
    return { status: "Ready", message: readyCondition.message || "Node is ready" };
  } else {
    return { 
      status: "NotReady", 
      message: readyCondition.message || readyCondition.reason || "Node is not ready" 
    };
  }
}

// Helper function to get node internal IP
function getNodeInternalIP(node: Node): string {
  if (!node.status.addresses) return "Unknown";
  
  const internalIp = node.status.addresses.find(
    (address) => address.type === "InternalIP"
  );
  
  return internalIp ? internalIp.address : "Unknown";
}

// Define the columns for the Node resource list
export const nodeColumns = [
  {
    header: "NAME",
    width: "20%",
    accessor: (node: Node) => <>{node.metadata.name}</>,
    title: (node: Node) => node.metadata.name,
  },
  {
    header: "STATUS",
    width: "15%",
    accessor: (node: Node) => {
      const { status } = getNodeReadiness(node);
      const statusClass = status === "Ready" ? "text-success" : "text-danger";
      return <span class={statusClass}>{status}</span>;
    },
    title: (node: Node) => {
      const { message } = getNodeReadiness(node);
      return message;
    },
  },
  {
    header: "ROLES",
    width: "15%",
    accessor: (node: Node) => {
      const labels = node.metadata.labels || {};
      const roles = [];
      
      // Check for node-role labels according to Kubernetes conventions
      for (const [key, value] of Object.entries(labels)) {
        if (key.startsWith("node-role.kubernetes.io/") && value === "true") {
          roles.push(key.replace("node-role.kubernetes.io/", ""));
        } else if (key.startsWith("kubernetes.io/role") || key.startsWith("node.kubernetes.io/role")) {
          roles.push(value);
        }
      }
      
      // If no roles found, it's likely a worker node
      if (roles.length === 0) {
        roles.push("worker");
      }
      
      return <>{roles.join(", ")}</>;
    },
  },
  {
    header: "VERSION",
    width: "15%",
    accessor: (node: Node) => {
      const version = node.status.nodeInfo?.kubeletVersion || "Unknown";
      return <>{version}</>;
    },
  },
  {
    header: "INTERNAL-IP",
    width: "15%",
    accessor: (node: Node) => {
      return <>{getNodeInternalIP(node)}</>;
    },
  },
  {
    header: "OS",
    width: "10%",
    accessor: (node: Node) => {
      const os = node.status.nodeInfo?.operatingSystem || "Unknown";
      return <>{os}</>;
    },
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (node: Node) => 
      useCalculateAge(node.metadata.creationTimestamp || "")(),
  },
];

// Create filter for node readiness
export const nodeReadinessFilter: Filter = {
  name: "nodeReadiness",
  label: "Status",
  options: [
    { value: "Ready", label: "Ready" },
    { value: "NotReady", label: "Not Ready" },
  ],
  filterFunction: (node: Node, value: string) => {
    const { status } = getNodeReadiness(node);
    return status === value;
  },
};

// Create filter for node roles
export const nodeRoleFilter: Filter = {
  name: "nodeRole",
  label: "Role",
  options: [
    { value: "master", label: "Master" },
    { value: "control-plane", label: "Control Plane" },
    { value: "worker", label: "Worker" },
  ],
  filterFunction: (node: Node, value: string) => {
    const labels = node.metadata.labels || {};
    
    // Check for the role in node labels
    for (const [key, labelValue] of Object.entries(labels)) {
      if (key.startsWith("node-role.kubernetes.io/") && 
          key.replace("node-role.kubernetes.io/", "") === value) {
        return true;
      }
      
      if ((key === "kubernetes.io/role" || key === "node.kubernetes.io/role") && 
          labelValue === value) {
        return true;
      }
    }
    
    // If looking for worker nodes and no role labels found
    if (value === "worker" && 
        !Object.keys(labels).some(key => 
          key.startsWith("node-role.kubernetes.io/") || 
          key === "kubernetes.io/role" || 
          key === "node.kubernetes.io/role")) {
      return true;
    }
    
    return false;
  },
}; 