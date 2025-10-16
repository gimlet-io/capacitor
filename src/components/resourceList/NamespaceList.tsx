// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { JSX } from "solid-js";
import type { Namespace } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

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
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "STATUS",
    width: "20%",
    accessor: (namespace: Namespace) => getNamespaceStatusComponent(namespace).element,
    title: (namespace: Namespace) => getNamespaceStatusComponent(namespace).title,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (namespace: Namespace) => 
      useCalculateAge(namespace.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
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