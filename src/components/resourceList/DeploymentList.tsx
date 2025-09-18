import type { DeploymentWithResources, ObjectMeta } from "../../types/k8s.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

export const deploymentReadinessFilter: Filter = {
  name: "DeploymentReadiness",
  label: "Readiness",
  type: "select",
  options: [
    { label: "Ready", value: "Ready", color: "var(--linear-green)" },
    { label: "Not Ready", value: "notReady", color: "var(--linear-red)" },
  ],
  multiSelect: true,
  filterFunction: (deployment: DeploymentWithResources, value: string): boolean => {
    if (value === "notReady") {
      // Check if desired replicas don't match ready replicas
      return (deployment.spec.replicas !== (deployment.status.readyReplicas || 0));
    }
    return true;
  },
};

const getPodColor = (status: string) => {
  switch (status) {
    case "Running":
      return "var(--linear-green)";
    case "Pending":
      return "var(--linear-yellow)";
    case "Failed":
      return "var(--linear-red)";
    default:
      return "var(--linear-gray)";
  }
};

export const scaleResource = async (
  kind: string,
  metadata: ObjectMeta,
  replicas: number,
  contextName: string,
) => {
  try {
    const ctxName = encodeURIComponent(contextName);
    const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
    const response = await fetch(`${apiPrefix}/scale`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: kind,
        name: metadata.name,
        namespace: metadata.namespace,
        replicas: replicas,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to scale: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error scaling:", error);
    throw error;
  }
};

export const handleScale = (resource: any, contextName?: string) => {
  if (!resource || !resource.metadata) return;
  if (!contextName) {
    throw new Error('No Kubernetes context selected');
  }
  const currentReplicas = resource.spec?.replicas || '0';
  const input = globalThis.prompt(
    `Enter desired number of replicas for ${resource.kind} "${resource.metadata.name}":`,
    currentReplicas.toString()
  );
  if (input === null) return;
  const replicas = parseInt(input, 10);
  if (isNaN(replicas) || replicas < 0) {
    globalThis.alert("Please enter a valid non-negative number");
    return;
  }
  return scaleResource(resource.kind, resource.metadata, replicas, contextName);
};

export const rolloutRestart = async (
  kind: string,
  metadata: ObjectMeta,
  contextName: string,
) => {
  try {
    const ctxName = encodeURIComponent(contextName);
    const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
    const response = await fetch(`${apiPrefix}/rollout-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: kind,
        name: metadata.name,
        namespace: metadata.namespace,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to restart rollout: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error restarting rollout:", error);
    throw error;
  }
};

export const handleRolloutRestart = (resource: any, contextName?: string) => {
  if (!resource || !resource.metadata) return;
  if (!contextName) {
    throw new Error('No Kubernetes context selected');
  }

  const confirmed = globalThis.confirm(
    `Are you sure you want to restart the rollout for ${resource.kind} "${resource.metadata.name}"?`
  );
  if (!confirmed) return;
  return rolloutRestart(resource.kind, resource.metadata, contextName);
};

export const deploymentColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (deployment: DeploymentWithResources) => (
      <>{deployment.metadata.name}</>
    ),
    title: (deployment: DeploymentWithResources) => deployment.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "READY",
    width: "10%",
    accessor: (deployment: DeploymentWithResources) => (
      <>{deployment.status.readyReplicas || 0}/{deployment.spec.replicas}</>
    ),
  },
  {
    header: "PODS",
    width: "10%",
    accessor: (deployment: DeploymentWithResources) => (
      <>
        {deployment.pods?.map((pod) => (
          <span
            title={pod.metadata.name}
            style={{
              "display": "inline-block",
              "width": "10px",
              "height": "10px",
              "border-radius": "5%",
              "background-color": getPodColor(pod.status.phase),
              "margin": "0 2px",
            } as any}
          >
          </span>
        ))}
      </>
    ),
  },
  {
    header: "UP-TO-DATE",
    width: "10%",
    accessor: (deployment: DeploymentWithResources) => (
      <>{deployment.status.updatedReplicas || 0}</>
    ),
  },
  {
    header: "AVAILABLE",
    width: "10%",
    accessor: (deployment: DeploymentWithResources) => (
      <>{deployment.status.availableReplicas || 0}</>
    ),
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (deployment: DeploymentWithResources) =>
      useCalculateAge(deployment.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];
