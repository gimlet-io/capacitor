// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { ConditionStatus, ConditionType } from "./conditions.ts";
import { Filter } from "../components/filterBar/FilterBar.tsx";

// Generic interface for Flux resources with suspend and conditions
interface FluxResource {
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