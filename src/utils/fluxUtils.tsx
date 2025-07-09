import { ConditionStatus, ConditionType } from "./conditions.ts";
import { Filter } from "../components/filterBar/FilterBar.tsx";

// Generic interface for Flux resources with suspend and conditions
interface FluxResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    [key: string]: any;
  };
  spec: {
    suspend?: boolean;
    [key: string]: any;
  };
  status?: {
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime: string;
    }>;
    [key: string]: any;
  };
}

/**
 * A reusable "Ready" filter for all Flux CD resources
 */
export const fluxReadyFilter: Filter = {
  name: "Ready",
  label: "Ready",
  type: "select",
  options: [
    {
      label: "Ready",
      value: ConditionStatus.True,
      color: "var(--linear-green)",
    },
    {
      label: "Not Ready",
      value: ConditionStatus.False,
      color: "var(--linear-red)",
    },
    {
      label: "Unknown",
      value: ConditionStatus.Unknown,
      color: "var(--linear-text-tertiary)",
    },
    { label: "Suspended", value: "Suspended", color: "var(--linear-blue)" },
  ],
  multiSelect: true,
  filterFunction: (resource: FluxResource, value: string) => {
    if (value === "Suspended") {
      if (resource.spec.suspend) return true;
      else return false;
    } else {
      const readyCondition = resource.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return readyCondition?.status === value;
    }
  },
};

/**
 * Generic reconcile function for Flux CD resources
 * The backend API expects lowercase resource kinds in its lookup table,
 * though it has logic to handle capitalized resource kinds as well.
 */
export async function handleFluxReconcile(resource: FluxResource) {
  try {
    const response = await fetch('/api/flux/reconcile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: resource.kind,
        name: resource.metadata.name,
        namespace: resource.metadata.namespace,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to reconcile resource');
    }

    const data = await response.json();
    console.log(data.message);
    return data;
  } catch (error) {
    console.error('Error reconciling resource:', error);
    throw error;
  }
}

/**
 * Generic reconcile function for Flux CD resources with sources
 * Equivalent to running `flux reconcile <kind> <name> --with-sources`
 */
export async function handleFluxReconcileWithSources(resource: FluxResource) {
  try {
    const response = await fetch('/api/flux/reconcile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: resource.kind,
        name: resource.metadata.name,
        namespace: resource.metadata.namespace,
        withSources: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to reconcile resource with sources');
    }

    const data = await response.json();
    console.log(data.message);
    return data;
  } catch (error) {
    console.error('Error reconciling resource with sources:', error);
    throw error;
  }
}

export async function handleFluxSuspend(resource: FluxResource, suspend: boolean = true) {
  try {
    const response = await fetch('/api/flux/suspend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: resource.kind,
        name: resource.metadata.name,
        namespace: resource.metadata.namespace,
        suspend: suspend,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to suspend resource');
    }

    const data = await response.json();
    console.log(data.message);
    return data;
  } catch (error) {
    console.error(`Error ${suspend ? 'suspending' : 'resuming'} resource:`, error);
    throw error;
  }
}

export async function handleFluxDiff(resource: any): Promise<any> {
  try {
    const response = await fetch("/api/flux/diff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: resource.metadata.name,
        namespace: resource.metadata.namespace,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.fluxResult;
  } catch (error) {
    console.error("Error generating diff:", error);
    throw error;
  }
} 