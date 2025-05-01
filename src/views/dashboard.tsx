import { createSignal, createResource, createEffect, untrack, createMemo } from "solid-js";
import { DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList, ResourceList } from "../components/index.ts";
import { FilterBar, Filter, FilterOption } from "../components/filterBar/FilterBar.tsx";
import { ViewBar, ActiveFilter } from "../components/viewBar/ViewBar.tsx";
import type { 
  ApiResource,
  ApiResourceList,
  ApiGroupList,
  K8sResource
} from "../types/k8s.ts";
import { Show } from "solid-js";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";
import { podColumns, podsStatusFilter } from "../components/resourceList/PodList.tsx";
import { kustomizationReadyFilter } from "../components/resourceList/FluxResourceList.tsx";
import { argocdApplicationSyncFilter, argocdApplicationHealthFilter } from "../components/resourceList/ArgoCDResourceList.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";

export function Dashboard() {
  const [namespace, setNamespace] = createSignal<string>();
  const [resourceType, setResourceType] = createSignal<string>('core/Pod');
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  const [activeFilters, setActiveFilters] = createSignal<ActiveFilter[]>([]);
  const [availableResources, setAvailableResources] = createSignal<K8sResource[]>([]);
  const [filterRegistry, setFilterRegistry] = createSignal<Record<string, Filter>>({});

  // Resource state
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});

  // Define dynamic resource filters
  const dynamicResourceFilters: Record<string, Filter[]> = {
    'kustomize.toolkit.fluxcd.io/Kustomization': [kustomizationReadyFilter],
    'argoproj.io/Application': [argocdApplicationSyncFilter, argocdApplicationHealthFilter],
    'core/Pod': [podsStatusFilter]
  };

  // Fetch available API resources
  const [apiResources] = createResource(async () => {
    try {
      // Fetch core API resources (v1)
      const coreResponse = await fetch('/k8s/api/v1');
      const coreData = await coreResponse.json() as ApiResourceList;
      const coreResources = coreData.resources.map(resource => ({
        ...resource,
        group: '',
        version: 'v1',
        apiPath: '/k8s/api/v1'
      })).sort((a, b) => a.name.localeCompare(b.name)); // Sort core resources alphabetically
      
      // Fetch API groups
      const groupsResponse = await fetch('/k8s/apis');
      const groupsData = await groupsResponse.json() as ApiGroupList;
      
      // Prepare priority groups first (apps/v1 and networking.k8s.io/v1)
      let appsResources: ApiResource[] = [];
      let networkingResources: ApiResource[] = [];
      let otherGroupResources: ApiResource[] = [];
      
      // Fetch resources for each API group
      const groupResourcesPromises = groupsData.groups.map(async (group) => {
        try {
          const groupVersionResponse = await fetch(`/k8s/apis/${group.preferredVersion.groupVersion}`);
          const groupVersionData = await groupVersionResponse.json() as ApiResourceList;
          
          const resources = groupVersionData.resources.map(resource => ({
            ...resource,
            group: group.name,
            version: group.preferredVersion.version,
            apiPath: `/k8s/apis/${group.preferredVersion.groupVersion}`
          })).sort((a, b) => a.name.localeCompare(b.name)); // Sort resources within each group
          
          return { 
            groupName: group.name, 
            resources 
          };
        } catch (error) {
          console.error(`Error fetching resources for group ${group.name}:`, error);
          return { 
            groupName: group.name, 
            resources: [] 
          };
        }
      });
      
      const groupResourcesResults = await Promise.all(groupResourcesPromises);
      
      // Sort groups alphabetically
      groupResourcesResults.sort((a, b) => a.groupName.localeCompare(b.groupName));
      
      // Split into priority groups and others
      for (const groupResult of groupResourcesResults) {
        if (groupResult.groupName === 'apps') {
          appsResources = groupResult.resources;
        } else if (groupResult.groupName === 'networking.k8s.io') {
          networkingResources = groupResult.resources;
        } else {
          otherGroupResources = [...otherGroupResources, ...groupResult.resources];
        }
      }
      
      // Combine all resources in the desired order: core -> apps -> networking -> others
      const allApiResources = [
        ...coreResources, 
        ...appsResources,
        ...networkingResources,
        ...otherGroupResources
      ];
      
      // Filter to include only resources that support listing (have 'list' in verbs)
      // and aren't subresources (don't contain '/')
      return allApiResources.filter(resource => 
        resource.verbs.includes('list') && 
        !resource.name.includes('/') &&
        resource.kind // Ensure it has a kind
      );
    } catch (error) {
      console.error("Error fetching API resources:", error);
      return [];
    }
  });

  const [namespaces] = createResource(async () => {
    const response = await fetch('/k8s/api/v1/namespaces');
    const data = await response.json();
    const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
    return nsList;
  });

  const namespaceOptions = createMemo<FilterOption[]>(() => {
    if (!namespaces()) return [{ value: 'all-namespaces', label: 'All Namespaces' }];
    return [
      { value: 'all-namespaces', label: 'All Namespaces' },
      ...namespaces()!.map((ns: string) => ({ value: ns, label: ns }))
    ];
  });

  const namespaceFilter: Filter = {
    name: "Namespace",
    type: "select",
    options: namespaceOptions(),
    multiSelect: false,
    filterFunction: () => true
  };

  const nameFilter: Filter = {
    name: "Name",
    type: "text",
    placeholder: "Filter by name",
    filterFunction: (resource: any, value: string) => {
      return resource.metadata.name.toLowerCase().includes(value.toLowerCase());
    }
  };

  // Create a reactive computed value for the resourceTypeFilter
  const resourceTypeFilter = createMemo<Filter>(() => ({
    name: "ResourceType",
    type: "select",
    options: availableResources().map(type => ({ value: type.id, label: type.kind })),
    multiSelect: false,
    searchable: true,
    filterFunction: () => true,
    renderOption: (option) => {
      const resource = availableResources().find(res => res.id === option.value);
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

  // Update namespaceFilter options when namespaces resource changes
  createEffect(() => {
    namespaceFilter.options = namespaceOptions();
  });

  createEffect(() => {        
    if (!apiResources()) {
      return;
    }

    const resources : K8sResource[] = apiResources()!
      .map(resource => {
        const resourceId = `${resource.group || 'core'}/${resource.kind}`;
        const resourceFilters = [];
        if (resource.namespaced) {
          resourceFilters.push(namespaceFilter);
        }
        resourceFilters.push(nameFilter);
        resourceFilters.push(...(dynamicResourceFilters[resourceId] || []));

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

    setAvailableResources(resources);
  });
  
  // Create filterRegistry dynamically from Available Resources
  createEffect(() => {
    const registry: Record<string, Filter> = {
      "ResourceType": resourceTypeFilter(),
    };

    // Add all filters from all resources to the registry
    availableResources().forEach(type => {
      type.filters.forEach(filter => {
        if (!registry[filter.name]) {
          registry[filter.name] = filter;
        }
      });
    });

    setFilterRegistry(registry);
  });

  const handleFilterChange = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
    
    // Update namespace and resourceType signals based on active filters
    const nsFilter = filters.find(f => f.filter.name === "Namespace");
    if (nsFilter) {
      setNamespace(nsFilter.value);
    } else {
      setNamespace(''); // Clear namespace if filter is removed
    }
    
    const rtFilter = filters.find(f => f.filter.name === "ResourceType");
    if (rtFilter) {
      setResourceType(rtFilter.value);
    }
  };

  const updateFilters = (ns: string, resType: string, filters: ActiveFilter[]) => {
    setNamespace(ns);
    setResourceType(resType);
    setActiveFilters(filters);
  };

  // Update active filters when resourceType changes
  createEffect(() => {
    const currentResourceType = resourceType();
    if (!currentResourceType) return;
    
    const selectedResource = availableResources().find(res => res.id === currentResourceType);
    if (!selectedResource) return;
    
    // Create new active filters array with resource type filter
    const newFilters = activeFilters().filter(f => f.filter.name !== "ResourceType");
    
    // Add resource type filter
    newFilters.push({ 
      filter: resourceTypeFilter(), 
      value: currentResourceType 
    });
    
    // Only update if needed to avoid infinite loops
    if (JSON.stringify(newFilters) !== JSON.stringify(activeFilters())) {
      setActiveFilters(newFilters);
    }
  });

  // Set default namespace when namespaces are loaded
  createEffect(() => {
    if (!namespaces()) {
      return;
    }
    if (namespaces().includes("flux-system")) {
      setNamespace("flux-system");
    } else {
      setNamespace(namespaces()![0]);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {
    setupWatches(namespace(), resourceType());
  });

  const setupWatches = (ns: string | undefined, resourceFilter: string) => {
    if (!resourceFilter) return;

    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources
    setDynamicResources(() => ({}));

    const watches = [];
    const selectedResource = availableResources().find(res => res.id === resourceFilter);
    
    if (selectedResource) {
      const apiPath = selectedResource.apiPath;
      const resourceName = selectedResource.name || resourceFilter;
      const isNamespaced = selectedResource.namespaced;
      
      // Only use namespace path if the resource is namespaced and we have a valid namespace
      let watchPath = `${apiPath}/${resourceName}?watch=true`;
      
      if (isNamespaced && ns && ns !== 'all-namespaces') {
        watchPath = `${apiPath}/namespaces/${ns}/${resourceName}?watch=true`;
      }
      
      if (apiPath && resourceName) {
        watches.push({
          path: watchPath,
          callback: (event: { type: string; object: any }) => {
            if (event.type === 'ADDED') {
              setDynamicResources(prev => {
                const current = prev[resourceFilter] || [];
                return { ...prev, [resourceFilter]: [...current, event.object] };
              });
            } else if (event.type === 'MODIFIED') {
              setDynamicResources(prev => {
                const current = prev[resourceFilter] || [];
                return { 
                  ...prev, 
                  [resourceFilter]: current.map((res: any) => 
                    res.metadata.name === event.object.metadata.name ? event.object : res
                  )
                };
              });
            } else if (event.type === 'DELETED') {
              setDynamicResources(prev => {
                const current = prev[resourceFilter] || [];
                return { 
                  ...prev, 
                  [resourceFilter]: current.filter((res: any) => 
                    res.metadata.name !== event.object.metadata.name
                  )
                };
              });
            }
          }
        });
      }
    }

    const controllers = watches.map(({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
  };

  return (
    <div class="layout">
      <main class="main-content">
        <ViewBar
          filterRegistry={filterRegistry}
          updateFilters={updateFilters}
          watchStatus={watchStatus()}
          namespace={namespace() || 'all-namespaces'}
          resourceType={resourceType()}
          activeFilters={activeFilters()}
          namespaced={(resource) => resource?.namespaced ?? true}
        />
        
        <FilterBar 
          filters={[resourceTypeFilter(), ...(availableResources().find(t => t.id === resourceType())?.filters || [])]}
          activeFilters={activeFilters()}
          onFilterChange={handleFilterChange}
        />

        <section class="resource-section full-width">
          {/* Special rendering for known resource types */}
          <Show when={resourceType() === 'core/Pod'}>
            <ResourceList 
              resources={dynamicResources()['core/Pod'] || []} 
              columns={podColumns}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'apps/Deployment'}>
            <DeploymentList 
              deployments={dynamicResources()['apps/Deployment'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'core/Service'}>
            <ServiceList 
              services={dynamicResources()['core/Service'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'kustomize.toolkit.fluxcd.io/Kustomization'}>
            <FluxResourceList 
              kustomizations={dynamicResources()['kustomize.toolkit.fluxcd.io/Kustomization'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'argoproj.io/Application'}>
            <ArgoCDResourceList 
              applications={dynamicResources()['argoproj.io/Application'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType")}
            />
          </Show>
          
          {/* Default rendering for other resource types */}
          <Show when={!['core/Pod', 'apps/Deployment', 'core/Service', 'kustomize.toolkit.fluxcd.io/Kustomization', 'argoproj.io/Application'].includes(resourceType())}>
            <ResourceList 
              resources={dynamicResources()[resourceType()] || []} 
              columns={[
                { 
                  header: "Name", 
                  width: "40%", 
                  accessor: (item) => <>{item.metadata?.name || ""}</> 
                },
                { 
                  header: "Namespace", 
                  width: "30%", 
                  accessor: (item) => <>{item.metadata?.namespace || ""}</> 
                },
                { 
                  header: "Age", 
                  width: "30%", 
                  accessor: (item) => useCalculateAge(item.metadata?.creationTimestamp || '')()
                }
              ]}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType")}
            />
          </Show>
        </section>
      </main>
    </div>
  );
}
