import { JSX } from "solid-js";
import type { PersistentVolume } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../resourceTypeConfigs.tsx';

// Helper function to determine PV status with appropriate styling
function getPVStatusComponent(pv: PersistentVolume): { element: JSX.Element, title: string } {
  const phase = pv.status?.phase || "Unknown";
  
  let statusClass = "";
  switch (phase) {
    case "Available":
      statusClass = "text-success";
      break;
    case "Bound":
      statusClass = "text-info";
      break;
    case "Released":
      statusClass = "text-warning";
      break;
    case "Failed":
      statusClass = "text-danger";
      break;
    default:
      statusClass = "text-secondary";
  }
  
  return {
    element: <span class={statusClass}>{phase}</span>,
    title: `Status: ${phase}${pv.status?.message ? ` - ${pv.status.message}` : ''}`
  };
}

// Define the columns for the PersistentVolume resource list
export const pvColumns = [
  {
    header: "NAME",
    width: "26%",
    accessor: (pv: PersistentVolume) => <>{pv.metadata.name}</>,
    title: (pv: PersistentVolume) => pv.metadata.name,
    sortable: true,
    sortFunction: sortByName,
  },
  {
    header: "CAPACITY",
    width: "7%",
    accessor: (pv: PersistentVolume) => {
      const capacity = pv.spec.capacity?.storage || "-";
      return <>{capacity}</>;
    },
  },
  {
    header: "ACCESS MODES",
    width: "15%",
    accessor: (pv: PersistentVolume) => {
      const accessModes = pv.spec.accessModes || [];
      return <>{accessModes.join(", ") || "-"}</>;
    },
    title: (pv: PersistentVolume) => {
      const accessModes = pv.spec.accessModes || [];
      return accessModes.join(", ") || "No access modes specified";
    },
  },
  {
    header: "RECLAIM POLICY",
    width: "15%",
    accessor: (pv: PersistentVolume) => <>{pv.spec.persistentVolumeReclaimPolicy || "Delete"}</>,
  },
  {
    header: "STATUS",
    width: "7%",
    accessor: (pv: PersistentVolume) => getPVStatusComponent(pv).element,
    title: (pv: PersistentVolume) => getPVStatusComponent(pv).title,
  },
  {
    header: "CLAIM",
    width: "20%",
    accessor: (pv: PersistentVolume) => {
      if (!pv.spec.claimRef) return <>-</>;
      
      const namespace = pv.spec.claimRef.namespace || "";
      const name = pv.spec.claimRef.name || "";
      
      if (!namespace || !name) return <>-</>;
      
      return <>{namespace}/{name}</>;
    },
    title: (pv: PersistentVolume) => {
      if (!pv.spec.claimRef) return "No claim";
      
      const namespace = pv.spec.claimRef.namespace || "";
      const name = pv.spec.claimRef.name || "";
      
      if (!namespace || !name) return "No claim";
      
      return `${namespace}/${name}`;
    },
  },
  {
    header: "STORAGE CLASS",
    width: "10%",
    accessor: (pv: PersistentVolume) => <>{pv.spec.storageClassName || "-"}</>,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (pv: PersistentVolume) => 
      useCalculateAge(pv.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: sortByAge,
  },
];

// Filter for PV based on its status phase
export const pvPhaseFilter: Filter = {
  name: "pvPhase",
  label: "Status",
  options: [
    { value: "Available", label: "Available" },
    { value: "Bound", label: "Bound" },
    { value: "Released", label: "Released" },
    { value: "Failed", label: "Failed" },
  ],
  filterFunction: (pv: PersistentVolume, value: string) => {
    const phase = pv.status?.phase || "Unknown";
    return phase === value;
  },
};

// Filter for PV based on reclaim policy
export const pvReclaimPolicyFilter: Filter = {
  name: "pvReclaimPolicy",
  label: "Reclaim Policy",
  options: [
    { value: "Delete", label: "Delete" },
    { value: "Retain", label: "Retain" },
    { value: "Recycle", label: "Recycle" },
  ],
  filterFunction: (pv: PersistentVolume, value: string) => {
    const policy = pv.spec.persistentVolumeReclaimPolicy || "Delete";
    return policy === value;
  },
}; 