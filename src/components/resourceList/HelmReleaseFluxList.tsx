import type { HelmRelease } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";

export const renderHelmReleaseFluxDetails = (helmRelease: HelmRelease, columnCount = 4) => (
  <DetailRowCard columnCount={columnCount}>
    <div style="display: contents;">
      <strong>Chart:</strong> {helmRelease.spec?.chart.spec.chart} <br />
      <strong>Source Ref:</strong> {helmRelease.spec?.chart.spec.sourceRef.kind}/{helmRelease.spec?.chart.spec.sourceRef.name} <br />
      <strong>Version:</strong> {helmRelease.spec?.chart.spec.version} <br />
      <strong>Release Name:</strong> {helmRelease.spec?.releaseName} <br />
      <strong>Target Namespace:</strong> {helmRelease.spec?.targetNamespace} <br />
      <strong>Interval:</strong> {helmRelease.spec?.interval} <br />
      <strong>Suspended:</strong>
      {helmRelease.spec && (
        <>
          {helmRelease.spec.suspend ? " True" : " False"} <br />
        </>
      )}
    </div>
  </DetailRowCard>
);

export const helmReleaseFluxColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (helmRelease: HelmRelease) => (
      <>{helmRelease.metadata.name}</>
    ),
    title: (helmRelease: HelmRelease) => helmRelease.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (helmRelease: HelmRelease) =>
      useCalculateAge(helmRelease.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (helmRelease: HelmRelease) => {
      const readyCondition = helmRelease.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const reconcilingCondition = helmRelease.status?.conditions?.find((c) =>
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
          {helmRelease.spec?.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (helmRelease: HelmRelease) => {
      const readyCondition = helmRelease.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
];