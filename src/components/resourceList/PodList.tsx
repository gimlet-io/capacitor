import type { Pod } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from './timeUtils.ts';
import { createSignal } from "solid-js";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

// Create a signal for node options that can be updated externally
const [nodeOptions, setNodeOptions] = createSignal<{value: string, label: string}[]>([]);

// Export the setter so the dashboard can update the options
export { setNodeOptions };

export const podsStatusFilter: Filter = {
  name: "PodStatus",
  label: "Status",
  type: "select",
  options: [
    { label: "Running", value: "Running", color: "var(--linear-green)" },
    { label: "Pending", value: "Pending", color: "var(--linear-yellow)" },
    { label: "Succeeded", value: "Succeeded", color: "var(--linear-blue)" },
    { label: "Failed", value: "Failed", color: "var(--linear-red)" },
    { label: "Terminating", value: "Terminating", color: "var(--linear-orange)" },
    {
      label: "Unknown",
      value: "Unknown",
      color: "var(--linear-text-tertiary)",
    },
  ],
  multiSelect: true,
  filterFunction: (pod: Pod, value: string): boolean => {
    // For filtering, we'll use a simpler approach based primarily on phase
    if (pod.status.phase === value) {
      return true;
    }
    
    // Special case for Terminating
    if (value === "Terminating" && Boolean(pod.metadata.deletionTimestamp)) {
      return true;
    }
    
    return false;
  },
};

export const podsReadinessFilter: Filter = {
  name: "PodReadiness",
  label: "Readiness",
  type: "select",
  options: [
    { label: "Ready", value: "Ready", color: "var(--linear-green)" },
    { label: "Not Ready", value: "notReady", color: "var(--linear-red)" },
  ],
  multiSelect: true,
  filterFunction: (pod: Pod, value: string): boolean => {
    if (value === "notReady") {
      // Check if any container is not ready
      const containerStatuses = pod.status?.containerStatuses || [];
      const totalContainers = pod.spec?.containers.length;
      const readyContainers = containerStatuses.filter(cs => cs.ready).length;
      
      return readyContainers < totalContainers;
    }
    return true;
  },
};

export const podsNodeFilter: Filter = {
  name: "PodNode",
  label: "Node",
  type: "select",
  get options() {
    return nodeOptions();
  },
  multiSelect: true,
  searchable: true,
  filterFunction: (pod: Pod, value: string): boolean => {
    return pod.spec.nodeName === value;
  },
};

export const podColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (pod: Pod) => <>{pod.metadata.name}</>,
    title: (pod: Pod) => `${pod.metadata.name}`,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "READY",
    width: "8%",
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
      let statusText = phase;

      // Special case for Terminating
      if (pod.metadata.deletionTimestamp) {
        return <span style={`color: var(--linear-orange); font-weight: 500;`}>Terminating</span>;
      }
      
      // Check for pod-level reasons
      if (pod.status.reason === "Evicted") {
        return <span style={`color: var(--linear-red); font-weight: 500;`}>Evicted</span>;
      }
      
      // Check for container-level issues
      const containerStatuses = pod.status.containerStatuses || [];
      for (const status of containerStatuses) {
        if (status.state?.waiting?.reason === "CrashLoopBackOff") {
          return <span style={`color: var(--linear-red); font-weight: 500;`}>CrashLoopBackOff</span>;
        }
        if (status.state?.waiting?.reason === "ImagePullBackOff" || status.state?.waiting?.reason === "ErrImagePull") {
          return <span style={`color: var(--linear-red); font-weight: 500;`}>ImagePullBackOff</span>;
        }
        if (status.state?.waiting?.reason === "CreateContainerConfigError") {
          return <span style={`color: var(--linear-red); font-weight: 500;`}>ConfigError</span>;
        }
        if (status.state?.waiting?.reason === "ContainerCreating") {
          return <span style={`color: var(--linear-yellow); font-weight: 500;`}>ContainerCreating</span>;
        }
        // Check for OOM killed containers
        if (status.state?.terminated?.reason === "OOMKilled") {
          return <span style={`color: var(--linear-red); font-weight: 500;`}>OOMKilled</span>;
        }
        // Check for Error terminated containers
        if (status.state?.terminated?.exitCode !== 0 && status.state?.terminated?.reason === "Error") {
          return <span style={`color: var(--linear-red); font-weight: 500;`}>Error</span>;
        }
      }
      
      // Check for init container issues
      const initContainerStatuses = pod.status.initContainerStatuses || [];
      if (phase === "Pending" && initContainerStatuses.length > 0) {
        for (const status of initContainerStatuses) {
          if (status.state?.waiting?.reason === "PodInitializing") {
            return <span style={`color: var(--linear-yellow); font-weight: 500;`}>Initializing</span>;
          }
          if (status.state?.waiting?.reason === "CrashLoopBackOff") {
            return <span style={`color: var(--linear-red); font-weight: 500;`}>Init:CrashLoopBackOff</span>;
          }
          if (status.state?.waiting?.reason === "ImagePullBackOff" || status.state?.waiting?.reason === "ErrImagePull") {
            return <span style={`color: var(--linear-red); font-weight: 500;`}>Init:ImagePullBackOff</span>;
          }
          if (status.state?.terminated?.exitCode !== 0) {
            return <span style={`color: var(--linear-red); font-weight: 500;`}>Init:Error</span>;
          }
        }
        return <span style={`color: var(--linear-yellow); font-weight: 500;`}>Init:{initContainerStatuses.filter(s => s.ready).length}/{initContainerStatuses.length}</span>;
      }
      
      // Check for not ready conditions when phase is Running
      if (phase === "Running") {
        const notReadyContainers = containerStatuses.filter(cs => !cs.ready);
        if (notReadyContainers.length > 0) {
          // Look for specific readiness problems
          for (const container of notReadyContainers) {
            if (container.state?.waiting) {
              statusText = "NotReady:" + container.state.waiting.reason;
              return <span style={`color: var(--linear-yellow); font-weight: 500;`}>{statusText}</span>;
            }
          }
          return <span style={`color: var(--linear-yellow); font-weight: 500;`}>NotReady</span>;
        }
      }
      
      // Check for node-level issues
      if (phase === "Unknown") {
        const conditions = pod.status.conditions || [];
        const readyCondition = conditions.find(c => c.type === "Ready");
        if (readyCondition?.reason === "NodeLost") {
          return <span style={`color: var(--linear-red); font-weight: 500;`}>NodeLost</span>;
        }
      }

      // Handle resource-related issues from pod conditions
      const conditions = pod.status.conditions || [];
      for (const condition of conditions) {
        if (condition.type === "PodScheduled" && condition.status === "False") {
          if (condition.reason === "Unschedulable") {
            return <span style={`color: var(--linear-yellow); font-weight: 500;`} title={condition.message}>Unschedulable</span>;
          }
        }
      }

      // Standard phase colors
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

      return <span style={`color: ${color}; font-weight: 500;`}>{statusText}</span>;
    },
  },
  {
    header: "RESTARTS",
    width: "8%",
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
    accessor: (pod: Pod) => useCalculateAge(pod.metadata.creationTimestamp || '')(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "IP",
    width: "15%",
    accessor: (pod: Pod) => <>{pod.status.podIP}</>,
  },
  {
    header: "NODE",
    width: "19%",
    accessor: (pod: Pod) => (
      <span
        style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" 
        title={pod.spec.nodeName}
      >
        {pod.spec.nodeName}
      </span>
    ),
  },
];
