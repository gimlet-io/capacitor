// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import type { Column } from "../../resourceTypeConfigs.tsx";
import { DetailRowCard } from "./DetailRowCard.tsx";

type KluctlDeploymentResult = any;

const getLatestSummary = (deployment: KluctlDeploymentResult) => {
  const summaries = deployment.status?.commandSummaries as any[] | undefined;
  if (!summaries || summaries.length === 0) return undefined;
  return summaries[summaries.length - 1];
};

export const renderKluctlDeploymentResultsDetails = (deployment: KluctlDeploymentResult, columnCount = 4) => {
  const summaries = (deployment.status?.commandSummaries as any[] | undefined) || [];
  const sorted = [...summaries].sort((a, b) => {
    const sa = new Date(a.startTime || "").getTime();
    const sb = new Date(b.startTime || "").getTime();
    return sb - sa;
  }).slice(0, 5);

  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="display: contents;">
        <div>
          <strong>Project:</strong> {deployment.spec?.project?.RepoKey?.url || deployment.spec?.project?.RepoKey || "-"}<br />
          <strong>Target:</strong> {deployment.spec?.target?.name || "-"}
        </div>
        <div>
          <ul>
            {sorted.map((s) => (
              <li>
                <span title={s.startTime}>
                  {useCalculateAge(s.startTime || "")()}
                </span>{" "}
                <strong>{s.command}</strong>{" "}
                ({s.totalChanges} changes, {s.errors} errors, {s.warnings} warnings)
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
    header: "NAMESPACE",
    width: "15%",
    accessor: (deployment) => <>{deployment.metadata?.namespace}</>,
    title: (deployment) => deployment.metadata?.namespace || "",
    sortable: true,
    sortFunction: (items, ascending) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "10%",
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
      return <>{latest?.command || ""}</>;
    },
    title: (deployment) => {
      const latest = getLatestSummary(deployment);
      return latest?.command || "";
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
      const errors = latest?.errors || 0;
      const warnings = latest?.warnings || 0;
      const changed = latest?.changedObjects || 0;
      const total = latest?.totalChanges || 0;
      const parts: string[] = [];
      if (errors) parts.push(`${errors} errors`);
      if (warnings) parts.push(`${warnings} warnings`);
      if (changed || total) {
        const label = total || changed;
        parts.push(`${label} changes`);
      }
      const text = parts.length ? parts.join(", ") : "No changes";
      return <div class="message-cell">{text}</div>;
    },
  },
];


