import { JSX } from "solid-js";
import type { DaemonSet } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Helper function to determine readiness status
function getReadinessComponent(daemonSet: DaemonSet): { element: JSX.Element, title: string } {
  const desiredScheduled = daemonSet.status.desiredNumberScheduled;
  const currentScheduled = daemonSet.status.currentNumberScheduled;
  const numberReady = daemonSet.status.numberReady;
  const numberAvailable = daemonSet.status.numberAvailable || 0;
  const numberUnavailable = daemonSet.status.numberUnavailable || 0;
  
  const isReady = numberReady === desiredScheduled && numberUnavailable === 0;
  const statusClass = isReady ? "text-success" : "text-warning";
  
  return {
    element: (
      <span class={statusClass}>
        {numberReady}/{desiredScheduled}
      </span>
    ),
    title: `Ready: ${numberReady}/${desiredScheduled}, Available: ${numberAvailable}, Unavailable: ${numberUnavailable}`
  };
}

// Define the columns for the DaemonSet resource list
export const daemonSetColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (daemonSet: DaemonSet) => <>{daemonSet.metadata.name}</>,
    title: (daemonSet: DaemonSet) => daemonSet.metadata.name,
  },
  {
    header: "DESIRED",
    width: "10%",
    accessor: (daemonSet: DaemonSet) => <>{daemonSet.status.desiredNumberScheduled}</>,
  },
  {
    header: "CURRENT",
    width: "10%",
    accessor: (daemonSet: DaemonSet) => <>{daemonSet.status.currentNumberScheduled}</>,
  },
  {
    header: "READY",
    width: "10%",
    accessor: (daemonSet: DaemonSet) => getReadinessComponent(daemonSet).element,
    title: (daemonSet: DaemonSet) => getReadinessComponent(daemonSet).title,
  },
  {
    header: "UP-TO-DATE",
    width: "10%",
    accessor: (daemonSet: DaemonSet) => <>{daemonSet.status.updatedNumberScheduled || 0}</>,
  },
  {
    header: "AVAILABLE",
    width: "10%",
    accessor: (daemonSet: DaemonSet) => <>{daemonSet.status.numberAvailable || 0}</>,
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (daemonSet: DaemonSet) => {
      if (!daemonSet.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(daemonSet.metadata.creationTimestamp);
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

// Filter for DaemonSet based on readiness
export const daemonSetReadinessFilter: Filter = {
  name: "daemonSetReadiness",
  label: "Status",
  options: [
    { value: "ready", label: "Ready" },
    { value: "notReady", label: "Not Ready" },
  ],
  filterFunction: (daemonSet: DaemonSet, value: string) => {
    const desiredScheduled = daemonSet.status.desiredNumberScheduled;
    const numberReady = daemonSet.status.numberReady;
    const numberUnavailable = daemonSet.status.numberUnavailable || 0;
    
    const isReady = numberReady === desiredScheduled && numberUnavailable === 0;
    
    return (value === "ready" && isReady) || (value === "notReady" && !isReady);
  },
}; 