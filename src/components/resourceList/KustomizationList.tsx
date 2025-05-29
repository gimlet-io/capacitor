import type { Kustomization } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";

export const renderKustomizationDetails = (kustomization: Kustomization, columnCount = 4) => (
  <td colSpan={columnCount}>
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
