import type { Pod } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

export const podsStatusFilter: Filter = {
  name: "PodStatus",
  type: "select",
  options: [
    { label: "Running", value: "Running", color: "var(--linear-green)" },
    { label: "Pending", value: "Pending", color: "var(--linear-yellow)" },
    { label: "Succeeded", value: "Succeeded", color: "var(--linear-blue)" },
    { label: "Failed", value: "Failed", color: "var(--linear-red)" },
    {
      label: "Unknown",
      value: "Unknown",
      color: "var(--linear-text-tertiary)",
    },
  ],
  multiSelect: true,
  filterFunction: (pod: Pod, value: string) => {
    return pod.status.phase === value;
  },
};

export const podColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (pod: Pod) => <>{pod.metadata.namespace}/{pod.metadata.name}</>,
    title: (pod: Pod) => `${pod.metadata.namespace}/${pod.metadata.name}`,
  },
  {
    header: "READY",
    width: "10%",
    accessor: (pod: Pod) => (
      <>
        {pod.status.containerStatuses?.filter((cs) => cs.ready).length ||
          0}/{pod.spec.containers.length}
      </>
    ),
  },
  {
    header: "STATUS",
    width: "10%",
    accessor: (pod: Pod) => {
      const phase = pod.status.phase;
      let color = "";

      switch (phase) {
        case "Running":
          color = "var(--linear-green)";
          break;
        case "Pending":
          color = "var(--linear-yellow)";
          break;
        case "Succeeded":
          color = "var(--linear-blue)";
          break;
        case "Failed":
          color = "var(--linear-red)";
          break;
        default:
          color = "var(--linear-text-tertiary)";
      }

      return <span style={`color: ${color}; font-weight: 500;`}>{phase}</span>;
    },
  },
  {
    header: "RESTARTS",
    width: "10%",
    accessor: (pod: Pod) => (
      <>
        {pod.status.containerStatuses?.reduce(
          (acc, cs) => acc + (cs.restartCount || 0),
          0,
        ) || 0}
      </>
    ),
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (pod: Pod) => {
      if (!pod.status.startTime) return <>N/A</>;
      const startTime = new Date(pod.status.startTime);
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        return <>{`${days}d${hours}h`}</>;
      } else if (hours > 0) {
        return <>{`${hours}h${minutes}m`}</>;
      } else {
        return <>{`${minutes}m`}</>;
      }
    },
  },
  {
    header: "IP",
    width: "15%",
    accessor: (pod: Pod) => <>{pod.status.podIP}</>,
  },
  {
    header: "NODE",
    width: "15%",
    accessor: (pod: Pod) => <>{pod.spec.nodeName}</>,
  },
];
