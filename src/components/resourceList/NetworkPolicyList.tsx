import { JSX } from "solid-js";
import type { NetworkPolicy } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Helper function to summarize policy types
function getPolicyTypesString(policy: NetworkPolicy): string {
  const types = policy.spec.policyTypes || [];
  if (types.length === 0) {
    // Default inference based on what's defined
    const hasIngress = !!policy.spec.ingress;
    const hasEgress = !!policy.spec.egress;
    
    if (hasIngress && hasEgress) {
      return "Ingress, Egress";
    } else if (hasIngress) {
      return "Ingress";
    } else if (hasEgress) {
      return "Egress";
    } else {
      return "None";
    }
  }
  
  return types.join(", ");
}

// Helper function to summarize pod selector
function getPodSelectorString(policy: NetworkPolicy): string {
  const selector = policy.spec.podSelector;
  
  if (!selector) {
    return "No selector";
  }
  
  const matchLabels = selector.matchLabels || {};
  const matchExpressions = selector.matchExpressions || [];
  
  const parts = [];
  
  // Add match labels
  const labelPairs = Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`);
  if (labelPairs.length > 0) {
    parts.push(labelPairs.join(", "));
  }
  
  // Add match expressions (simplified)
  if (matchExpressions.length > 0) {
    parts.push(`${matchExpressions.length} expressions`);
  }
  
  return parts.length > 0 ? parts.join("; ") : "All pods";
}

// Define the columns for the NetworkPolicy resource list
export const networkPolicyColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (policy: NetworkPolicy) => <>{policy.metadata.name}</>,
    title: (policy: NetworkPolicy) => policy.metadata.name,
  },
  {
    header: "POD SELECTOR",
    width: "30%",
    accessor: (policy: NetworkPolicy) => {
      const selectorSummary = getPodSelectorString(policy);
      // Truncate if too long for display
      return <>{selectorSummary.length > 40 ? selectorSummary.substring(0, 37) + "..." : selectorSummary}</>;
    },
    title: (policy: NetworkPolicy) => getPodSelectorString(policy),
  },
  {
    header: "POLICY TYPES",
    width: "15%",
    accessor: (policy: NetworkPolicy) => <>{getPolicyTypesString(policy)}</>,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (policy: NetworkPolicy) => {
      if (!policy.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(policy.metadata.creationTimestamp);
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

// Filter for NetworkPolicies by policy type
export const networkPolicyTypeFilter: Filter = {
  name: "networkPolicyType",
  label: "Policy Type",
  options: [
    { value: "Ingress", label: "Ingress" },
    { value: "Egress", label: "Egress" },
    { value: "Both", label: "Both" },
  ],
  filterFunction: (policy: NetworkPolicy, value: string) => {
    const types = policy.spec.policyTypes || [];
    const hasIngress = types.includes("Ingress") || !!policy.spec.ingress;
    const hasEgress = types.includes("Egress") || !!policy.spec.egress;
    
    if (value === "Both") {
      return hasIngress && hasEgress;
    } else if (value === "Ingress") {
      return hasIngress && !hasEgress;
    } else if (value === "Egress") {
      return !hasIngress && hasEgress;
    }
    
    return false;
  },
}; 