// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { HelmChart } from "../../types/k8s.ts";
import { ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";
import { FluxSourceStatusBadges } from "./FluxSourceStatusBadges.tsx";

export const renderHelmChartDetails = (helmChart: HelmChart, columnCount = 4) => (
  <DetailRowCard columnCount={columnCount}>
    <div style="display: contents;">
      <strong>Chart:</strong> {helmChart.spec?.chart} <br />
      <strong>Source Ref:</strong> {helmChart.spec?.sourceRef.kind}/{helmChart.spec?.sourceRef.name} <br />
      <strong>Interval:</strong> {helmChart.spec?.interval} <br />
      <strong>Suspended:</strong>
      {helmChart.spec && (
        <>
          {helmChart.spec.suspend ? " True" : " False"} <br />
        </>
      )}
    </div>
  </DetailRowCard>
);

export const helmChartColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (helmChart: HelmChart) => (
      <>{helmChart.metadata.name}</>
    ),
    title: (helmChart: HelmChart) => helmChart.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (helmChart: HelmChart) =>
      useCalculateAge(helmChart.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (helmChart: HelmChart) => (
      <FluxSourceStatusBadges resource={helmChart} artifactLabel="Packaged" />
    ),
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