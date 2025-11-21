// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import type { Column } from "../../resourceTypeConfigs.tsx";
import { DetailRowCard } from "./DetailRowCard.tsx";

type KluctlDeployment = any;

export const renderKluctlDeploymentDetails = (deployment: KluctlDeployment, columnCount = 4) => {
  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="display: contents;">
        <div>
          <strong>Source:</strong>{" "}
          {deployment.spec?.source?.git && (
            <>
              {deployment.spec.source.git.url}
              {deployment.spec.source.git.path && (
                <> /{deployment.spec.source.git.path}</>
              )}
            </>
          )}{" "}
          <br />
          <strong>Target:</strong> {deployment.spec?.target} <br />
          <strong>Interval:</strong> {deployment.spec?.interval}
        </div>
        <div>
          <ul>
            {(deployment.events || [])
              .slice()
              .sort(
                (a: any, b: any) =>
                  new Date(b.lastTimestamp).getTime() -
                  new Date(a.lastTimestamp).getTime(),
              )
              .slice(0, 5)
              .map((event: any) => (
                <li>
                  <span title={event.lastTimestamp}>
                    {useCalculateAge(event.lastTimestamp)()}
                  </span>{" "}
                  {event.involvedObject.kind}/{event.involvedObject.namespace}/
                  {event.involvedObject.name}:{" "}
                  <span>
                    {(() => {
                      const m = String(event.message || "").replace(
                        /[\r\n]+/g,
                        " ",
                      );
                      return m.length > 300 ? m.slice(0, 300) + "…" : m;
                    })()}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </DetailRowCard>
  );
};

export const kluctlDeploymentColumns: Column<KluctlDeployment>[] = [
  {
    header: "NAME",
    width: "28%",
    accessor: (deployment) => <>{deployment.metadata?.name}</>,
    title: (deployment) => deployment.metadata?.name ?? "",
    sortable: true,
    sortFunction: (items, ascending) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "8%",
    accessor: (deployment) =>
      useCalculateAge(deployment.metadata?.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items, ascending) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "16%",
    accessor: (deployment) => {
      const readyCondition = deployment.status?.conditions?.find(
        (c: any) => c.type === ConditionType.Ready,
      );
      const reconcilingCondition = deployment.status?.conditions?.find(
        (c: any) => c.type === ConditionType.Reconciling,
      );
      const stalledCondition = deployment.status?.conditions?.find(
        (c: any) => c.type === ConditionType.Stalled,
      );

      return (
        <div class="status-badges">
          {stalledCondition?.status === ConditionStatus.True && (
            <span class="status-badge stalled">Stalled</span>
          )}
          {readyCondition?.status === ConditionStatus.True && (
            <span class="status-badge ready">Ready</span>
          )}
          {readyCondition?.status === ConditionStatus.False && (
            <span class="status-badge not-ready">NotReady</span>
          )}
          {reconcilingCondition?.status === ConditionStatus.True && (
            <span class="status-badge reconciling">Reconciling</span>
          )}
          {deployment.spec?.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "DEPLOYED",
    width: "12%",
    accessor: (deployment) => {
      const ts =
        deployment.status?.lastDeployResult?.lastDeployTime ||
        deployment.status?.lastAppliedRevisionTime ||
        deployment.status?.lastAttemptedRevisionTime ||
        "";
      return ts ? useCalculateAge(ts)() : "-";
    },
    sortable: true,
    sortFunction: (items, ascending) => {
      return [...items].sort((a: any, b: any) => {
        const getTs = (d: any) =>
          d.status?.lastDeployResult?.lastDeployTime ||
          d.status?.lastAppliedRevisionTime ||
          d.status?.lastAttemptedRevisionTime ||
          "";
        const ta = getTs(a);
        const tb = getTs(b);
        const da = ta ? new Date(ta).getTime() : 0;
        const db = tb ? new Date(tb).getTime() : 0;
        return ascending ? da - db : db - da;
      });
    },
  },
  {
    header: "STATUS",
    width: "36%",
    accessor: (deployment) => {
      const readyCondition = deployment.status?.conditions?.find(
        (c: any) => c.type === ConditionType.Ready,
      );
      return (
        <div class="message-cell">
          {readyCondition?.message || deployment.status?.phase || ""}
        </div>
      );
    },
  },
];


