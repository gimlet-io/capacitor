// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import type { Column } from "../../resourceTypeConfigs.tsx";
import { DetailRowCard } from "./DetailRowCard.tsx";

type KluctlDeploymentResult = any;

type DeploymentIssue = {
  message?: string;
};

const countIssues = (value: any): number => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value;
  return 0;
};

const getIssueMessages = (value: any): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => {
      if (!it) return "";
      const msg = (it as DeploymentIssue).message;
      if (typeof msg === "string" && msg.trim().length > 0) return msg.trim();
      try {
        return JSON.stringify(it);
      } catch {
        return "";
      }
    })
    .filter((m) => m.length > 0);
};

const sortSummariesByStartTimeDesc = (summaries: any[]): any[] => {
  return [...summaries].sort((a, b) => {
    const sa = new Date(a.startTime || "").getTime();
    const sb = new Date(b.startTime || "").getTime();
    return sb - sa;
  });
};

const formatSummaryStatus = (s: any): string => {
  if (!s) return "No changes";

  const errorMessages = getIssueMessages(s.errors);
  const warningMessages = getIssueMessages(s.warnings);

  const parts: string[] = [];

  const rendered = typeof s.renderedObjects === "number" ? s.renderedObjects : 0;
  if (rendered) parts.push(`${rendered} rendered`);

  const applied = typeof s.appliedObjects === "number" ? s.appliedObjects : 0;
  if (applied) parts.push(`${applied} applied`);

  const changed = typeof s.changedObjects === "number" ? s.changedObjects : 0;
  if (changed) parts.push(`${changed} changed`);

  const deleted = typeof s.deletedObjects === "number" ? s.deletedObjects : 0;
  if (deleted) parts.push(`${deleted} deleted`);

  const newly = typeof s.newObjects === "number" ? s.newObjects : 0;
  if (newly) parts.push(`${newly} new`);

  const orphan = typeof s.orphanObjects === "number" ? s.orphanObjects : 0;
  if (orphan) parts.push(`${orphan} orphan`);

  const errorCount = countIssues(s.errors);
  if (errorCount) {
    const suffix = errorMessages.length ? `: ${errorMessages.join(" | ")}` : "";
    parts.push(`${errorCount} errors${suffix}`);
  }

  const warningCount = countIssues(s.warnings);
  if (warningCount) {
    const suffix = warningMessages.length ? `: ${warningMessages.join(" | ")}` : "";
    parts.push(`${warningCount} warnings${suffix}`);
  }

  return parts.length ? parts.join(" | ") : "No changes";
};

const getLatestSummary = (deployment: KluctlDeploymentResult) => {
  const summaries = deployment.status?.commandSummaries as any[] | undefined;
  if (!summaries || summaries.length === 0) return undefined;
  const sorted = sortSummariesByStartTimeDesc(summaries);
  return sorted[0];
};

export const renderKluctlDeploymentResultsDetails = (deployment: KluctlDeploymentResult, columnCount = 4) => {
  const summaries = (deployment.status?.commandSummaries as any[] | undefined) || [];
  const sorted = sortSummariesByStartTimeDesc(summaries).slice(0, 5);

  console.log(deployment);

  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="display: contents;">
        <div>
          <strong>Project:</strong> {deployment.spec?.project?.repoKey?.url || deployment.spec?.project?.repoKey || "-"}/{deployment.spec?.project?.subDir || "-"}<br />
          <strong>Target:</strong> {deployment.spec?.target?.name || "-"}
        </div>
        <div>
          <ul>
            {sorted.map((s) => (
              <li>
                <span title={s.startTime}>
                  {useCalculateAge(s.commandInfo.startTime || "")()}
                </span>{" "}
                <strong>{s.commandInfo.command}: </strong>{" "}
                {formatSummaryStatus(s)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DetailRowCard>
  );
};

export const kluctlDeploymentResultColumns: Column<KluctlDeploymentResult>[] = [
  {
    header: "NAME",
    width: "35%",
    accessor: (deployment) => <>{deployment.metadata?.name}</>,
    title: (deployment) => deployment.metadata?.name || "",
    sortable: true,
    sortFunction: (items, ascending) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (deployment) =>
      useCalculateAge(deployment.metadata?.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items, ascending) => sortByAge(items, ascending),
  },
  {
    header: "LAST COMMAND",
    width: "15%",
    accessor: (deployment) => {
      const latest = getLatestSummary(deployment);
      return <>{latest?.commandInfo.command || ""} <span title={latest?.commandInfo.startTime}>{useCalculateAge(latest?.commandInfo.startTime || "")()}</span>{" ago"}</>;
    },
    title: (deployment) => {
      const latest = getLatestSummary(deployment);
      return latest?.commandInfo.command || "";
    },
    sortable: true,
    sortFunction: (items, ascending) => {
      return [...items].sort((a, b) => {
        const la = getLatestSummary(a);
        const lb = getLatestSummary(b);
        const ca = (la?.command || "") as string;
        const cb = (lb?.command || "") as string;
        return ascending ? ca.localeCompare(cb) : cb.localeCompare(ca);
      });
    },
  },
  {
    header: "STATUS",
    width: "25%",
    accessor: (deployment) => {
      const latest = getLatestSummary(deployment);
      return (
        <div class="message-cell">
          {formatSummaryStatus(latest)}
        </div>
      );
    },
  },
];


