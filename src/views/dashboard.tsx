import { createSignal, createResource, createEffect, untrack, createMemo } from "solid-js";
import { DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList, ResourceList } from "../components/index.ts";
import { FilterBar, Filter, ActiveFilter, FilterOption } from "../components/filterBar/FilterBar.tsx";
import { ViewBar } from "../components/viewBar/ViewBar.tsx";
import type { 
  Pod, 
  Deployment, 
  ServiceWithResources, 
  Kustomization, 
  ArgoCDApplication, 
  Service, 
  DeploymentWithResources,
  ApiResource,
  ApiResourceList,
  ApiGroupList,
  K8sResource
} from "../types/k8s.ts";
import { Show } from "solid-js";
import { updateServiceMatchingResources, updateDeploymentMatchingResources } from "../utils/k8s.ts";
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

  // Resource state
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [deployments, setDeployments] = createSignal<DeploymentWithResources[]>([]);
  const [services, setServices] = createSignal<ServiceWithResources[]>([]);
  const [kustomizations, setKustomizations] = createSignal<Kustomization[]>([]);
  const [applications, setApplications] = createSignal<ArgoCDApplication[]>([]);
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});

  // Define core resource mappings (instead of baseResourceTypes)
  const coreResourceMappings = [
    { 
      id: 'core/Pod',
      filters: [podsStatusFilter],
      kind: 'Pod',
      group: 'core',
      version: 'v1',
      apiPath: '/k8s/api/v1',
      name: 'pods'
    },
    { 
      id: 'core/Service',
      kind: 'Service', 
      group: 'core',
      version: 'v1',
      apiPath: '/k8s/api/v1',
      filters: [],
      name: 'services'
    },
    { 
      id: 'apps/Deployment',
      kind: 'Deployment', 
      group: 'apps',
      version: 'v1',
      apiPath: '/k8s/apis/apps/v1',
      filters: [],
      name: 'deployments'
    },
    { 
      id: 'kustomize.toolkit.fluxcd.io/Kustomization',
      kind: 'Kustomization', 
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      apiPath: '/k8s/apis/kustomize.toolkit.fluxcd.io/v1',
      filters: [kustomizationReadyFilter],
      name: 'kustomizations'
    },
    { 
      id: 'argoproj.io/Application',
      kind: 'Application', 
      group: 'argoproj.io',
      version: 'v1alpha1',
      apiPath: '/k8s/apis/argoproj.io/v1alpha1',
      filters: [argocdApplicationSyncFilter, argocdApplicationHealthFilter],
      name: 'applications'
    }
  ];

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

  // Create the ResourceTypes dynamically based on API resources
  const ResourceTypes = createMemo(() => {
    // Start with our core resources that we want to prioritize
    const resources = [...coreResourceMappings];
    
    if (apiResources()) {
      // Add additional resources from the API
      const additionalResources = apiResources()!
        .filter(resource => 
          // Avoid duplicates with core resources by checking for existing value and kind+group combinations
          !resources.some(existing => 
            existing.id === `${resource.group || 'core'}/${resource.kind}` || 
            (existing.kind === resource.kind && existing.group === resource.group)
          ) &&
          // Filter out some system resources we don't want to show
          !['componentstatuses', 'bindings', 'endpoints'].includes(resource.name)
        )
        .map(resource => ({
          id: `${resource.group || 'core'}/${resource.kind}`,
          filters: [] as Filter[],
          group: resource.group || 'core',
          version: resource.version || 'v1',
          kind: resource.kind,
          apiPath: resource.apiPath || '/k8s/api/v1',
          name: resource.name
        }));
      
      resources.push(...additionalResources);
    }

    console.log('resources', resources);
    setAvailableResources(resources);
    return resources;
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

  const resourceTypeFilter: Filter = {
    name: "ResourceType",
    type: "select",
    options: coreResourceMappings.map(type => ({ value: type.id, label: type.kind })),
    multiSelect: false,
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
  };

  const nameFilter: Filter = {
    name: "Name",
    type: "text",
    placeholder: "Filter by name",
    filterFunction: (resource: any, value: string) => {
      return resource.metadata.name.toLowerCase().includes(value.toLowerCase());
    }
  };
  
  // Create filterRegistry dynamically from ResourceTypes
  const filterRegistry = createMemo<Record<string, Filter>>(() => {
    const registry: Record<string, Filter> = {
      "Namespace": namespaceFilter,
      "Name": nameFilter,
      "ResourceType": resourceTypeFilter,
    };

    ResourceTypes().forEach(type => {
      type.filters.forEach(filter => {
        registry[filter.name] = filter;
      });
    });

    return registry;
  });

  const handleFilterChange = (filters: ActiveFilter[]) => {
    setActiveFilters(filters);
    
    // Update namespace and resourceType signals based on active filters
    const nsFilter = filters.find(f => f.filter.name === "Namespace");
    if (nsFilter) {
      setNamespace(nsFilter.value);
    }
    
    const rtFilter = filters.find(f => f.filter.name === "ResourceType");
    if (rtFilter) {
      // Check if it's a valid resource type
      const isValidResourceType = ResourceTypes().some(rt => rt.id === rtFilter.value);
      if (isValidResourceType) {
        setResourceType(rtFilter.value);
      }
    }
  };

  const updateFilters = (ns: string, resType: string, filters: ActiveFilter[]) => {
    setNamespace(ns);
    setResourceType(resType);
    setActiveFilters(filters);
  };

  // Update active filters when namespace or resourceType changes
  createEffect(() => {
    const currentNamespace = namespace();
    const currentResourceType = resourceType();
    
    if (!currentNamespace || !currentResourceType) return;
    
    // Create new active filters array
    const newFilters = [...activeFilters()];
    
    // Update namespace filter
    const existingNamespaceIndex = newFilters.findIndex(f => f.filter.name === "Namespace");
    if (existingNamespaceIndex >= 0) {
      newFilters[existingNamespaceIndex] = { filter: namespaceFilter, value: currentNamespace };
    } else {
      newFilters.push({ filter: namespaceFilter, value: currentNamespace });
    }
    
    // Update resource type filter
    const existingResourceTypeIndex = newFilters.findIndex(f => f.filter.name === "ResourceType");
    if (existingResourceTypeIndex >= 0) {
      newFilters[existingResourceTypeIndex] = { filter: resourceTypeFilter, value: currentResourceType };
    } else {
      newFilters.push({ filter: resourceTypeFilter, value: currentResourceType });
    }
    
    // Only update if needed to avoid infinite loops
    if (JSON.stringify(newFilters) !== JSON.stringify(activeFilters())) {
      setActiveFilters(newFilters);
    }
  });

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
    if (!ns) return;
    console.log('Setting up watches for namespace:', ns, 'resource type:', resourceFilter);

    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources
    setPods(() => []);
    setDeployments(() => []);
    setServices(() => []);
    setKustomizations(() => []);
    setApplications(() => []);
    setDynamicResources(() => ({}));

    const watches = [];

    const namespacePath = ns === 'all-namespaces' ? '' : `/namespaces/${ns}`;

    // Standard resource types
    if (resourceFilter === 'core/Pod' || resourceFilter === 'core/Service' || resourceFilter === 'apps/Deployment') {
      watches.push(
        {
          path: `/k8s/api/v1${namespacePath}/pods?watch=true`,
          callback: (event: { type: string; object: Pod }) => {
            if (event.type === 'ADDED') {
              setPods(prev => [...prev, event.object]);
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, [...pods(), event.object], deployments())));
            } else if (event.type === 'MODIFIED') {
              setPods(prev => prev.map(p => p.metadata.name === event.object.metadata.name ? event.object : p));
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            } else if (event.type === 'DELETED') {
              setPods(prev => prev.filter(p => p.metadata.name !== event.object.metadata.name));
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            }
          }
        },
        {
          path: `/k8s/apis/apps/v1${namespacePath}/deployments?watch=true`,
          callback: (event: { type: string; object: Deployment }) => {
            if (event.type === 'ADDED') {
              setDeployments(prev => [...prev, updateDeploymentMatchingResources(event.object, pods())]);
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), [...deployments(), event.object])));
            } else if (event.type === 'MODIFIED') {
              setDeployments(prev => prev.map(d => d.metadata.name === event.object.metadata.name ? updateDeploymentMatchingResources(event.object, pods()) : d));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            } else if (event.type === 'DELETED') {
              setDeployments(prev => prev.filter(d => d.metadata.name !== event.object.metadata.name));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            }
          }
        },
        {
          path: `/k8s/api/v1${namespacePath}/services?watch=true`,
          callback: (event: { type: string; object: Service }) => {
            if (event.type === 'ADDED') {
              setServices(prev => [...prev, updateServiceMatchingResources(event.object, pods(), deployments())]);
            } else if (event.type === 'MODIFIED') {
              setServices(prev => prev.map(s => 
                s.metadata.name === event.object.metadata.name 
                  ? updateServiceMatchingResources(event.object, pods(), deployments())
                  : s
              ));
            } else if (event.type === 'DELETED') {
              setServices(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
            }
          }
        }
      );
    }

    if (resourceFilter === 'kustomize.toolkit.fluxcd.io/Kustomization') {
      watches.push(
        {
          path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1${namespacePath}/kustomizations?watch=true`,
          callback: (event: { type: string; object: Kustomization }) => {
            if (event.type === 'ADDED') {
              setKustomizations(prev => [...prev, event.object]);
            } else if (event.type === 'MODIFIED') {
              setKustomizations(prev => prev.map(k => k.metadata.name === event.object.metadata.name ? event.object : k));
            } else if (event.type === 'DELETED') {
              setKustomizations(prev => prev.filter(k => k.metadata.name !== event.object.metadata.name));
            }
          }
        }
      );
    }

    if (resourceFilter === 'argoproj.io/Application') {
      watches.push(
        {
          path: `/k8s/apis/argoproj.io/v1alpha1${namespacePath}/applications?watch=true`,
          callback: (event: { type: string; object: ArgoCDApplication }) => {
            if (event.type === 'ADDED') {
              setApplications(prev => [...prev, event.object]);
            } else if (event.type === 'MODIFIED') {
              setApplications(prev => prev.map(a => a.metadata.name === event.object.metadata.name ? event.object : a));
            } else if (event.type === 'DELETED') {
              setApplications(prev => prev.filter(a => a.metadata.name !== event.object.metadata.name));
            }
          }
        }
      );
    }

    // Dynamic resource watch
    const selectedResource = availableResources().find(res => res.id === resourceFilter);
    
    if (selectedResource && 
        !['core/Pod', 'core/Service', 'apps/Deployment', 'kustomize.toolkit.fluxcd.io/Kustomization', 'argoproj.io/Application'].includes(resourceFilter)) {
      
      const apiPath = selectedResource.apiPath;
      const resourceName = selectedResource.name || resourceFilter;
      
      if (apiPath && resourceName) {
        watches.push({
          path: `${apiPath}${namespacePath}/${resourceName}?watch=true`,
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

  // Update namespaceFilter options when namespaces resource changes
  createEffect(() => {
    namespaceFilter.options = namespaceOptions();
  });

  // Update the options when ResourceTypes changes
  createEffect(() => {
    resourceTypeFilter.options = ResourceTypes().map(type => ({
      value: type.id,
      label: type.kind
    }));
  });

  return (
    <div class="layout">
      <main class="main-content">
        <ViewBar
          filterRegistry={filterRegistry()}
          updateFilters={updateFilters}
          watchStatus={watchStatus()}
          namespace={namespace() || 'all-namespaces'}
          resourceType={resourceType()}
          activeFilters={activeFilters()}
        />
        
        <FilterBar 
          filters={[namespaceFilter, resourceTypeFilter, nameFilter, ...(ResourceTypes().find(t => t.id === resourceType())?.filters || [])]}
          activeFilters={activeFilters()}
          onFilterChange={handleFilterChange}
        />

        <section class="resource-section full-width">
          <Show when={resourceType() === 'core/Service'}>
            <ServiceList 
              services={services()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'apps/Deployment'}>
            <DeploymentList 
              deployments={deployments()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'core/Pod'}>
            <ResourceList 
              resources={pods()} 
              columns={podColumns}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'kustomize.toolkit.fluxcd.io/Kustomization'}>
            <FluxResourceList 
              kustomizations={kustomizations()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          <Show when={resourceType() === 'argoproj.io/Application'}>
            <ArgoCDResourceList 
              applications={applications()}
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
          
          <Show when={!['core/Pod', 'core/Service', 'apps/Deployment', 'kustomize.toolkit.fluxcd.io/Kustomization', 'argoproj.io/Application'].includes(resourceType())}>
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
              activeFilters={activeFilters().filter(f => f.filter.name !== "Namespace" && f.filter.name !== "ResourceType")}
            />
          </Show>
        </section>
      </main>
    </div>
  );
}