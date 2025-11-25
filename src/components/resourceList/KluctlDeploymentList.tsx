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

      const driftMessage: string | undefined =
        deployment.status?.lastDriftDetectionResultMessage;
      const hasDriftInfo =
        typeof driftMessage === "string" && driftMessage.length > 0;

      const validateEnabled =
        deployment.spec?.validate === undefined
          ? true
          : Boolean(deployment.spec?.validate);
      const validateResult = deployment.status?.lastValidateResult;

      const errorCount = validateResult?.errors
        ? Array.isArray(validateResult.errors)
          ? validateResult.errors.length
          : Number(validateResult.errors) || 0
        : 0;
      const warningCount = validateResult?.warnings
        ? Array.isArray(validateResult.warnings)
          ? validateResult.warnings.length
          : Number(validateResult.warnings) || 0
        : 0;
      const validationReady = Boolean(validateResult?.ready);

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
          {hasDriftInfo && (
            <span
              class={`status-badge ${
                driftMessage === "no drift" ? "ready" : "sync-outofsync"
              }`}
              title={`Drift: ${driftMessage}`}
            >
              {driftMessage === "no drift"
                ? "NoDrift"
                : `Drift: ${driftMessage}`}
            </span>
          )}
          {validateEnabled && !validateResult && (
            <span
              class="status-badge health-unknown"
              title="Validation has not run yet."
            >
              Validation: N/A
            </span>
          )}
          {validateEnabled && validateResult && (
            <>
              {validationReady && errorCount === 0 && warningCount === 0 && (
                <span
                  class="status-badge health-healthy"
                  title="Validation succeeded without warnings."
                >
                  Validation: OK
                </span>
              )}
              {validationReady && errorCount === 0 && warningCount > 0 && (
                <span
                  class="status-badge kluctl-warnings"
                  title={`Validation has ${warningCount} warning(s).`}
                >
                  Validation: {warningCount} warning
                  {warningCount > 1 ? "s" : ""}
                </span>
              )}
              {(!validationReady || errorCount > 0) && (
                <span
                  class="status-badge kluctl-errors"
                  title={
                    errorCount > 0
                      ? `Validation has ${errorCount} error(s).`
                      : "Validation reported the target as not ready."
                  }
                >
                  {errorCount > 0
                    ? `Validation: ${errorCount} error${
                        errorCount > 1 ? "s" : ""
                      }`
                    : "Validation: NotReady"}
                </span>
              )}
            </>
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


