// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { HelmRelease, Event } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";
import { StatusBadges } from "./KustomizationList.tsx";

export const renderHelmReleaseFluxDetails = (helmRelease: HelmRelease & { events?: Event[] }, columnCount = 4) => {
  const chartName = helmRelease.spec?.chart?.spec?.chart;
  const src = helmRelease.spec?.chartRef || helmRelease.spec?.chart?.spec?.sourceRef;
  const version = helmRelease.spec?.chart?.spec?.version;
  
  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="display: contents;">
        <div>
          {chartName && (
            <>
              <strong>Chart:</strong> {chartName} <br />
            </>
          )}
          <strong>Source Ref:</strong> {src ? `${src.kind}${src.namespace ? `/${src.namespace}` : ''}/${src.name}` : 'N/A'} <br />
          {version && (
            <>
              <strong>Version:</strong> {version} <br />
            </>
          )}
          <strong>Release Name:</strong> {helmRelease.spec?.releaseName} <br />
          <strong>Target Namespace:</strong> {helmRelease.spec?.targetNamespace} <br />
        </div>
        <div>
          <ul>
            {helmRelease.events?.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
              <li><span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: <span>{(() => { const m = (event.message || '').replace(/[\r\n]+/g, ' '); return m.length > 300 ? m.slice(0, 300) + '…' : m; })()}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </DetailRowCard>
  );
};

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
      return StatusBadges(helmRelease as unknown as any);
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (helmRelease: HelmRelease) => {
      const readyCondition = helmRelease.status?.conditions?.find((c) => c.type === ConditionType.Ready);
      const stalledCondition = helmRelease.status?.conditions?.find((c) => c.type === ConditionType.Stalled);
      const parts: string[] = [];
      if (stalledCondition?.status === ConditionStatus.True && stalledCondition?.message) {
        parts.push(stalledCondition.message);
      }
      if (readyCondition?.message) {
        parts.push(readyCondition.message);
      }
      const combined = parts.join(" | ");
      return <div class="message-cell">{combined}</div>;
    },
  },
];