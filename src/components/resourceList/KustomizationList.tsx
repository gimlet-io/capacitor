import { useNavigate } from "@solidjs/router";
import type { Kustomization } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";

export const kustomizationReadyFilter: Filter = {
  name: "KustomizationReady",
  label: "Ready",
  type: "select",
  options: [
    {
      label: "Ready",
      value: ConditionStatus.True,
      color: "var(--linear-green)",
    },
    {
      label: "Not Ready",
      value: ConditionStatus.False,
      color: "var(--linear-red)",
    },
    {
      label: "Unknown",
      value: ConditionStatus.Unknown,
      color: "var(--linear-text-tertiary)",
    },
    { label: "Suspended", value: "Suspended", color: "var(--linear-blue)" },
  ],
  multiSelect: true,
  filterFunction: (kustomization: Kustomization, value: string) => {
    if (value === "Suspended") {
      if (kustomization.spec.suspend) return true;
      else return false;
    } else {
      const readyCondition = kustomization.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return readyCondition?.status === value;
    }
  },
};

export const renderKustomizationDetails = (kustomization: Kustomization) => (
  <td colSpan={4}>
    <div class="second-row">
      <strong>Source:</strong> {kustomization.spec.sourceRef.name} <br />
      <strong>Path:</strong> {kustomization.spec.path} <br />
      <strong>Prune:</strong> {kustomization.spec.prune ? "True" : "False"}{" "}
      <br />
      <strong>Suspended:</strong>{" "}
      {kustomization.spec.suspend ? "True" : "False"} <br />
      <strong>Interval:</strong> {kustomization.spec.interval}
    </div>
  </td>
);

export const handleReconcile = async (kustomization: Kustomization) => {
  try {
    const response = await fetch("/api/flux/reconcile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "kustomization",
        name: kustomization.metadata.name,
        namespace: kustomization.metadata.namespace,
      }),
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to reconcile: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error reconciling resource:", error);
  }
};

export const kustomizationColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (kustomization: Kustomization) => (
      <>{kustomization.metadata.name}</>
    ),
    title: (kustomization: Kustomization) => kustomization.metadata.name,
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (kustomization: Kustomization) =>
      useCalculateAge(kustomization.metadata.creationTimestamp || "")(),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (kustomization: Kustomization) => {
      const readyCondition = kustomization.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const reconcilingCondition = kustomization.status?.conditions?.find((c) =>
        c.type === ConditionType.Reconciling
      );

      return (
        <div class="status-badges">
          {readyCondition?.status === ConditionStatus.True && (
            <span class="status-badge ready">Ready</span>
          )}
          {readyCondition?.status === ConditionStatus.False && (
            <span class="status-badge not-ready">NotReady</span>
          )}
          {reconcilingCondition?.status === ConditionStatus.True && (
            <span class="status-badge reconciling">Reconciling</span>
          )}
          {kustomization.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (kustomization: Kustomization) => {
      const readyCondition = kustomization.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
];
