import type { HelmChart } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";

export const renderHelmChartDetails = (helmChart: HelmChart, columnCount = 4) => (
  <td colSpan={columnCount}>
    <div class="second-row">
      <strong>Chart:</strong> {helmChart.spec.chart} <br />
      <strong>Source Ref:</strong> {helmChart.spec.sourceRef.kind}/{helmChart.spec.sourceRef.name} <br />
      {helmChart.spec.valuesFiles && helmChart.spec.valuesFiles.length > 0 && (
        <>
          <strong>Values Files:</strong> {helmChart.spec.valuesFiles.join(", ")} <br />
        </>
      )}
      <strong>Interval:</strong> {helmChart.spec.interval} <br />
      <strong>Suspended:</strong>{" "}
      {helmChart.spec.suspend ? "True" : "False"}
    </div>
  </td>
);

export const helmChartColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (helmChart: HelmChart) => (
      <>{helmChart.metadata.name}</>
    ),
    title: (helmChart: HelmChart) => helmChart.metadata.name,
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (helmChart: HelmChart) =>
      useCalculateAge(helmChart.metadata.creationTimestamp || "")(),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (helmChart: HelmChart) => {
      const readyCondition = helmChart.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const artifactCondition = helmChart.status?.conditions?.find((c) =>
        c.type === "ArtifactInStorage"
      );

      return (
        <div class="status-badges">
          {readyCondition?.status === ConditionStatus.True && (
            <span class="status-badge ready">Ready</span>
          )}
          {readyCondition?.status === ConditionStatus.False && (
            <span class="status-badge not-ready">NotReady</span>
          )}
          {artifactCondition?.status === ConditionStatus.True && (
            <span class="status-badge artifact">Packaged</span>
          )}
          {helmChart.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (helmChart: HelmChart) => {
      const readyCondition = helmChart.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
];