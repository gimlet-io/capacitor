// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, JSX } from "solid-js";
import type {
  Kustomization,
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { getHumanReadableStatus } from "../utils/conditions.ts";
import { createNodeWithCardRenderer, createNode, ResourceTree, createPaginationNode } from "../components/ResourceTree.tsx";
import * as graphlib from "graphlib";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { handleFluxReconcile, handleFluxSuspend, handleFluxDiff, handleFluxReconcileWithSources } from "../utils/fluxUtils.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { stringify as stringifyYAML } from "@std/yaml";
import { ResourceTypeVisibilityDropdown } from "../components/ResourceTypeVisibilityDropdown.tsx";

// Utility function to parse inventory entry ID and extract resource info
interface InventoryResourceInfo {
  namespace: string;
  name: string;
  resourceType: string; // e.g., "apps/Deployment", "core/Service"
}

// Define resource types that should be hidden by default
const DEFAULT_HIDDEN_RESOURCE_TYPES = [
  'apps/ReplicaSet',
  'rbac.authorization.k8s.io/Role',
  'rbac.authorization.k8s.io/RoleBinding',
  'rbac.authorization.k8s.io/ClusterRole',
  'rbac.authorization.k8s.io/ClusterRoleBinding',
  'core/ServiceAccount'
];

const MAX_CHILDREN_PER_PAGE = 5;

const parseInventoryEntryId = (id: string): InventoryResourceInfo | null => {
  // Examples:
  // "namespace_name_apps_Deployment" -> { namespace: "namespace", name: "name", resourceType: "apps/Deployment" }
  // "namespace_name__Service" -> { namespace: "namespace", name: "name", resourceType: "core/Service" }
  
  const parts = id.split('_');
  
  if (parts.length < 3) return null;
  
  // Find the resource type part (contains uppercase letter or is empty for core resources)
  let resourceTypeIndex = -1;
  for (let i = 2; i < parts.length; i++) {
    if (parts[i] === '' || /[A-Z]/.test(parts[i])) {
      resourceTypeIndex = i;
      break;
    }
  }
  
  if (resourceTypeIndex === -1) return null;
  
  let namespace: string;
  let name: string;
  let resourceType: string;
  
  if (parts[resourceTypeIndex] === '') {
    // Double underscore case (core API): "namespace_name__Service"
    // name is the part immediately before the empty string
    name = parts[resourceTypeIndex - 1];
    // namespace is everything before the name
    namespace = parts.slice(0, resourceTypeIndex - 1).join('_');
    // resource type is core/Kind
    resourceType = `core/${parts[resourceTypeIndex + 1]}`;
  } else {
    // Group/Kind case: "namespace_name_apps_Deployment"
    // parts[resourceTypeIndex] is the Kind (e.g., "Deployment")
    // parts[resourceTypeIndex - 1] is the Group (e.g., "apps")
    // parts[resourceTypeIndex - 2] is the Name (e.g., "name")
    // everything before that is the Namespace (e.g., "namespace")
    name = parts[resourceTypeIndex - 2];
    namespace = parts.slice(0, resourceTypeIndex - 2).join('_');
    resourceType = `${parts[resourceTypeIndex - 1]}/${parts[resourceTypeIndex]}`;
  }
  
  const result = { namespace, name, resourceType };
  return result;
};

type NamespaceResourceType = {
  namespace: string;
  resourceType: string;
}

// Utility function to get unique resource types from inventory
const getUniqueResourceTypesFromInventory = (inventory: Array<{ id: string; v: string }>): NamespaceResourceType[] => {
  const resourceTypes: NamespaceResourceType[] = [];
  
  inventory.forEach(entry => {
    const parsed = parseInventoryEntryId(entry.id);
    if (parsed && !resourceTypes.some(rt => rt.resourceType === parsed.resourceType && rt.namespace === parsed.namespace)) {
      resourceTypes.push({
        namespace: parsed.namespace,
        resourceType: parsed.resourceType
      });
    }
  });
  
  return resourceTypes;
};

// Helper function to create commit URL for GitHub or GitLab repositories
const createCommitLink = (repoUrl: string, revision: string): string | null => {
  if (!repoUrl || !revision) return null;

  try {
    // Remove potential .git suffix and trailing slashes
    const cleanUrl = repoUrl.replace(/\.git\/?$/, '').replace(/\/$/, '');
    
    if (cleanUrl.includes('github.com')) {
      return `${cleanUrl}/commit/${revision}`;
    } else if (cleanUrl.includes('gitlab.com')) {
      return `${cleanUrl}/-/commit/${revision}`;
    }
    
    // For other Git providers, return null (not clickable)
    return null;
  } catch (error) {
    console.error('Failed to create commit link:', error);
    return null;
  }
};

// Helper function to render revision with shortened SHA
const renderRevision = (revision: string | undefined, sourceKind: string, sourceUrl?: string): JSX.Element => {
  if (!revision) return <span class="value">None</span>;
  
  // Extract the SHA from formats like "master@sha1:b07046644566291cf282070670ba0f99e76e9a7e"
  if (revision.includes('@sha1:')) {
    const parts = revision.split('@sha1:');
    if (parts.length > 1) {
      // Keep the reference (like "master") and the first 9 chars of the SHA
      const reference = parts[0];
      const fullSha = parts[1];
      
      // For git repositories, make it clickable and shortened
      if (sourceKind === 'GitRepository' && sourceUrl) {
        const shortSha = fullSha.substring(0, 9);
        const commitUrl = createCommitLink(sourceUrl, fullSha);
        
        if (commitUrl) {
          return (
            <a 
              href={commitUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              class="value"
              style={{ "text-decoration": "underline", "color": "var(--linear-blue)" }}
            >
              {`${reference}@sha1:${shortSha}`}
            </a>
          );
        }
      }
    }
  }

  return <span class="value">{`${revision}`}</span>;
};

// Add debounce utility function
const debounce = <T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: number | undefined;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = undefined;
    }, ms) as unknown as number;
  };
};

export function KustomizationDetails() {
  const params = useParams();
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const filterStore = useFilterStore(); // some odd thing in solidjs, the filterStore is not used in this component, but it is required to be imported
  const apiResourceStore = useApiResourceStore();
  
  // Create a signal to track if k8sResources is loaded
  const [k8sResourcesLoaded, setK8sResourcesLoaded] = createSignal(false);

  // Initialize state for the specific kustomization and its related resources
  const [kustomization, setKustomization] = createSignal<Kustomization | null>(null);
  const [sourceRepository, setSourceRepository] = createSignal<any | null>(null);
  
  // Dynamic resources state - keyed by resource type
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});

  // Add a signal to track all resource types in the inventory
  const [allResourceTypes, setAllResourceTypes] = createSignal<string[]>([]);
  
  // Add a signal for visible resource types
  const [visibleResourceTypes, setVisibleResourceTypes] = createSignal<Set<string>>(new Set());

  const [graph, setGraph] = createSignal<graphlib.Graph>();

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<
    AbortController[]
  >([]);

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  const [diffData, setDiffData] = createSignal<any>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  
  // Resource visibility functions
  const isResourceTypeVisible = (resourceType: string): boolean => {
    // If the set is empty, all resource types are visible by default
    if (visibleResourceTypes().size === 0) return true;
    return visibleResourceTypes().has(resourceType);
  };

  const toggleResourceTypeVisibility = (resourceType: string): void => {
    setVisibleResourceTypes(prev => {
      const newSet = new Set<string>(prev);

      if (newSet.has(resourceType)) {
        newSet.delete(resourceType);
      } else {
        newSet.add(resourceType);
      }

      return newSet;
    });
  };

  const setAllResourceTypesVisibility = (isVisible: boolean): void => {
    if (isVisible) {
      const newSet = new Set<string>();
      allResourceTypes().forEach(type => {
        newSet.add(type);
      });

      setVisibleResourceTypes(newSet);
    } else {
      setVisibleResourceTypes(new Set<string>([]));
    }
  };
  
  // Click outside handler for dropdown
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (dropdownOpen() && !target.closest('.dropdown-container')) {
      setDropdownOpen(false);
    }
  };

  // Set up click outside listener
  createEffect(() => {
    if (dropdownOpen()) {
      document.addEventListener('click', handleClickOutside);
    } else {
      document.removeEventListener('click', handleClickOutside);
    }
    
    // Clean up event listener when component is unmounted
    onCleanup(() => {
      document.removeEventListener('click', handleClickOutside);
    });
  });

  // Monitor filterStore.k8sResources for changes
  createEffect(() => {
    if (filterStore.k8sResources.length > 0) {
      setK8sResourcesLoaded(true);
    }
  });

  // Set up watches when component mounts or params change
  createEffect(() => {
    if (params.namespace && params.name) {
      setupWatches(params.namespace, params.name);
    }
  });

  // Set up a new effect that triggers when both kustomization and k8sResources are loaded
  createEffect(() => {
    const k = kustomization();
    const resourcesLoaded = k8sResourcesLoaded();

    if (k?.status?.inventory?.entries && resourcesLoaded && params.namespace) {
      setupDynamicWatches(k.status.inventory.entries);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((controller) => controller.abort());
    });
  });

  const setupWatches = (ns: string, name: string) => {
    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources
    setDynamicResources({});

    const watches = [];

    // Always watch for the kustomization itself
    watches.push({
      path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/${ns}/kustomizations?watch=true`,
      callback: (event: { type: string; object: Kustomization }) => {
        if (event.type === "ADDED" || event.type === "MODIFIED") {
          if (event.object.metadata.name === name) {
            setKustomization(event.object);
            
            // When kustomization is updated, check if we need to fetch the source repository
            if (event.object.spec.sourceRef.kind === "GitRepository") {
              fetchSourceRepository(
                event.object.spec.sourceRef.kind,
                event.object.spec.sourceRef.name,
                event.object.spec.sourceRef.namespace || ns
              );
            }
            
            // Set up dynamic watches based on inventory - only if API resources are loaded
            if (event.object.status?.inventory?.entries && k8sResourcesLoaded()) {
              setupDynamicWatches(event.object.status.inventory.entries);
            }
          }
        }
      },
    });

    const controllers = watches.map(({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
  };

  type ExtraWatchConfig = {
    resourceType: string;          // The type of resource to watch 
    isParent: (resource: any, obj: any) => boolean;
  };

  const extraWatches: Record<string, ExtraWatchConfig[]> = {
    'apps/Deployment': [
      {
        resourceType: 'apps/ReplicaSet',
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'Deployment' && owner.name === obj.metadata.name);
        }
      }
    ],
    'apps/ReplicaSet': [
      {
        resourceType: 'core/Pod', 
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'ReplicaSet' && owner.name === obj.metadata.name);
        }
      }
    ],
    'core/PersistentVolumeClaim': [
      {
        resourceType: 'core/PersistentVolume',
        isParent: (resource: any, obj: any) => {
          return resource.spec.claimRef?.name === obj.metadata.name;
        }
      }
    ],
    'batch/CronJob': [
      {
        resourceType: 'batch/Job',
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'CronJob' && owner.name === obj.metadata.name);
        }
      }
    ],
    'bitnami.com/SealedSecret': [
      {
        resourceType: 'core/Secret',
        isParent: (resource: any, obj: any) => {
          return resource.metadata.name === obj.metadata.name && resource.metadata.namespace === obj.metadata.namespace;
        }
      }
    ],
    'keda.sh/ScaledJob': [
      {
        resourceType: 'batch/Job',
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'ScaledJob' && owner.name === obj.metadata.name);
        }
      }
    ],
    'keda.sh/ScaledObject': [
      {
        resourceType: 'apps/Deployment',
        isParent: (resource: any, obj: any) => {
          return resource.spec?.scaleTargetRef?.name === obj.metadata.name && 
                 resource.spec?.scaleTargetRef?.kind === 'Deployment';
        }
      }
    ]
  };

  // Set up dynamic watches based on inventory entries
  const setupDynamicWatches = (inventory: Array<{ id: string; v: string }>) => {
    const resourceTypes = getUniqueResourceTypesFromInventory(inventory);
    
    // Extract resource types from inventory
    const inventoryTypes = resourceTypes.map(rt => rt.resourceType);
    
    // Collect extra watch resource types
    const extraWatchTypes = new Set<string>();
    Object.entries(extraWatches).forEach(([parentType, configs]) => {
      configs.forEach(config => {
        extraWatchTypes.add(config.resourceType);
      });
    });
    
    // Combine inventory types with extra watch types
    const allTypes = [...inventoryTypes];
    extraWatchTypes.forEach(type => {
      if (!allTypes.includes(type)) {
        allTypes.push(type);
      }
    });
    
    // Sort alphabetically by kind
    allTypes.sort((a, b) => {
      const kindA = a.split('/')[1] || '';
      const kindB = b.split('/')[1] || '';
      return kindA.localeCompare(kindB);
    });
    
    // Set all resource types for the visibility dropdown
    setAllResourceTypes(allTypes);

    // Watch inventory resource types
    resourceTypes.forEach(resourceType => {
      watch(resourceType);
    });
    
    // Watch extra resource types that aren't in the inventory
    if (params.namespace) {
      extraWatchTypes.forEach(type => {
        if (!inventoryTypes.includes(type)) {
          watch({ namespace: params.namespace, resourceType: type });
        }
      });
    }
  };

  createEffect(() => {
    const newSet = new Set<string>();
    allResourceTypes().forEach(type => {
      if (!DEFAULT_HIDDEN_RESOURCE_TYPES.includes(type)) {
        newSet.add(type);
      }
    });
    setVisibleResourceTypes(newSet);
  }); 

  const watch = (resourceType: NamespaceResourceType) =>{
    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType.resourceType);
    if (!k8sResource) {
      console.warn(`Unknown resource type in inventory: ${resourceType.resourceType}. Available resource types:`, filterStore.k8sResources.map(r => r.id));
      return;
    }

    let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
    if (k8sResource.namespaced) {
      watchPath = `${k8sResource.apiPath}/namespaces/${resourceType.namespace}/${k8sResource.name}?watch=true`;
    }
      
    const controller = new AbortController();
    watchResource(
      watchPath,
      (event: { type: string; object: any; }) => {
        if (event.type === 'ADDED') {
          setDynamicResources(prev => {
            const current = prev[resourceType.resourceType] || [];
            return {
              ...prev,
              [resourceType.resourceType]: [...current, event.object].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)
              )
            };
          });
        } else if (event.type === 'MODIFIED') {
          setDynamicResources(prev => {
            const current = prev[resourceType.resourceType] || [];
            return {
              ...prev,
              [resourceType.resourceType]: current.map((res: any) => res.metadata.name === event.object.metadata.name &&
                res.metadata.namespace === event.object.metadata.namespace
                ? event.object
                : res
              )
            };
          });
        } else if (event.type === 'DELETED') {
          setDynamicResources(prev => {
            const current = prev[resourceType.resourceType] || [];
            return {
              ...prev,
              [resourceType.resourceType]: current.filter((res: any) => !(res.metadata.name === event.object.metadata.name &&
                res.metadata.namespace === event.object.metadata.namespace)
              )
            };
          });
        }
      },
      controller,
      setWatchStatus
    );
    // Add this controller to the list
    setWatchControllers(prev => [...prev, controller]);

    if (extraWatches[resourceType.resourceType]) {
      extraWatches[resourceType.resourceType].forEach(extraWatch => {
        watch({ namespace: resourceType.namespace, resourceType: extraWatch.resourceType });
      });
    }
  }

  // Fetch source repository when needed
  const fetchSourceRepository = async (kind: string, name: string, namespace: string) => {
    if (kind === "GitRepository") {
      try {
        const controller = new AbortController();
        const path = `/k8s/apis/source.toolkit.fluxcd.io/v1/namespaces/${namespace}/gitrepositories/${name}`;
        
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to fetch source repository: ${response.statusText}`);
        
        const data = await response.json();
        setSourceRepository(data);
      } catch (error) {
        console.error("Error fetching source repository:", error);
      }
    }
  };

  createEffect(() => {
    processDynamicResources(dynamicResources());
  });

  // Debounced function to process dynamic resources
  const processDynamicResources = debounce((dResources: Record<string, any[]>) => {
    // First, reset all children
    Object.entries(dResources).forEach(([resourceType, resources]) => {
      resources.forEach(resource => {
        resource.children = [];
      });
    });
    
    // Then populate children based on extraWatches
    Object.entries(dResources).forEach(([resourceType, resources]) => {
      let watchedBy: string[] = [];
      for (const [key, value] of Object.entries(extraWatches)) {
        if (value.some((extraWatch: ExtraWatchConfig) => extraWatch.resourceType === resourceType)) {
          watchedBy.push(key);
        }
      }
      
      if (watchedBy.length > 0) {
        resources.forEach((resource) => {
          watchedBy.forEach(parentType => {
            const parents = dResources[parentType] || [];
            parents.forEach(parent => {
              if (extraWatches[parentType].some((extraWatch: ExtraWatchConfig) => extraWatch.isParent(resource, parent))) {
                // Add this resource as a child of the parent
                if (!parent.children) {
                  parent.children = [];
                }
                if (!parent.children.find((child: any) => child.metadata.name === resource.metadata.name)) {
                  parent.children.push(resource);
                }
              }
            });
          });
        });
      }
    });
  }, 100);

  createEffect(() => {
    setGraph(createGraph(kustomization()));
  });

  const createGraph = (kustomization: Kustomization | null) => {
    if (!kustomization) return;
    
    const g = new graphlib.Graph({ directed: true });
    g.setGraph({
      rankdir: "LR",
      nodesep: 100,
      ranksep: 80,
      marginx: 20,
      marginy: 20,
      align: "UL", // Upper-Left alignment for nodes in the same rank
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add Kustomization as root node
    const kustomizationId = createNodeWithCardRenderer(
      g,
      `kustomization-${kustomization.metadata.name}`,
      kustomization,
      "kustomize.toolkit.fluxcd.io/Kustomization",
      {
        fill: kustomization.status?.conditions?.some((c) =>
            c.type === "Ready" && c.status === "True"
          )
          ? "#e6f4ea"
          : "#fce8e6",
        stroke: kustomization.status?.conditions?.some((c) =>
          c.type === "Ready" && c.status === "True"
          )
          ? "#137333"
          : "#c5221f",
        strokeWidth: "2"
      }
    );

    const childrenByType = kustomization.status?.inventory?.entries?.reduce((acc: Record<string, any[]>, entry: any) => {
      const parts = entry.id.split('_')
      const childResourceType = (parts[2]=== '' ? 'core' : parts[2]) + '/'+parts[3];
      const childResource = dynamicResources()[childResourceType]?.find((res: any) => res.metadata.name === parts[1]);
      if (childResource) {
        if (!acc[childResourceType]) {
          acc[childResourceType] = [];
        }
        acc[childResourceType].push(childResource);
        
      }
      return acc;
    }, {});

    // Process each resource type group
    Object.entries(childrenByType || {}).forEach(([childResourceType, children]) => {
      if (children.length > MAX_CHILDREN_PER_PAGE) {
        // Paginate if more than MAX_CHILDREN_PER_PAGE children of same type
        const paginationKey = `${kustomizationId}-${childResourceType}`;
        const currentPage = paginationState()[paginationKey] || 0;
        const pageSize = MAX_CHILDREN_PER_PAGE;
        const totalPages = Math.ceil(children.length / pageSize);
        const startIndex = currentPage * pageSize;
        const endIndex = Math.min(startIndex + pageSize, children.length);
        const visibleChildren = children.slice(startIndex, endIndex);

        const paginationResourceId = createNode(g, `pagination-${paginationKey}`, "", {
          fill: "#f8f9fa",
          stroke: "#dee2e6",
          strokeWidth: "1",
          jsxContent: createPaginationNode(
            childResourceType,
            startIndex,
            endIndex,
            totalPages,
            currentPage,
            setPaginationState,
            paginationKey,
            children.length
          ),
          width: 250,
          height: 70
        });

        g.setEdge(kustomizationId, paginationResourceId);

        // Draw visible children connected to pagination node
        visibleChildren.forEach((child: any) => {
          drawResource(g, child, childResourceType, paginationResourceId);
        });
      } else {
        // Less than or equal to MAX_CHILDREN_PER_PAGE, draw normally
        children.forEach((child: any) => {
          drawResource(g, child, childResourceType, kustomizationId);
        });
      }
    });

    return g;
  };

  // Add state for pagination
  const [paginationState, setPaginationState] = createSignal<Record<string, number>>({});

  const drawResource = (g: graphlib.Graph, resource: any, resourceType: string, parentId: string) => {
    const visible = isResourceTypeVisible(resourceType);
    
    let resourceId = null;
    if (visible) {
      resourceId = createNodeWithCardRenderer(
        g,
        `${resourceType.replace('/', '-')}-${resource.metadata.name}`,
        resource,
        resourceType,
        {
          fill: "#e6f4ea",
          stroke: "#137333",
          strokeWidth: "1"
        }
      );
      g.setEdge(parentId, resourceId);
    } else {
      resourceId = parentId; // If not visible, draw its children as a children of the parent
    }

    // Draw children if any
    if (resource.children) {
      const childrenByType = resource.children.reduce((acc: Record<string, any[]>, child: any) => {
        const childResourceType = child.apiVersion === 'v1'? 'core/' + child.kind : (child.apiVersion.split('/')[0] + '/' + child.kind);
        if (!acc[childResourceType]) {
          acc[childResourceType] = [];
        }
        acc[childResourceType].push(child);
        return acc;
      }, {});

      // Process each resource type group
      Object.entries(childrenByType).forEach(entry => {
        const childResourceType = entry[0];
        const children = entry[1] as any[];
        
        if (children.length > MAX_CHILDREN_PER_PAGE) {
          // Paginate if more than MAX_CHILDREN_PER_PAGE children of same type
          const paginationKey = `${resourceId}-${childResourceType}`;
          const currentPage = paginationState()[paginationKey] || 0;
          const pageSize = MAX_CHILDREN_PER_PAGE;
          const totalPages = Math.ceil(children.length / pageSize);
          const startIndex = currentPage * pageSize;
          const endIndex = Math.min(startIndex + pageSize, children.length);
          const visibleChildren = children.slice(startIndex, endIndex);

          const paginationResourceId = createNode(g, `pagination-${paginationKey}`, "", {
            fill: "#f8f9fa",
            stroke: "#dee2e6",
            strokeWidth: "1",
            jsxContent: createPaginationNode(
              childResourceType,
              startIndex,
              endIndex,
              totalPages,
              currentPage,
              setPaginationState,
              paginationKey,
              children.length
            ),
            width: 250,
            height: 70
          });

          g.setEdge(resourceId, paginationResourceId);

          // Draw visible children connected to pagination node
          visibleChildren.forEach((child: any) => {
            drawResource(g, child, childResourceType, paginationResourceId);
          });
        } else {
          // Less than or equal to MAX_CHILDREN_PER_PAGE, draw normally
          children.forEach((child: any) => {
            drawResource(g, child, childResourceType, resourceId);
          });
        }
      });
    }
  };

  const handleBackClick = () => {
    // Global filter state is already maintained by the filter store
    navigate("/");
  };

  return (
    <div class="kustomization-details">
      <Show when={kustomization()} fallback={<div class="loading">Loading...</div>}>
        {(k) => {         
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{k().metadata.namespace}/{k().metadata.name}</h1>
                    <div class="kustomization-status">
                      <span class={`status-badge ${getHumanReadableStatus(k().status?.conditions || []).toLowerCase().replace(/[^a-z]/g, '-')}`}>
                        {getHumanReadableStatus(k().status?.conditions || [])}
                      </span>
                      {k().spec.suspend && (
                        <span class="status-badge suspended">Suspended</span>
                      )}
                    </div>
                  </div>
                  <div class="header-actions">                    
                    <button class="sync-button" onClick={async () => {
                      if (!k()) return;
                      
                      setDiffLoading(true);
                      setDiffDrawerOpen(true);
                      
                      try {
                        const result = await handleFluxDiff(k());
                        setDiffData(result);
                      } catch (error) {
                        console.error("Failed to generate diff:", error);
                        setDiffData(null);
                      } finally {
                        setDiffLoading(false);
                      }
                    }}>Diff</button>
                    <div class="dropdown-container">
                      <div class="split-button">
                        <button 
                          class="sync-button reconcile-button" 
                          onClick={() => {
                            handleFluxReconcile(k());
                            setDropdownOpen(false);
                          }}
                          style={{ 
                            "border-top-right-radius": "0", 
                            "border-bottom-right-radius": "0", 
                            "margin-right": "1px"
                          }}
                        >
                          Reconcile
                        </button>
                        <button 
                          class="sync-button dropdown-toggle" 
                          onClick={(e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen()) }}
                          style={{ 
                            "border-top-left-radius": "0", 
                            "border-bottom-left-radius": "0",
                            "padding": "0 8px",
                            "min-width": "24px"
                          }}
                          aria-label="Show more reconcile options"
                          title="More reconcile options"
                        >
                          <span style={{ "font-size": "10px" }}>▼</span>
                        </button>
                      </div>
                      <Show when={dropdownOpen()}>
                        <div class="context-menu">
                          <div 
                            class="context-menu-item"
                            onClick={() => { 
                              handleFluxReconcileWithSources(k());
                              setDropdownOpen(false);
                            }}
                          >
                            <span>Reconcile with sources</span>
                          </div>
                        </div>
                      </Show>
                    </div>
                    {k().spec.suspend ? (
                      <button 
                        class="sync-button resume"
                        style={{ "background-color": "#188038", "color": "white" }}
                        onClick={() => {
                          handleFluxSuspend(k(), false) // Resume
                            .catch(error => {
                              console.error("Failed to resume kustomization:", error);
                            });
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>▶</span> Resume
                      </button>
                    ) : (
                      <button 
                        class="sync-button suspend"
                        onClick={() => {
                          handleFluxSuspend(k(), true) // Suspend
                            .catch(error => {
                              console.error("Failed to suspend kustomization:", error);
                            });
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>⏸</span> Suspend
                      </button>
                    )}
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Source:</span>
                      <span class="value">{k().spec.sourceRef.kind}/{k().spec.sourceRef.namespace ? `${k().spec.sourceRef.namespace}/` : ''}{k().spec.sourceRef.name}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Path:</span>
                      <span class="value">{k().spec.path}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Interval:</span>
                      <span class="value">{k().spec.interval}</span>
                    </div>
                    {k().status?.conditions?.find(c => c.type === 'Ready') && (
                      <div class="info-item full-width">
                        <div class="info-grid">
                        <div class="info-item" style={{ "grid-column": "1 / 3" }}>
                          <span class="label">Message:</span>
                          <span class="value">{k().status?.conditions?.find(c => c.type === 'Ready')?.message}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Last Transition:</span>
                          <span class="value">{new Date(k().status?.conditions?.find(c => c.type === 'Ready')?.lastTransitionTime || '').toLocaleString()}</span>
                        </div>
                        </div>
                      </div>
                    )}
                    {k().status && (
                      <div class="info-item full-width">
                        <div class="info-grid">
                          <div class="info-item" style={{ "grid-column": "1 / 3" }}>
                            <span class="label">Last Attempted Revision:</span>
                            {renderRevision(k().status?.lastAttemptedRevision, k().spec.sourceRef.kind, sourceRepository()?.spec?.url )}
                          </div>
                          <div class="info-item">
                            <span class="label">Last Handled Reconcile:</span>
                            <span class="value">{new Date(k().status?.lastHandledReconcileAt || '').toLocaleString()}</span>
                          </div>
                          <div class="info-item" style={{ "grid-column": "4 / 6" }}>
                            <span class="label">Last Applied Revision:</span>
                            {renderRevision(k().status?.lastAppliedRevision, k().spec.sourceRef.kind, sourceRepository()?.spec?.url )}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div class="info-item full-width">
                      <details>
                        <summary>Conditions</summary>
                        <pre class="conditions-yaml">
                          {k().status?.conditions ? stringifyYAML(k().status?.conditions) : 'No conditions available'}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>
              <div class="resource-tree-wrapper">
                <ResourceTree
                  g={graph}
                  resourceTypeVisibilityDropdown={<ResourceTypeVisibilityDropdown 
                      resourceTypes={allResourceTypes()}
                      visibleResourceTypes={visibleResourceTypes()}
                      toggleResourceTypeVisibility={toggleResourceTypeVisibility}
                      setAllResourceTypesVisibility={setAllResourceTypesVisibility}
                    />}
                />
              </div>
            </>
          );
        }}
      </Show>
      
      {/* Diff Drawer */}
      <Show when={diffDrawerOpen()}>
        <DiffDrawer
          resource={kustomization()!}
          diffData={diffData()}
          isOpen={diffDrawerOpen()}
          onClose={() => {
            setDiffDrawerOpen(false);
            setDiffData(null);
            setDiffLoading(false);
          }}
          loading={diffLoading()}
        />
      </Show>
    </div>
  );
}
