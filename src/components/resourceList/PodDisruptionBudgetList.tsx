// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { JSX } from "solid-js";
import type { PodDisruptionBudget } from "../../types/k8s.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByAge, sortByName } from "../../utils/sortUtils.ts";

function formatMinAvailable(spec: PodDisruptionBudget["spec"]): string {
  const value = spec?.minAvailable;
  if (value === undefined || value === null) return "N/A";
  return typeof value === "number" ? String(value) : value;
}

function formatMaxUnavailable(spec: PodDisruptionBudget["spec"]): string {
  const value = spec?.maxUnavailable;
  if (value === undefined || value === null) return "N/A";
  return typeof value === "number" ? String(value) : value;
}

function getAllowedDisruptions(pdb: PodDisruptionBudget): { element: JSX.Element; title: string } {
  const allowed = pdb.status?.disruptionsAllowed ?? 0;
  const currentHealthy = pdb.status?.currentHealthy ?? 0;
  const desiredHealthy = pdb.status?.desiredHealthy ?? 0;
  const expectedPods = pdb.status?.expectedPods ?? 0;
  return {
    element: <>{allowed}</>,
    title: `Allowed: ${allowed}, CurrentHealthy: ${currentHealthy}, DesiredHealthy: ${desiredHealthy}, ExpectedPods: ${expectedPods}`,
  };
}

export const podDisruptionBudgetColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (pdb: PodDisruptionBudget) => <>{pdb.metadata.name}</>,
    title: (pdb: PodDisruptionBudget) => pdb.metadata.name,
    sortable: true,
    sortFunction: (items: PodDisruptionBudget[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "MIN AVAILABLE",
    width: "15%",
    accessor: (pdb: PodDisruptionBudget) => <>{formatMinAvailable(pdb.spec)}</>,
    title: (pdb: PodDisruptionBudget) => `Min available: ${formatMinAvailable(pdb.spec)}`,
  },
  {
    header: "MAX UNAVAILABLE",
    width: "15%",
    accessor: (pdb: PodDisruptionBudget) => <>{formatMaxUnavailable(pdb.spec)}</>,
    title: (pdb: PodDisruptionBudget) => `Max unavailable: ${formatMaxUnavailable(pdb.spec)}`,
  },
  {
    header: "ALLOWED DISRUPTIONS",
    width: "15%",
    accessor: (pdb: PodDisruptionBudget) => getAllowedDisruptions(pdb).element,
    title: (pdb: PodDisruptionBudget) => getAllowedDisruptions(pdb).title,
    sortable: true,
    sortFunction: (items: PodDisruptionBudget[], ascending: boolean) => {
      return [...items].sort((a, b) => {
        const aVal = a.status?.disruptionsAllowed ?? 0;
        const bVal = b.status?.disruptionsAllowed ?? 0;
        return ascending ? aVal - bVal : bVal - aVal;
      });
    },
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (pdb: PodDisruptionBudget) => useCalculateAge(pdb.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: PodDisruptionBudget[], ascending: boolean) => sortByAge(items, ascending),
  },
];


