import { JSX } from "solid-js";
import type { HorizontalPodAutoscaler } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Helper function to determine HPA status
function getHPAStatusComponent(hpa: HorizontalPodAutoscaler): { element: JSX.Element, title: string } {
  if (!hpa.status?.conditions) {
    return { 
      element: <span class="text-secondary">Unknown</span>,
      title: "No conditions available"
    };
  }
  
  // Check for specific conditions
  const scalingActive = hpa.status.conditions.find(c => c.type === "ScalingActive");
  const ableToScale = hpa.status.conditions.find(c => c.type === "AbleToScale");
  const limitingMetrics = hpa.status.conditions.find(c => c.type === "ScalingLimited");
  
  // Check for errors in conditions
  if (scalingActive && scalingActive.status !== "True") {
    return {
      element: <span class="text-danger">Not Scaling</span>,
      title: scalingActive.message || "Scaling is not active"
    };
  }
  
  if (ableToScale && ableToScale.status !== "True") {
    return {
      element: <span class="text-danger">Can't Scale</span>,
      title: ableToScale.message || "Unable to scale"
    };
  }
  
  if (limitingMetrics && limitingMetrics.status === "True") {
    return {
      element: <span class="text-warning">Limited</span>,
      title: limitingMetrics.message || "Scaling is limited"
    };
  }
  
  // Default case: all is well
  return {
    element: <span class="text-success">Healthy</span>,
    title: "HPA is healthy and working normally"
  };
}

// Compose a summary of HPA metrics
function getMetricsSummary(hpa: HorizontalPodAutoscaler): string {
  const metrics = hpa.spec.metrics || [];
  const targetCPU = hpa.spec.targetCPUUtilizationPercentage;
  
  if (targetCPU && metrics.length === 0) {
    return `CPU: ${targetCPU}%`;
  }
  
  if (metrics.length === 0) {
    return "No metrics configured";
  }
  
  return metrics.map(metric => {
    switch (metric.type) {
      case "Resource":
        if (metric.resource) {
          const resource = metric.resource.name;
          if (metric.resource.target.type === "Utilization") {
            return `${resource}: ${metric.resource.target.averageUtilization}%`;
          } else if (metric.resource.target.type === "AverageValue") {
            return `${resource}: ${metric.resource.target.averageValue}`;
          } else {
            return `${resource}: ${metric.resource.target.value}`;
          }
        }
        return "Resource metric";
      case "Pods":
        return `Pods: ${metric.pods?.metric.name}`;
      case "Object":
        return `Object: ${metric.object?.describedObject.kind}/${metric.object?.describedObject.name}`;
      case "External":
        return `External: ${metric.external?.metric.name}`;
      default:
        return "Unknown metric";
    }
  }).join(", ");
}

// Define the columns for the HPA resource list
export const hpaColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (hpa: HorizontalPodAutoscaler) => <>{hpa.metadata.name}</>,
    title: (hpa: HorizontalPodAutoscaler) => hpa.metadata.name,
  },
  {
    header: "NAMESPACE",
    width: "15%",
    accessor: (hpa: HorizontalPodAutoscaler) => <>{hpa.metadata.namespace}</>,
  },
  {
    header: "REFERENCE",
    width: "20%",
    accessor: (hpa: HorizontalPodAutoscaler) => {
      const kind = hpa.spec.scaleTargetRef.kind;
      const name = hpa.spec.scaleTargetRef.name;
      return <>{kind}/{name}</>;
    },
  },
  {
    header: "TARGETS",
    width: "15%",
    accessor: (hpa: HorizontalPodAutoscaler) => {
      const currentCPU = hpa.status?.currentCPUUtilizationPercentage;
      const targetCPU = hpa.spec.targetCPUUtilizationPercentage;
      
      if (currentCPU && targetCPU) {
        return <>{currentCPU}%/{targetCPU}%</>;
      }
      
      // Custom metrics would need a more complex display
      return <>-</>;
    },
    title: (hpa: HorizontalPodAutoscaler) => getMetricsSummary(hpa),
  },
  {
    header: "MINPODS",
    width: "10%",
    accessor: (hpa: HorizontalPodAutoscaler) => <>{hpa.spec.minReplicas || 1}</>,
  },
  {
    header: "MAXPODS",
    width: "10%",
    accessor: (hpa: HorizontalPodAutoscaler) => <>{hpa.spec.maxReplicas}</>,
  },
  {
    header: "REPLICAS",
    width: "10%",
    accessor: (hpa: HorizontalPodAutoscaler) => <>{hpa.status?.currentReplicas || 0}</>,
  },
  {
    header: "STATUS",
    width: "10%",
    accessor: (hpa: HorizontalPodAutoscaler) => getHPAStatusComponent(hpa).element,
    title: (hpa: HorizontalPodAutoscaler) => getHPAStatusComponent(hpa).title,
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (hpa: HorizontalPodAutoscaler) => {
      if (!hpa.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(hpa.metadata.creationTimestamp);
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
    },
  },
];

// Filter for HPA based on its status
export const hpaStatusFilter: Filter = {
  name: "hpaStatus",
  label: "Status",
  options: [
    { value: "Healthy", label: "Healthy" },
    { value: "Limited", label: "Limited" },
    { value: "Can't Scale", label: "Can't Scale" },
    { value: "Not Scaling", label: "Not Scaling" },
    { value: "Unknown", label: "Unknown" },
  ],
  filterFunction: (hpa: HorizontalPodAutoscaler, value: string) => {
    if (!hpa.status?.conditions) {
      return value === "Unknown";
    }
    
    const scalingActive = hpa.status.conditions.find(c => c.type === "ScalingActive");
    const ableToScale = hpa.status.conditions.find(c => c.type === "AbleToScale");
    const limitingMetrics = hpa.status.conditions.find(c => c.type === "ScalingLimited");
    
    if (scalingActive && scalingActive.status !== "True") {
      return value === "Not Scaling";
    }
    
    if (ableToScale && ableToScale.status !== "True") {
      return value === "Can't Scale";
    }
    
    if (limitingMetrics && limitingMetrics.status === "True") {
      return value === "Limited";
    }
    
    return value === "Healthy";
  },
}; 