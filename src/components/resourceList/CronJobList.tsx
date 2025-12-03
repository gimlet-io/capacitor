// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { JSX } from "solid-js";
import type { CronJob, Job } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge, useCalculateTimeAgo } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';
import { DetailRowCard } from "./DetailRowCard.tsx";

// Helper function to determine if CronJob is suspended
function getSuspendedComponent(cronJob: CronJob): { element: JSX.Element, title: string } {
  const suspended = cronJob.spec?.suspend === true;
  
  const statusClass = suspended ? "text-warning" : "text-success";
  const status = suspended ? "Suspended" : "Active";
  
  return {
    element: <span class={statusClass}>{status}</span>,
    title: suspended ? "This CronJob is suspended" : "This CronJob is active"
  };
}

// Trigger a one-off Job run for a CronJob, similar to:
// kubectl create job --from=cronjob/<name> <generated-name>
async function runCronJobNow(cronJob: CronJob, contextName: string): Promise<void> {
  const ctxName = encodeURIComponent(contextName);
  const apiPrefix = `/api/${ctxName}`;

  const response = await fetch(`${apiPrefix}/cronjob/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: cronJob.metadata.name,
      namespace: cronJob.metadata.namespace,
    }),
  });

  if (!response.ok) {
    try {
      const data = await response.json();
      throw new Error(data.error || `Failed to trigger CronJob: ${response.statusText}`);
    } catch (err) {
      // If response is not JSON, fall back to generic error
      if (err instanceof Error) {
        console.error("Error triggering CronJob:", err);
        throw err;
      }
      throw new Error(`Failed to trigger CronJob: ${response.statusText}`);
    }
  }
}

// Handler used by ResourceList command
export const handleRunCronJobNow = (resource: CronJob, contextName?: string) => {
  if (!resource || !resource.metadata) return;
  if (!contextName) {
    throw new Error("No Kubernetes context selected");
  }

  const confirmed = globalThis.confirm(
    `Run CronJob "${resource.metadata.name}" now? This will create a Job immediately.`
  );
  if (!confirmed) return;

  return runCronJobNow(resource, contextName);
};

export const renderCronJobDetails = (cronJob: CronJob & { jobs?: Job[] }, columnCount = 4) => {
  const jobs: Job[] = cronJob.jobs || [];
  const sortedJobs = jobs
    .slice()
    .sort((a, b) => {
      const aTime = a.status?.startTime || a.metadata.creationTimestamp || "";
      const bTime = b.status?.startTime || b.metadata.creationTimestamp || "";
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    })
    .slice(0, 5);

  const renderJobStatus = (job: Job): string => {
    const succeeded = job.status?.succeeded || 0;
    const completions = job.spec?.completions || 1;
    const failed = job.status?.failed || 0;
    const active = job.status?.active || 0;

    if (succeeded >= completions) return "Completed";
    if (failed > 0) return "Failed";
    if (active > 0) return "Active";
    return "Pending";
  };

  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="display: contents;">
        <div>
          {cronJob.spec?.concurrencyPolicy && (
            <>
              <strong>Concurrency policy:</strong> {cronJob.spec.concurrencyPolicy} <br />
            </>
          )}
          {typeof cronJob.spec?.successfulJobsHistoryLimit === "number" && (
            <>
              <strong>Successful history limit:</strong> {cronJob.spec.successfulJobsHistoryLimit} <br />
            </>
          )}
          {typeof cronJob.spec?.failedJobsHistoryLimit === "number" && (
            <>
              <strong>Failed history limit:</strong> {cronJob.spec.failedJobsHistoryLimit} <br />
            </>
          )}
        </div>
        <div>
          {sortedJobs.length === 0 ? (
            <div>No Jobs found for this CronJob yet.</div>
          ) : (
            <ul>
              {sortedJobs.map(job => {
                const ts = job.status?.startTime || job.metadata.creationTimestamp || "";
                const when = ts ? useCalculateAge(ts)() : "";
                const status = renderJobStatus(job);
                return (
                  <li>
                    <span title={ts}>{when}</span>{" "}
                    {job.metadata.namespace}/{job.metadata.name}: {status}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </DetailRowCard>
  );
};

// Format the schedule into a more human-readable form
function formatSchedule(schedule: string): string {
  // This is a simplified formatter - a full implementation would parse the cron expression
  return schedule;
}

// Define the columns for the CronJob resource list
export const cronJobColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (cronJob: CronJob) => <>{cronJob.metadata.name}</>,
    title: (cronJob: CronJob) => cronJob.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "SCHEDULE",
    width: "20%",
    accessor: (cronJob: CronJob) => <>{cronJob.spec?.schedule ?? "-"}</>,
    title: (cronJob: CronJob) =>
      cronJob.spec?.schedule
        ? `Schedule: ${formatSchedule(cronJob.spec.schedule)}`
        : "Schedule: -"
  },
  {
    header: "SUSPEND",
    width: "10%",
    accessor: (cronJob: CronJob) => getSuspendedComponent(cronJob).element,
    title: (cronJob: CronJob) => getSuspendedComponent(cronJob).title,
  },
  {
    header: "ACTIVE",
    width: "10%",
    accessor: (cronJob: CronJob) => {
      const activeCount = cronJob.status?.active?.length || 0;
      return <>{activeCount}</>;
    },
    title: (cronJob: CronJob) => {
      const activeCount = cronJob.status?.active?.length || 0;
      return `Active jobs: ${activeCount}`;
    },
  },
  {
    header: "LAST SCHEDULE",
    width: "20%",
    accessor: (cronJob: CronJob) => 
      useCalculateTimeAgo(cronJob.status?.lastScheduleTime)(),
    title: (cronJob: CronJob) => {
      return cronJob.status?.lastScheduleTime 
        ? `Last scheduled at: ${cronJob.status.lastScheduleTime}` 
        : "Never scheduled";
    },
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (cronJob: CronJob) => 
      useCalculateAge(cronJob.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];

// Filter for CronJob based on whether it's suspended or not
export const cronJobSuspendedFilter: Filter = {
  name: "cronJobSuspended",
  label: "Status",
  options: [
    { value: "Active", label: "Active" },
    { value: "Suspended", label: "Suspended" },
  ],
  filterFunction: (cronJob: CronJob, value: string) => {
    const suspended = cronJob.spec?.suspend === true;
    const status = suspended ? "Suspended" : "Active";
    return status === value;
  },
}; 