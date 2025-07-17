import { JSX } from "solid-js";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from './timeUtils.ts';
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";

// Define the ScaledJob type
interface ScaledJob {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    labels?: { [key: string]: string };
    annotations?: { [key: string]: string };
    uid: string;
  };
  spec: {
    jobTargetRef: {
      parallelism?: number;
      completions?: number;
      template: {
        spec: {
          containers: Array<{
            name: string;
            image: string;
          }>;
        };
      };
    };
    pollingInterval?: number;
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    maxReplicaCount?: number;
    scalingStrategy?: {
      strategy?: string; // "default", "custom", "accurate"
      customScalingQueueLengthDeduction?: number;
      customScalingRunningJobPercentage?: number;
      pendingPodConditions?: string[];
    };
    triggers: Array<{
      type: string;
      metadata: { [key: string]: string };
      name?: string;
      authenticationRef?: {
        name: string;
      };
    }>;
  };
  status?: {
    lastActiveTime?: string;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
  };
}

// Helper function to get ScaledJob triggers as a formatted string
function getTriggersDisplay(scaledJob: ScaledJob): { text: string, title: string } {
  const triggers = scaledJob.spec.triggers || [];
  
  if (triggers.length === 0) {
    return { text: "No triggers", title: "No triggers defined" };
  }

  // For display in the table, show just the count and types
  const triggerTypes = triggers.map(t => t.type);
  const uniqueTypes = [...new Set(triggerTypes)];
  const text = uniqueTypes.join(", ");
  
  // For the tooltip, show more details
  const details = triggers.map(trigger => {
    const name = trigger.name ? ` (${trigger.name})` : '';
    return `${trigger.type}${name}`;
  }).join('\n');
  
  return { 
    text: `${triggers.length} (${text})`, 
    title: details
  };
}

// Helper function to determine ScaledJob status with appropriate styling
function getScaledJobStatusComponent(scaledJob: ScaledJob): { element: JSX.Element, title: string } {
  // Check conditions for status
  const conditions = scaledJob.status?.conditions || [];
  const readyCondition = conditions.find(c => c.type === "Ready" || c.type === "ScalingReady");
  
  if (!readyCondition) {
    return {
      element: <span class="text-secondary">Unknown</span>,
      title: "Status: Unknown"
    };
  }
  
  if (readyCondition.status === "True") {
    return {
      element: <span class="text-success">Ready</span>,
      title: `Ready: ${readyCondition.message || "The scaled job is ready for scaling"}`
    };
  } else {
    return {
      element: <span class="text-danger">Not Ready</span>,
      title: `Not Ready: ${readyCondition.message || readyCondition.reason || "The scaled job is not ready for scaling"}`
    };
  }
}

// Define the columns for the ScaledJob resource list
export const scaledJobColumns = [
  {
    header: "NAME",
    width: "20%",
    accessor: (scaledJob: ScaledJob) => <>{scaledJob.metadata.name}</>,
    title: (scaledJob: ScaledJob) => scaledJob.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "TRIGGERS",
    width: "25%",
    accessor: (scaledJob: ScaledJob) => {
      const triggers = getTriggersDisplay(scaledJob);
      return <span title={triggers.title}>{triggers.text}</span>;
    },
    title: (scaledJob: ScaledJob) => getTriggersDisplay(scaledJob).title,
  },
  {
    header: "MAX REPLICAS",
    width: "10%",
    accessor: (scaledJob: ScaledJob) => <>{scaledJob.spec.maxReplicaCount || "unlimited"}</>,
  },
  {
    header: "POLLING INTERVAL",
    width: "15%",
    accessor: (scaledJob: ScaledJob) => <>{scaledJob.spec.pollingInterval || 30}s</>,
  },
  {
    header: "SCALING STRATEGY",
    width: "15%",
    accessor: (scaledJob: ScaledJob) => <>{scaledJob.spec.scalingStrategy?.strategy || "default"}</>,
  },
  {
    header: "STATUS",
    width: "10%",
    accessor: (scaledJob: ScaledJob) => getScaledJobStatusComponent(scaledJob).element,
    title: (scaledJob: ScaledJob) => getScaledJobStatusComponent(scaledJob).title,
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (scaledJob: ScaledJob) => useCalculateAge(scaledJob.metadata.creationTimestamp || '')(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];

// Filter for ScaledJob based on trigger type
export const scaledJobTriggerFilter: Filter = {
  name: "scaledJobTrigger",
  label: "Trigger Type",
  type: "select",
  options: [
    { value: "kafka", label: "Kafka" },
    { value: "rabbitmq", label: "RabbitMQ" },
    { value: "aws-sqs", label: "AWS SQS" },
    { value: "azure-queue", label: "Azure Queue" },
    { value: "prometheus", label: "Prometheus" },
    { value: "cron", label: "Cron" },
    { value: "cpu", label: "CPU" },
    { value: "memory", label: "Memory" },
    // Add other common trigger types as needed
  ],
  multiSelect: true,
  filterFunction: (scaledJob: ScaledJob, value: string) => {
    const triggers = scaledJob.spec.triggers || [];
    return triggers.some(trigger => trigger.type.toLowerCase() === value.toLowerCase());
  },
};

// Filter for ScaledJob based on its scaling strategy
export const scaledJobStrategyFilter: Filter = {
  name: "scaledJobStrategy",
  label: "Scaling Strategy",
  type: "select",
  options: [
    { value: "default", label: "Default" },
    { value: "custom", label: "Custom" },
    { value: "accurate", label: "Accurate" },
  ],
  filterFunction: (scaledJob: ScaledJob, value: string) => {
    const strategy = scaledJob.spec.scalingStrategy?.strategy || "default";
    return strategy.toLowerCase() === value.toLowerCase();
  },
}; 