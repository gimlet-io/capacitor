import { JSX } from "solid-js";
import type { Job } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../resourceTypeConfigs.tsx';

// Helper function to determine job completion status with appropriate styling
function getJobCompletionComponent(job: Job): { element: JSX.Element, title: string } {
  const succeeded = job.status?.succeeded || 0;
  const completions = job.spec.completions || 1;
  const failed = job.status?.failed || 0;
  const active = job.status?.active || 0;
  
  let status = "Pending";
  let statusClass = "text-secondary";
  
  if (active > 0) {
    status = "Active";
    statusClass = "text-info";
  }
  
  if (failed > 0) {
    status = "Failed";
    statusClass = "text-danger";
  }
  
  if (succeeded >= completions) {
    status = "Completed";
    statusClass = "text-success";
  }
  
  return {
    element: <span class={statusClass}>{status}</span>,
    title: `Status: ${status}, Succeeded: ${succeeded}, Failed: ${failed}, Active: ${active}`
  };
}

// Define the columns for the Job resource list
export const jobColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (job: Job) => <>{job.metadata.name}</>,
    title: (job: Job) => job.metadata.name,
    sortable: true,
    sortFunction: sortByName,
  },
  {
    header: "COMPLETIONS",
    width: "15%",
    accessor: (job: Job) => {
      const succeeded = job.status?.succeeded || 0;
      const completions = job.spec.completions || 1;
      return <>{succeeded}/{completions}</>;
    },
  },
  {
    header: "DURATION",
    width: "15%",
    accessor: (job: Job) => {
      const startTime = job.status?.startTime ? new Date(job.status.startTime) : null;
      const completionTime = job.status?.completionTime ? new Date(job.status.completionTime) : null;
      
      if (!startTime) return <>-</>;
      
      const endTime = completionTime || new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationSec = Math.floor(durationMs / 1000);
      
      if (durationSec < 60) {
        return <>{durationSec}s</>;
      } else if (durationSec < 3600) {
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        return <>{minutes}m{seconds}s</>;
      } else {
        const hours = Math.floor(durationSec / 3600);
        const minutes = Math.floor((durationSec % 3600) / 60);
        return <>{hours}h{minutes}m</>;
      }
    },
    title: (job: Job) => {
      const startTime = job.status?.startTime;
      const completionTime = job.status?.completionTime;
      if (!startTime) return "Job has not started";
      if (!completionTime) return `Started at ${startTime}, not completed yet`;
      return `Started at ${startTime}, completed at ${completionTime}`;
    },
  },
  {
    header: "STATUS",
    width: "10%",
    accessor: (job: Job) => getJobCompletionComponent(job).element,
    title: (job: Job) => getJobCompletionComponent(job).title,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (job: Job) => 
      useCalculateAge(job.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: sortByAge,
  },
];

// Filter for Job based on its status
export const jobStatusFilter: Filter = {
  name: "jobStatus",
  label: "Status",
  options: [
    { value: "Completed", label: "Completed" },
    { value: "Active", label: "Active" },
    { value: "Failed", label: "Failed" },
    { value: "Pending", label: "Pending" },
  ],
  filterFunction: (job: Job, value: string) => {
    const succeeded = job.status?.succeeded || 0;
    const completions = job.spec.completions || 1;
    const failed = job.status?.failed || 0;
    const active = job.status?.active || 0;
    
    let status = "Pending";
    
    if (active > 0) {
      status = "Active";
    }
    
    if (failed > 0) {
      status = "Failed";
    }
    
    if (succeeded >= completions) {
      status = "Completed";
    }
    
    return status === value;
  },
}; 