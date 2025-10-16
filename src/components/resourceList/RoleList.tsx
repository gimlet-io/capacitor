// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { Role, ClusterRole } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';
import { createMemo, createSignal } from "solid-js";
import { DetailRowCard } from "./DetailRowCard.tsx";

type RuleRow = {
  resources: string[];
  nonResourceURLs: string[];
  resourceNames: string[];
  verbs: string[];
};

const RoleRulesTable = (props: { rules: Array<{ apiGroups?: string[]; resources?: string[]; resourceNames?: string[]; verbs: string[]; nonResourceURLs?: string[] }>; columnCount: number }) => {
  const [expanded, setExpanded] = createSignal(false);
  const rows = createMemo<RuleRow[]>(() => {
    return (props.rules || []).map(rule => {
      const apiGroups = (rule.apiGroups && rule.apiGroups.length > 0 ? rule.apiGroups : [""]).map(g => g || "core");
      const resources = rule.resources && rule.resources.length > 0 ? rule.resources : ["*"];
      const combos: string[] = [];
      for (const g of apiGroups) {
        for (const r of resources) combos.push(`${g}/${r}`);
      }
      return {
        resources: combos,
        nonResourceURLs: rule.nonResourceURLs || [],
        resourceNames: rule.resourceNames || [],
        verbs: rule.verbs || [],
      } as RuleRow;
    });
  });
  const visible = createMemo(() => expanded() ? rows() : rows().slice(0, 3));
  return (
    <DetailRowCard columnCount={props.columnCount} style="display: flex; gap: 24px;">
      <div style="display: contents;">
        <div style="width: 70%;">
          <div style="display: flex; flex-direction: column; gap: 8px; border-spacing: 20px 0;">
            {/* Header row */}
            <div style="display: flex; gap: 20px; font-weight: bold; padding-bottom: 8px;">
              <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">Resources</div>
              <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">Non-Resource URLs</div>
              <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">Resource Names</div>
              <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">Verbs</div>
            </div>
            {/* Data rows */}
            {visible().map(row => (
              <div style="display: flex; gap: 20px; padding: 4px 0;">
                <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">{row.resources.join(', ')}</div>
                <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">{`[${row.nonResourceURLs.join(' ')}]`}</div>
                <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">{`[${row.resourceNames.join(' ')}]`}</div>
                <div style="flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word;">{`[${row.verbs.join(' ')}]`}</div>
              </div>
            ))}
          </div>
          {rows().length > 3 && (
            <button type="button" class="outline" onClick={() => setExpanded(!expanded())} style="margin-top: 8px;">
              {expanded() ? 'Show less' : `Show all ${rows().length}`}
            </button>
          )}
        </div>
      </div>
    </DetailRowCard>
  );
};

export const renderRoleDetails = (item: { rules?: Array<{ apiGroups?: string[]; resources?: string[]; resourceNames?: string[]; verbs: string[]; nonResourceURLs?: string[] }> }, columnCount = 3) => {
  const rules = item.rules || [];
  return <RoleRulesTable rules={rules} columnCount={columnCount} />;
};

// Define the columns for the Role resource list
export const roleColumns = [
  {
    header: "NAME",
    width: "40%",
    accessor: (role: Role) => <>{role.metadata.name}</>,
    title: (role: Role) => role.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "RULES",
    width: "15%",
    accessor: (role: Role) => <>{role.rules?.length || 0}</>,
    title: (role: Role) => `${role.rules?.length || 0} rules`,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (role: Role) => 
      useCalculateAge(role.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];

// Define the columns for the ClusterRole resource list (kubectl: NAME, AGE)
export const clusterRoleColumns = [
  {
    header: "NAME",
    width: "40%",
    accessor: (cr: ClusterRole) => <>{cr.metadata.name}</>,
    title: (cr: ClusterRole) => cr.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "RULES",
    width: "15%",
    accessor: (cr: ClusterRole) => <>{cr.rules?.length || 0}</>,
    title: (cr: ClusterRole) => `${cr.rules?.length || 0} rules`,
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (cr: ClusterRole) => 
      useCalculateAge(cr.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
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