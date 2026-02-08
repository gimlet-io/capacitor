// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { Kustomization, ExtendedKustomization } from "../../types/k8s.ts";
import {
  ConditionStatus,
  ConditionType,
  isDependencyNotReadyCondition,
} from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";

export const renderKustomizationDetails = (kustomization: ExtendedKustomization, columnCount = 4) => {
  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="display: contents;">
        <div>
          <strong>Source:</strong> {kustomization.spec?.sourceRef.kind}/{kustomization.spec?.sourceRef.namespace ? kustomization.spec.sourceRef.namespace : kustomization.metadata.namespace}/{kustomization.spec?.sourceRef.name} <br />
          <strong>Path:</strong> {kustomization.spec?.path} <br />
          <strong>Prune:</strong> {kustomization.spec?.prune ? "True" : "False"} <br />
          <strong>Interval:</strong> {kustomization.spec?.interval}
        </div>
        <div>
          <ul>
            {kustomization.events?.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
              <li><span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: <span>{(() => { const m = (event.message || '').replace(/[\r\n]+/g, ' '); return m.length > 300 ? m.slice(0, 300) + '…' : m; })()}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </DetailRowCard>
  );
}

export const KustomizationColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (kustomization: Kustomization) => (
      <>{kustomization.metadata.name}</>
    ),
    title: (kustomization: Kustomization) => kustomization.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (kustomization: Kustomization) =>
      useCalculateAge(kustomization.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (kustomization: ExtendedKustomization) => StatusBadges(kustomization),
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

export const StatusBadges = (kustomization: ExtendedKustomization) => {
  const readyCondition = kustomization.status?.conditions?.find((c) =>
    c.type === ConditionType.Ready
  );
  const stalledCondition = kustomization.status?.conditions?.find((c) =>
    c.type === ConditionType.Stalled
  );
  const reconcilingCondition = kustomization.status?.conditions?.find((c) =>
    c.type === ConditionType.Reconciling
  );
  const sourceReadyCondition = kustomization.source?.status?.conditions?.find((c) =>
    c.type === ConditionType.Ready
  );
  const sourceReconcilingCondition = kustomization.source?.status?.conditions?.find((c) =>
    c.type === ConditionType.Reconciling
  );

  const depNotReady = isDependencyNotReadyCondition(readyCondition as any);
  const sourceDepNotReady = isDependencyNotReadyCondition(sourceReadyCondition as any);

  return (
    <div class="status-badges">
      {stalledCondition?.status === ConditionStatus.True && (
        <span class="status-badge stalled">Stalled</span>
      )}
      {readyCondition?.status === ConditionStatus.True && (
        <span class="status-badge ready">Ready</span>
      )}
      {readyCondition?.status === ConditionStatus.False && !depNotReady && (
        <span class="status-badge not-ready">NotReady</span>
      )}
      {(readyCondition?.status === ConditionStatus.Unknown) && (readyCondition?.reason === "TerraformPlannedWithChanges")  && ( // The Terraform controller uses Unknown for reconciling
        <span class="status-badge approval-required">Approval Required</span>
      )}
      {(readyCondition?.status === ConditionStatus.Unknown) && (readyCondition?.reason !== "TerraformPlannedWithChanges")  && ( // The Terraform controller uses Unknown for reconciling
        <span class="status-badge reconciling">Reconciling</span>
      )}
      {(reconcilingCondition?.status === ConditionStatus.True || depNotReady) && (
        <span class="status-badge reconciling">Reconciling</span>
      )}
      {kustomization.spec?.suspend && (
        <span class="status-badge suspended">Suspended</span>
      )}
      {sourceReadyCondition?.status === ConditionStatus.True && (
        <span class="status-badge ready">Source: Ready</span>
      )}
      {sourceReadyCondition?.status === ConditionStatus.False && !sourceDepNotReady && (
        <span class="status-badge not-ready">Source: NotReady</span>
      )}
      {(sourceReconcilingCondition?.status === ConditionStatus.True || sourceDepNotReady) && (
        <span class="status-badge reconciling">Source: Reconciling</span>
      )}
    </div>
  );
};