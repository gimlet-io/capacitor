import { JSX } from "solid-js";
import type { CronJob } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../resourceTypeConfigs.tsx';

// Helper function to determine if CronJob is suspended
function getSuspendedComponent(cronJob: CronJob): { element: JSX.Element, title: string } {
  const suspended = cronJob.spec.suspend === true;
  
  const statusClass = suspended ? "text-warning" : "text-success";
  const status = suspended ? "Suspended" : "Active";
  
  return {
    element: <span class={statusClass}>{status}</span>,
    title: suspended ? "This CronJob is suspended" : "This CronJob is active"
  };
}

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
    accessor: (cronJob: CronJob) => <>{cronJob.spec.schedule}</>,
    title: (cronJob: CronJob) => `Schedule: ${formatSchedule(cronJob.spec.schedule)}`
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
    accessor: (cronJob: CronJob) => {
      if (!cronJob.status?.lastScheduleTime) return <>Never</>;
      
      const lastSchedule = new Date(cronJob.status.lastScheduleTime);
      const now = new Date();
      const diff = now.getTime() - lastSchedule.getTime();
      
      // Display time ago
      if (diff < 60000) { // less than a minute
        return <>{Math.floor(diff / 1000)}s ago</>;
      } else if (diff < 3600000) { // less than an hour
        return <>{Math.floor(diff / 60000)}m ago</>;
      } else if (diff < 86400000) { // less than a day
        return <>{Math.floor(diff / 3600000)}h ago</>;
      } else { // days
        return <>{Math.floor(diff / 86400000)}d ago</>;
      }
    },
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
    const suspended = cronJob.spec.suspend === true;
    const status = suspended ? "Suspended" : "Active";
    return status === value;
  },
}; 