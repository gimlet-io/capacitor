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
import { updateDeploymentMatchingResources, updateServiceMatchingResources } from "../utils/k8s.ts";

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

  // Define extra watches for certain resource types
  type ResourceUpdater = (mainResource: any, extraResources: any[]) => any;
  type ExtraWatchConfig = {
    resourceType: string;          // The type of resource to watch 
    updater: ResourceUpdater;      // Function to update main resource with the extra resource data
    isNamespaced?: boolean;        // Whether this resource is namespaced
    apiPath?: string;              // API path override (if different from default)
  };

  /**
   * Configuration for extra watches that maintain relationships between resources.
   * 
   * For example, when viewing Deployments, we also watch Pods to show which pods
   * belong to each deployment.
   * 
   * The structure is:
   * {
   *   'mainResourceType': [
   *     {
   *       resourceType: 'relatedResourceType',  // The type of resource to watch
   *       updater: (mainResource, relatedResources) => updatedMainResource,
   *       // Optional API path and namespace configuration if needed
   *     }
   *   ]
   * }
   * 
   * The updater function is called when:
   * 1. The main resource is added or modified
   * 2. Any related resource is added, modified, or deleted
   * 
   * To add additional relationships, add more entries to this object.
   */
  const extraWatches: Record<string, ExtraWatchConfig[]> = {
    'apps/Deployment': [
      {
        resourceType: 'core/Pod',
        updater: (deployment, pods) => updateDeploymentMatchingResources(deployment, pods)
      }
    ],
    'core/Service': [
      {
        resourceType: 'core/Pod',
        updater: (service, pods) => {
          // We need to temporarily store pods separately for the second updater
          // but the matchingPods field will be properly populated in the second updater
          return { ...service, _tempPods: pods };
        }
      },
      {
        resourceType: 'apps/Deployment',
        updater: (service, deployments) => {
          // Get the pods from the temporary field
          const allPods = service._tempPods || [];
          // Create a clean version of service without the temp field
          const { _tempPods, ...cleanService } = service;
          // Use the utility function that correctly sets matchingPods and matchingDeployments
          return updateServiceMatchingResources(cleanService, allPods, deployments);
        }
      }
    ]
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

  const updateFilters = (resourceType: string, filters: ActiveFilter[]) => {
    setResourceType(resourceType);
    setActiveFilters(filters);
    
    // Extract namespace from filters if present
    const namespaceFilter = filters.find(f => f.filter.name === "Namespace");
    if (namespaceFilter) {
      setNamespace(namespaceFilter.value);
    } else {
      setNamespace('');
    }
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

  // Maintain resources for each extra watch
  const extraResources: Record<string, any[]> = {};

  /**
   * Sets up watches for the selected resource type and any related resources
   * configured in extraWatches.
   * 
   * @param ns The selected namespace or undefined for all namespaces
   * @param resourceFilter The selected resource type to watch
   */
  const setupWatches = (ns: string | undefined, resourceFilter: string) => {
    if (!resourceFilter) return;

    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources and cache
    setDynamicResources(() => ({}));
    Object.keys(extraResources).forEach(key => {
      extraResources[key] = [];
    });
    
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
                
                // Check if we need to apply extra resource updates
                const extraWatchesForResource = extraWatches[resourceFilter];
                let enhancedResource = event.object;
                
                if (extraWatchesForResource && extraWatchesForResource.length > 0) {
                  // Apply all updaters to the new resource
                  extraWatchesForResource.forEach(config => {
                    const extraResources = extraResources[config.resourceType] || [];
                    enhancedResource = config.updater(enhancedResource, extraResources);
                  });
                }
                
                return { ...prev, [resourceFilter]: [...current, enhancedResource] };
              });
            } else if (event.type === 'MODIFIED') {
              setDynamicResources(prev => {
                const current = prev[resourceFilter] || [];
                
                // Check if we need to apply extra resource updates
                const extraWatchesForResource = extraWatches[resourceFilter];
                let enhancedResource = event.object;
                
                if (extraWatchesForResource && extraWatchesForResource.length > 0) {
                  // Apply all updaters to the modified resource
                  extraWatchesForResource.forEach(config => {
                    const extraResources = extraResources[config.resourceType] || [];
                    enhancedResource = config.updater(enhancedResource, extraResources);
                  });
                }
                
                return { 
                  ...prev, 
                  [resourceFilter]: current.map((res: any) => 
                    res.metadata.name === event.object.metadata.name ? enhancedResource : res
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

      // Set up extra watches if configured for this resource type
      const extraWatchesForResource = extraWatches[resourceFilter];
      if (extraWatchesForResource && extraWatchesForResource.length > 0) {
        // For each extra watch configuration
        extraWatchesForResource.forEach(config => {
          const extraResourceType = config.resourceType;
          const extraResource = availableResources().find(res => res.id === extraResourceType);
          
          if (!extraResource) return;
          
          // Determine the API path for this resource
          const extraApiPath = config.apiPath || extraResource.apiPath;
          const extraResourceName = extraResource.name;
          const extraIsNamespaced = config.isNamespaced !== undefined ? config.isNamespaced : extraResource.namespaced;
          
          // Set up watch for this extra resource
          let extraWatchPath = `${extraApiPath}/${extraResourceName}?watch=true`;
          if (extraIsNamespaced && ns && ns !== 'all-namespaces') {
            extraWatchPath = `${extraApiPath}/namespaces/${ns}/${extraResourceName}?watch=true`;
          }
          
          watches.push({
            path: extraWatchPath,
            callback: (event: { type: string; object: any }) => {
              // Update cache based on event type
              if (event.type === 'ADDED') {
                extraResources[extraResourceType] = [
                  ...(extraResources[extraResourceType] || []),
                  event.object
                ];
              } else if (event.type === 'MODIFIED') {
                extraResources[extraResourceType] = (extraResources[extraResourceType] || [])
                  .map(item => item.metadata.name === event.object.metadata.name ? event.object : item);
              } else if (event.type === 'DELETED') {
                extraResources[extraResourceType] = (extraResources[extraResourceType] || [])
                  .filter(item => item.metadata.name !== event.object.metadata.name);
              }
              
              // Update dynamic resources state
              setDynamicResources(prev => {
                // Update the extra resource collection
                const newState = { 
                  ...prev,
                  [extraResourceType]: extraResources[extraResourceType] 
                };
                
                // Update the main resources using the updater function
                const mainResources = prev[resourceFilter] || [];
                if (mainResources.length > 0) {
                  // Apply this updater to each main resource
                  let updatedResources = mainResources.map(resource => 
                    config.updater(resource, extraResources[extraResourceType] || [])
                  );
                  
                  // For resources with multiple watches, we need to make sure all updaters are applied
                  const otherExtraWatches = extraWatchesForResource.filter(w => w !== config);
                  if (otherExtraWatches.length > 0) {
                    otherExtraWatches.forEach(otherConfig => {
                      // Get the cache for this other watch type
                      const otherResources = extraResources[otherConfig.resourceType] || [];
                      // Apply the other updater to each resource
                      updatedResources = updatedResources.map(resource => 
                        otherConfig.updater(resource, otherResources)
                      );
                    });
                  }
                  
                  newState[resourceFilter] = updatedResources;
                }
                
                return newState;
              });
            }
          });
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
          resourceType={resourceType()}
          activeFilters={activeFilters()}
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
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType" && f.filter.name !== "Namespace")}
            />
          </Show>
          <Show when={resourceType() === 'apps/Deployment'}>
            <DeploymentList 
              deployments={dynamicResources()['apps/Deployment'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType" && f.filter.name !== "Namespace")}
            />
          </Show>
          <Show when={resourceType() === 'core/Service'}>
            <ServiceList 
              services={dynamicResources()['core/Service'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType" && f.filter.name !== "Namespace")}
            />
          </Show>
          <Show when={resourceType() === 'kustomize.toolkit.fluxcd.io/Kustomization'}>
            <FluxResourceList 
              kustomizations={dynamicResources()['kustomize.toolkit.fluxcd.io/Kustomization'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType" && f.filter.name !== "Namespace")}
            />
          </Show>
          <Show when={resourceType() === 'argoproj.io/Application'}>
            <ArgoCDResourceList 
              applications={dynamicResources()['argoproj.io/Application'] || []}
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType" && f.filter.name !== "Namespace")}
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
              activeFilters={activeFilters().filter(f => f.filter.name !== "ResourceType" && f.filter.name !== "Namespace")}
            />
          </Show>
        </section>
      </main>
    </div>
  );
}
