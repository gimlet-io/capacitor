import { JSX } from "solid-js";
import type { Namespace } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Helper function to determine namespace status with appropriate styling
function getNamespaceStatusComponent(namespace: Namespace): { element: JSX.Element, title: string } {
  const phase = namespace.status?.phase || "Active";
  
  let statusClass = "";
  switch (phase) {
    case "Active":
      statusClass = "text-success";
      break;
    case "Terminating":
      statusClass = "text-warning";
      break;
    default:
      statusClass = "text-secondary";
  }
  
  return {
    element: <span class={statusClass}>{phase}</span>,
    title: `Status: ${phase}`
  };
}

// Define the columns for the Namespace resource list
export const namespaceColumns = [
  {
    header: "NAME",
    width: "40%",
    accessor: (namespace: Namespace) => <>{namespace.metadata.name}</>,
    title: (namespace: Namespace) => namespace.metadata.name,
  },
  {
    header: "STATUS",
    width: "20%",
    accessor: (namespace: Namespace) => getNamespaceStatusComponent(namespace).element,
    title: (namespace: Namespace) => getNamespaceStatusComponent(namespace).title,
  },
  {
    header: "AGE",
    width: "40%",
    accessor: (namespace: Namespace) => {
      if (!namespace.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(namespace.metadata.creationTimestamp);
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
    },
  },
];

// Filter for Namespace based on its status phase
export const namespaceStatusFilter: Filter = {
  name: "namespaceStatus",
  label: "Status",
  options: [
    { value: "Active", label: "Active" },
    { value: "Terminating", label: "Terminating" },
  ],
  filterFunction: (namespace: Namespace, value: string) => {
    const phase = namespace.status?.phase || "Active";
    return phase === value;
  },
}; 