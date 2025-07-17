import { JSX } from "solid-js";
import type { PersistentVolumeClaim } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

// Helper function to determine PVC status with appropriate styling
function getPVCStatusComponent(pvc: PersistentVolumeClaim): { element: JSX.Element, title: string } {
  const phase = pvc.status?.phase || "Unknown";
  
  let statusClass = "";
  switch (phase) {
    case "Bound":
      statusClass = "text-success";
      break;
    case "Pending":
      statusClass = "text-warning";
      break;
    case "Lost":
      statusClass = "text-danger";
      break;
    default:
      statusClass = "text-secondary";
  }
  
  return {
    element: <span class={statusClass}>{phase}</span>,
    title: `Status: ${phase}`
  };
}

// Define the columns for the PersistentVolumeClaim resource list
export const pvcColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (pvc: PersistentVolumeClaim) => <>{pvc.metadata.name}</>,
    title: (pvc: PersistentVolumeClaim) => pvc.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "STATUS",
    width: "7%",
    accessor: (pvc: PersistentVolumeClaim) => getPVCStatusComponent(pvc).element,
    title: (pvc: PersistentVolumeClaim) => getPVCStatusComponent(pvc).title,
  },
  {
    header: "VOLUME",
    width: "21%",
    accessor: (pvc: PersistentVolumeClaim) => <>{pvc.spec.volumeName || "-"}</>,
  },
  {
    header: "CAPACITY",
    width: "7%",
    accessor: (pvc: PersistentVolumeClaim) => {
      // First try to get actual capacity from status (which is set when bound)
      const capacity = pvc.status?.capacity?.storage || pvc.spec.resources?.requests?.storage || "-";
      return <>{capacity}</>;
    },
    title: (pvc: PersistentVolumeClaim) => {
      const capacity = pvc.status?.capacity?.storage || pvc.spec.resources?.requests?.storage || "Unknown";
      return `Storage capacity: ${capacity}`;
    },
  },
  {
    header: "ACCESS MODES",
    width: "10%",
    accessor: (pvc: PersistentVolumeClaim) => {
      const accessModes = pvc.status?.accessModes || pvc.spec.accessModes || [];
      return <>{accessModes.join(", ") || "-"}</>;
    },
    title: (pvc: PersistentVolumeClaim) => {
      const accessModes = pvc.status?.accessModes || pvc.spec.accessModes || [];
      return accessModes.join(", ") || "No access modes specified";
    },
  },
  {
    header: "STORAGE CLASS",
    width: "15%",
    accessor: (pvc: PersistentVolumeClaim) => <>{pvc.spec.storageClassName || "-"}</>,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (pvc: PersistentVolumeClaim) => 
      useCalculateAge(pvc.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];

// Filter for PVC based on its status phase
export const pvcStatusFilter: Filter = {
  name: "pvcStatus",
  label: "Status",
  options: [
    { value: "Bound", label: "Bound" },
    { value: "Pending", label: "Pending" },
    { value: "Lost", label: "Lost" },
  ],
  filterFunction: (pvc: PersistentVolumeClaim, value: string) => {
    const phase = pvc.status?.phase || "Unknown";
    return phase === value;
  },
};

// Filter for PVC based on its storage class
export const pvcStorageClassFilter: Filter = {
  name: "pvcStorageClass",
  label: "Storage Class",
  options: [], // Will be populated dynamically based on available storage classes
  multiSelect: true,
  filterFunction: (pvc: PersistentVolumeClaim, value: string) => {
    const storageClass = pvc.spec.storageClassName || "";
    return storageClass === value;
  },
}; 