import type { Role } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Simplify the rules into a human-readable summary
function getRulesString(role: Role): string {
  const rules = role.rules || [];
  if (rules.length === 0) {
    return "No rules defined";
  }
  
  // This is a simplified version - a full implementation would be more detailed
  // and would categorize rules better
  const resourcesByVerb: Record<string, string[]> = {};
  
  for (const rule of rules) {
    const verbs = rule.verbs || [];
    const resources = rule.resources || [];
    const apiGroups = rule.apiGroups || [""];
    
    for (const verb of verbs) {
      if (!resourcesByVerb[verb]) {
        resourcesByVerb[verb] = [];
      }
      
      for (const resource of resources) {
        for (const apiGroup of apiGroups) {
          const resourceWithGroup = apiGroup 
            ? `${resource}.${apiGroup}` 
            : resource;
          
          if (!resourcesByVerb[verb].includes(resourceWithGroup)) {
            resourcesByVerb[verb].push(resourceWithGroup);
          }
        }
      }
    }
  }
  
  // Format as "verb: resource1, resource2; verb2: resource3, resource4"
  const parts = Object.entries(resourcesByVerb).map(([verb, resources]) => {
    return `${verb}: ${resources.join(", ")}`;
  });
  
  return parts.join("; ");
}

// Define the columns for the Role resource list
export const roleColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (role: Role) => <>{role.metadata.name}</>,
    title: (role: Role) => role.metadata.name,
  },
  {
    header: "NAMESPACE",
    width: "20%",
    accessor: (role: Role) => <>{role.metadata.namespace}</>,
  },
  {
    header: "RULES",
    width: "45%",
    accessor: (role: Role) => {
      const ruleCount = role.rules?.length || 0;
      return <>{ruleCount} rule{ruleCount !== 1 ? "s" : ""}</>;
    },
    title: (role: Role) => getRulesString(role),
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (role: Role) => {
      if (!role.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(role.metadata.creationTimestamp);
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

// Filter for roles with specific verbs or resources
export const roleVerbFilter: Filter = {
  name: "roleVerb",
  label: "Verb",
  options: [
    { value: "get", label: "get" },
    { value: "list", label: "list" },
    { value: "watch", label: "watch" },
    { value: "create", label: "create" },
    { value: "update", label: "update" },
    { value: "patch", label: "patch" },
    { value: "delete", label: "delete" },
  ],
  filterFunction: (role: Role, value: string) => {
    if (!role.rules) return false;
    
    return role.rules.some(rule => {
      return rule.verbs.includes(value) || rule.verbs.includes("*");
    });
  },
}; 