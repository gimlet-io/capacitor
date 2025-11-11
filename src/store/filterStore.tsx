// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createContext, createSignal, useContext, JSX, createEffect, createMemo } from "solid-js";
import type { Filter, FilterOption, FilterType } from "../components/filterBar/FilterBar.tsx";
import { useApiResourceStore } from "./apiResourceStore.tsx";
import type { K8sResource } from "../types/k8s.ts";
import { resourceTypeConfigs } from "../resourceTypeConfigs.tsx";
import { parseGlobFilter, matchGlobPatterns } from "../utils/glob.ts";

// Global filter store - manages cluster-wide resources and filter definitions
interface FilterState {
  // Global filter definitions and registry
  filterRegistry: Record<string, Filter>;

  // Available K8s resources from cluster
  k8sResources: K8sResource[];
  
  // Get filters for a specific resource type
  getFiltersForResource: (resourceTypeId: string) => Filter[];
}

const FilterContext = createContext<FilterState>();

export function FilterProvider(props: { children: JSX.Element }) {
  const [k8sResources, setK8sResources] = createSignal<K8sResource[]>([]);
  const [filterRegistry, setFilterRegistry] = createSignal<Record<string, Filter>>({});
  const apiResourceStore = useApiResourceStore();

  const nameFilter: Filter = {
    name: "Name",
    label: "Name",
    type: "text" as FilterType,
    placeholder: "glob support: *, ?, [abc], !pattern",
    filterFunction: (resource: any, value: string) => {
      const patterns = parseGlobFilter(value);
      return matchGlobPatterns(patterns, resource.metadata.name);
    }
  };

  // Parse a simple label selector string like:
  // key=value, key!=value, key (existence)
  const parseLabelSelector = (value: string): Array<{ key: string; op: 'eq' | 'neq' | 'exists'; val?: string }> => {
    return value
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(token => {
        const neqIndex = token.indexOf('!=');
        if (neqIndex > -1) {
          const key = token.slice(0, neqIndex).trim();
          const val = token.slice(neqIndex + 2).trim();
          return { key, op: 'neq' as const, val };
        }
        const eqIndex = token.indexOf('=');
        if (eqIndex > -1) {
          const key = token.slice(0, eqIndex).trim();
          const val = token.slice(eqIndex + 1).trim();
          return { key, op: 'eq' as const, val };
        }
        return { key: token.trim(), op: 'exists' as const };
      });
  };

  const getLabelMapForResource = (resource: any): Record<string, string> => {
    if (!resource) return {};
    // Services use spec.selector to select pods
    if (resource?.kind === 'Service') {
      const selector = resource?.spec?.selector || {};
      return selector || {};
    }
    // Default to metadata.labels
    return (resource?.metadata?.labels || {}) as Record<string, string>;
  };

  const labelSelectorFilter: Filter = {
    name: "LabelSelector",
    label: "Label",
    type: "text" as FilterType,
    placeholder: "app=web,tier=frontend or key!=val or key",
    filterFunction: (resource: any, value: string) => {
      const constraints = parseLabelSelector(value);
      if (constraints.length === 0) return true;
      const labels = getLabelMapForResource(resource);
      for (const c of constraints) {
        const current = labels[c.key];
        if (c.op === 'exists') {
          if (current === undefined) return false;
          continue;
        }
        if (c.op === 'eq') {
          if (current !== c.val) return false;
          continue;
        }
        if (c.op === 'neq') {
          if (current === c.val) return false;
          continue;
        }
      }
      return true;
    }
  };


  const namespaceOptions = createMemo<FilterOption[]>(() => {
    const namespaces = apiResourceStore.namespaces;
    if (!namespaces) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
    return [
      { value: 'all-namespaces', label: 'All Namespaces' },
      ...namespaces.map((ns: string) => ({ value: ns, label: ns }))
    ];
  });

  const namespaceFilter = createMemo<Filter>(() => ({
    name: "Namespace",
    label: "Namespace",
    type: "select" as FilterType,
    get options() { return namespaceOptions(); },
    multiSelect: false,
    filterFunction: () => true
  }));

  const resourceTypeFilter = createMemo<Filter>(() => ({
    name: "ResourceType",
    label: "Resource Type",
    type: "select" as FilterType,
    options: k8sResources().map(type => ({ value: type.id, label: type.kind })),
    multiSelect: false,
    searchable: true,
    filterFunction: () => true,
    renderOption: (option: FilterOption) => {
      const resource = k8sResources().find(res => res.id === option.value);
      if (!resource) {
        return option.label;
      }
      
      // Always show group, using "core" for resources without a specific group
      const groupName = resource.group || "core";
      
      return (
        <>
          {resource.kind} <span style="color: var(--linear-text-tertiary);">&nbsp;{groupName}</span>
        </>
      );
    }
  }));


  // Setup k8sResources when apiResources changes
  createEffect(() => {        
    const apiResources = apiResourceStore.apiResources;
    if (!apiResources) {
      return;
    }

    const resources: K8sResource[] = apiResources
      .map((resource: any) => {
        const resourceId = `${resource.group || 'core'}/${resource.kind}`;
        const resourceFilters = [];
        if (resource.namespaced) {
          resourceFilters.push(namespaceFilter());
        }
        resourceFilters.push(nameFilter);
        // Add label selector filter to Pods and Services
        if (resource.kind === 'Pod' || resource.kind === 'Service') {
          resourceFilters.push(labelSelectorFilter);
        }
        
        resourceFilters.push(...(resourceTypeConfigs[resourceId]?.filter || []));

        return {
          id: resourceId,
          filters: resourceFilters,
          group: resource.group || 'core',
          version: resource.version || 'v1',
          kind: resource.kind,
          apiPath: resource.apiPath || '/k8s/api/v1',
          name: resource.name,
          namespaced: resource.namespaced
        };
      });

    // Add Helm releases as a special resource type
    const ctxName = encodeURIComponent(apiResourceStore.contextInfo?.current || '');
    const helmReleaseResource: K8sResource = {
      id: 'helm.sh/Release',
      filters: [namespaceFilter(), nameFilter, ...(resourceTypeConfigs['helm.sh/Release']?.filter || [])],
      group: 'helm.sh',
      version: 'v3',
      kind: 'Release',
      apiPath: ctxName ? `/api/${ctxName}/helm/releases` : '/api/helm/releases',
      name: 'releases',
      namespaced: true
    };

    resources.push(helmReleaseResource);

    setK8sResources(resources);
  });

  // Create filterRegistry dynamically from Available Resources
  createEffect(() => {
    const registry: Record<string, Filter> = {
      "ResourceType": resourceTypeFilter(),
    };

    // Add all filters from all resources to the registry
    k8sResources().forEach(type => {
      type.filters.forEach(filter => {
        if (!registry[filter.name]) {
          registry[filter.name] = filter;
        }
      });
    });

    setFilterRegistry(registry);
  });

  // Helper function to get filters for a specific resource type
  const getFiltersForResource = (resourceTypeId: string): Filter[] => {
    const resource = k8sResources().find(res => res.id === resourceTypeId);
    if (!resource) return [];
    return [resourceTypeFilter(), ...resource.filters];
  };

  const store: FilterState = {
    get filterRegistry() { return filterRegistry(); },
    get k8sResources() { return k8sResources(); },
    getFiltersForResource,
  };

  return (
    <FilterContext.Provider value={store}>
      {props.children}
    </FilterContext.Provider>
  );
}

export function useFilterStore() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error("useFilterStore must be used within a FilterProvider");
  }
  return context;
} 