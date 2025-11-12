// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, JSX } from "solid-js";
import type {
  Kustomization,
  ExtendedKustomization,
  GitRepository,
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";
import { createNodeWithCardRenderer, createNode, ResourceTree, createPaginationNode } from "../components/ResourceTree.tsx";
import * as graphlib from "graphlib";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { handleFluxReconcile, handleFluxSuspend, handleFluxDiff, handleFluxReconcileWithSources } from "../utils/fluxUtils.tsx";
import { checkPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { stringify as stringifyYAML } from "@std/yaml";
import { ResourceTypeVisibilityDropdown } from "../components/ResourceTypeVisibilityDropdown.tsx";
import { ExtraWatchConfig, resourceTypeConfigs } from "../resourceTypeConfigs.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { Tabs } from "../components/Tabs.tsx";
import type { Event } from "../types/k8s.ts";
import { EventList } from "../components/resourceList/EventList.tsx";

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

// Normalize a Git repo URL to HTTPS form (handles ssh/scp-like formats)
const normalizeGitUrlToHttps = (repoUrl: string): string => {
  const trimmed = (repoUrl || '').trim();

  // Already HTTP(S)
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\.git\/?$/, '').replace(/\/$/, '');
  }

  // SCP-like: git@host:org/repo(.git)
  const scpLike = trimmed.match(/^git@([^:\/]+):(.+)$/i);
  if (scpLike) {
    const host = scpLike[1];
    const path = scpLike[2].replace(/\.git\/?$/, '').replace(/\/$/, '');
    return `https://${host}/${path}`;
  }

  // ssh:// (optionally git+ssh://): ssh://user@host[:port]/org/repo(.git)
  const sshLike = trimmed.match(/^(?:git\+)?ssh:\/\/(?:[^@]+@)?([^\/:]+)(?::\d+)?\/(.+)$/i);
  if (sshLike) {
    const host = sshLike[1];
    const path = sshLike[2].replace(/\.git\/?$/, '').replace(/\/$/, '');
    return `https://${host}/${path}`;
  }

  // Fallback: just remove .git and trailing slash
  return trimmed.replace(/\.git\/?$/, '').replace(/\/$/, '');
};

// Helper function to create commit URL for GitHub or GitLab repositories
const createCommitLink = (repoUrl: string, revision: string): string | null => {
  if (!repoUrl || !revision) return null;

  try {
    const cleanUrl = normalizeGitUrlToHttps(repoUrl);
    
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

// Add throttle utility function
const throttle = <T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): ((...args: Parameters<T>) => void) => {
  let lastExecution = 0;
  let pendingExecution: { args: Parameters<T>; timeout: number } | null = null;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    
    // If enough time has passed since last execution, run immediately
    if (now - lastExecution >= ms) {
      lastExecution = now;
      fn(...args);
      
      // Clear any pending execution
      if (pendingExecution) {
        clearTimeout(pendingExecution.timeout);
        pendingExecution = null;
      }
    } 
    // Otherwise schedule for next interval
    else if (!pendingExecution) {
      const timeUntilNextExecution = ms - (now - lastExecution);
      
      pendingExecution = {
        args,
        timeout: setTimeout(() => {
          if (pendingExecution) {
            lastExecution = Date.now();
            fn(...pendingExecution.args);
            pendingExecution = null;
          }
        }, timeUntilNextExecution) as unknown as number
      };
    }
  };
};

export function KustomizationDetails() {
  const params = useParams();
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const filterStore = useFilterStore(); // some odd thing in solidjs, the filterStore is not used in this component, but it is required to be imported
  const apiResourceStore = useApiResourceStore();
  const [canReconcile, setCanReconcile] = createSignal<boolean | undefined>(undefined);
  const [canReconcileWithSources, setCanReconcileWithSources] = createSignal<boolean | undefined>(undefined);
  const [canPatchKustomization, setCanPatchKustomization] = createSignal<boolean | undefined>(undefined);
  
  // Create a signal to track if k8sResources is loaded
  const [k8sResourcesLoaded, setK8sResourcesLoaded] = createSignal(false);

  // Initialize state for the specific kustomization and its related resources
  const [kustomization, setKustomization] = createSignal<ExtendedKustomization | null>(null);
  
  // Dynamic resources state - keyed by resource type
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, any[]>>({});

  // Add a signal to track all resource types in the inventory
  const [allResourceTypes, setAllResourceTypes] = createSignal<string[]>([]);
  
  // Add a signal for visible resource types
  const [visibleResourceTypes, setVisibleResourceTypes] = createSignal<Set<string>>(new Set());

  const [graph, setGraph] = createSignal<graphlib.Graph>();
  const [dependenciesGraph, setDependenciesGraph] = createSignal<graphlib.Graph>();
  // Tab state for main content
  const [activeMainTab, setActiveMainTab] = createSignal<"resource" | "dependencies" | "events">("resource");

  // Keep a list of all kustomizations across namespaces (for dependency graph)
  const [allKustomizations, setAllKustomizations] = createSignal<Kustomization[]>([]);


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
  
  // Batch queues and timers per resource type id (to avoid flooding renders)
  type K8sObjMinimal = { metadata?: { name?: string; namespace?: string } };
  const batchQueues: Record<string, Array<{ type: 'ADDED' | 'MODIFIED' | 'DELETED'; object: K8sObjMinimal }>> = {};
  const batchTimers: Record<string, number | undefined> = {};
  // Track active watches to avoid duplicate subscriptions per (namespace, resourceType)
  const activeWatchKeys = new Set<string>();
  
  const scheduleFlush = (resourceTypeId: string) => {
    if (batchTimers[resourceTypeId] !== undefined) return;
    batchTimers[resourceTypeId] = setTimeout(() => {
      const changes = batchQueues[resourceTypeId] || [];
      batchQueues[resourceTypeId] = [];
      batchTimers[resourceTypeId] = undefined;
      if (changes.length === 0) return;

      setDynamicResources(prev => {
        const current = prev[resourceTypeId] || [];
        // Build index by namespace/name for efficient updates
        const keyOf = (obj: K8sObjMinimal) => `${obj?.metadata?.namespace || ''}/${obj?.metadata?.name || ''}`;
        const keyToIndex = new Map<string, number>();
        for (let i = 0; i < current.length; i++) {
          keyToIndex.set(keyOf(current[i] as K8sObjMinimal), i);
        }
        const next = current.slice();

        for (const evt of changes) {
          const key = keyOf(evt.object);
          if (!key) continue;
          const idx = keyToIndex.get(key);
          if (evt.type === 'DELETED') {
            if (idx !== undefined) {
              next.splice(idx, 1);
              keyToIndex.delete(key);
              // Rebuild remaining indexes lazily only when needed
            }
          } else {
            if (idx === undefined) {
              keyToIndex.set(key, next.length);
              next.push(evt.object);
            } else {
              next[idx] = evt.object;
            }
          }
        }

        // Sort once per flush (stable display)
        next.sort((a, b) => (a?.metadata?.name || '').localeCompare(b?.metadata?.name || ''));
        return { ...prev, [resourceTypeId]: next };
      });
    }, 16) as unknown as number;
  };
  
  // Resource visibility functions
  const isResourceTypeVisible = (resourceType: string): boolean => {
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

  // Compute permissions for actions on the Kustomization
  createEffect(() => {
    const k = kustomization();
    if (!k) {
      setCanReconcile(undefined);
      setCanReconcileWithSources(undefined);
      setCanPatchKustomization(undefined);
      return;
    }
    const res: MinimalK8sResource = { apiVersion: k.apiVersion, kind: k.kind, metadata: { name: k.metadata.name, namespace: k.metadata.namespace } };
    (async () => {
      const canPatch = await checkPermissionSSAR(res, { verb: 'patch' }, apiResourceStore.apiResources as any);
      setCanReconcile(canPatch);
      setCanPatchKustomization(canPatch);
      if (k.spec?.sourceRef?.kind && k.spec?.sourceRef?.name) {
        const srcRes: MinimalK8sResource = {
          apiVersion: (k.spec as any).sourceRef.apiVersion || '',
          kind: k.spec.sourceRef.kind,
          metadata: { name: k.spec.sourceRef.name, namespace: k.spec.sourceRef.namespace || k.metadata.namespace }
        };
        const canPatchSrc = await checkPermissionSSAR(srcRes, { verb: 'patch' }, apiResourceStore.apiResources as any);
        setCanReconcileWithSources(canPatch && canPatchSrc);
      } else {
        setCanReconcileWithSources(canPatch);
      }
    })();
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((controller) => controller.abort());
    });
    // Clear any pending batch timers
    Object.keys(batchTimers).forEach((k) => {
      if (batchTimers[k] !== undefined) {
        clearTimeout(batchTimers[k]!);
        batchTimers[k] = undefined;
      }
    });
    // Clear active watch registry
    activeWatchKeys.clear();
  });

  const setupWatches = (ns: string, name: string) => {
    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    // Clear existing resources
    setDynamicResources({});
    // Reset batch state
    Object.keys(batchQueues).forEach((k) => (batchQueues[k] = []));
    Object.keys(batchTimers).forEach((k) => {
      if (batchTimers[k] !== undefined) {
        clearTimeout(batchTimers[k]!);
        batchTimers[k] = undefined;
      }
    });
    // Reset active watch registry so fresh subscriptions can be created
    activeWatchKeys.clear();
    // Reset all kustomizations cache for dependency graph
    setAllKustomizations([]);

    const watches: Array<{ path: string; callback: (event: any) => void; params?: Record<string, string> }> = [];

    // Always watch for the kustomization itself (namespaced)
    watches.push({
      path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/${ns}/kustomizations?watch=true`,
      callback: (event: { type: string; object: Kustomization }) => {
        if (event.type === "ADDED" || event.type === "MODIFIED") {
          if (event.object.metadata.name === name) {
            setKustomization(prev => {
              if (!prev) return {...event.object, events: [], source: undefined};
              return {
                ...prev,
                ...event.object
              };
            });
            
            // Set up dynamic watches based on inventory - only if API resources are loaded
            if (event.object.status?.inventory?.entries && k8sResourcesLoaded()) {
              setupDynamicWatches(event.object.status.inventory.entries);
            }
          }
        }
      },
    }); 

    // Cluster-wide watch to maintain a full list of Kustomizations for dependency graph
    watches.push({
      path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations?watch=true`,
      callback: (event: { type: string; object: Kustomization }) => {
        if (event.type === 'ADDED') {
          setAllKustomizations(prev => {
            const exists = prev.find(r => r.metadata.name === event.object.metadata.name && r.metadata.namespace === event.object.metadata.namespace);
            return exists ? prev.map(r => (r.metadata.name === event.object.metadata.name && r.metadata.namespace === event.object.metadata.namespace) ? event.object : r) : [...prev, event.object];
          });
        } else if (event.type === 'MODIFIED') {
          setAllKustomizations(prev => prev.map(r => (r.metadata.name === event.object.metadata.name && r.metadata.namespace === event.object.metadata.namespace) ? event.object : r));
        } else if (event.type === 'DELETED') {
          setAllKustomizations(prev => prev.filter(r => !(r.metadata.name === event.object.metadata.name && r.metadata.namespace === event.object.metadata.namespace)));
        }
      }
    });

    const extraResources: Record<string, any[]> = {};
    const extraWatchesForResource = resourceTypeConfigs['kustomize.toolkit.fluxcd.io/Kustomization']?.extraWatches || [];
    extraWatchesForResource.forEach((config: ExtraWatchConfig) => {
      const extraResourceType = config.resourceType;
      const extraResource = filterStore.k8sResources.find(res => res.id === extraResourceType);
      
      if (!extraResource) return;
      
      // Set up watch for this extra resource
      let extraWatchPath = `${extraResource.apiPath}/${extraResource.name}?watch=true`;
      if (extraResource.namespaced && ns && ns !== 'all-namespaces') {
        extraWatchPath = `${extraResource.apiPath}/namespaces/${ns}/${extraResource.name}?watch=true`;
      }
      
      watches.push({
        path: extraWatchPath,
        callback: (event: { type: string; object: any; error?: string; path?: string }) => {
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
          
          setKustomization(prev => {
            const updated = config.updater(prev, extraResources[extraResourceType] || [])
            if (!prev) return null;
            return {
              ...prev,
              ...updated
            };
          });
        },
        // Include projection fields if provided for this extra watch
        params: (Array.isArray(config.projectFields) && config.projectFields.length > 0)
          ? { fields: JSON.stringify(config.projectFields) }
          : undefined
      });
    });

    const controllers = watches.map(({ path, callback, params }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus, undefined, apiResourceStore.contextInfo?.current, params);
      return controller;
    });

    setWatchControllers(controllers);
  };

  const extraWatches: Record<string, ExtraWatchConfig[]> = {
    'apps/Deployment': [
      {
        resourceType: 'apps/ReplicaSet',
        updater: (deployment, pods) => {},
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'Deployment' && owner.name === obj.metadata.name);
        }
      }
    ],
    'apps/ReplicaSet': [
      {
        resourceType: 'core/Pod', 
        updater: (replicaSet, pods) => {},
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'ReplicaSet' && owner.name === obj.metadata.name);
        }
      }
    ],
    'core/PersistentVolumeClaim': [
      {
        resourceType: 'core/PersistentVolume',
        updater: (pvc, pv) => {},
        isParent: (resource: any, obj: any) => {
          return resource.spec.claimRef?.name === obj.metadata.name;
        }
      }
    ],
    'batch/CronJob': [
      {
        resourceType: 'batch/Job',
        updater: (cronJob, job) => {},
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'CronJob' && owner.name === obj.metadata.name);
        }
      }
    ],
    'bitnami.com/SealedSecret': [
      {
        resourceType: 'core/Secret',
        updater: (sealedSecret, secret) => {},
        isParent: (resource: any, obj: any) => {
          return resource.metadata.name === obj.metadata.name && resource.metadata.namespace === obj.metadata.namespace;
        }
      }
    ],
    'keda.sh/ScaledJob': [
      {
        resourceType: 'batch/Job',
        updater: (scaledJob, job) => {},
        isParent: (resource: any, obj: any) => {
          return resource.metadata.ownerReferences?.some((owner: any) => owner.kind === 'ScaledJob' && owner.name === obj.metadata.name);
        }
      }
    ],
    'keda.sh/ScaledObject': [
      {
        resourceType: 'apps/Deployment',
        updater: (scaledObject, deployment) => {},
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

    // Deduplicate per (namespace, resourceType)
    const watchKey = `${resourceType.namespace}|${resourceType.resourceType}`;
    if (activeWatchKeys.has(watchKey)) {
      return;
    }
    activeWatchKeys.add(watchKey);

    let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
    if (k8sResource.namespaced) {
      watchPath = `${k8sResource.apiPath}/namespaces/${resourceType.namespace}/${k8sResource.name}?watch=true`;
    }

    const controller = new AbortController();
    watchResource(
      watchPath,
      (event: { type: string; object?: K8sObjMinimal; }) => {
        if (event.type === 'ERROR' || !event.object) return;
        // Queue event and schedule a flush for this resource type
        (batchQueues[resourceType.resourceType] ||= []).push({ type: event.type as 'ADDED' | 'MODIFIED' | 'DELETED', object: event.object });
        scheduleFlush(resourceType.resourceType);
      },
      controller,
      setWatchStatus,
      undefined,
      apiResourceStore.contextInfo?.current
    );
    // Add this controller to the list
    setWatchControllers(prev => [...prev, controller]);

    if (extraWatches[resourceType.resourceType]) {
      extraWatches[resourceType.resourceType].forEach(extraWatch => {
        watch({ namespace: resourceType.namespace, resourceType: extraWatch.resourceType });
      });
    }
  }

  createEffect(() => {
    processDynamicResources(dynamicResources());
  });

  // Debounced function to process dynamic resources
  const processDynamicResources = throttle((dResources: Record<string, any[]>) => {
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

  // Recompute dependency graph when root kustomization or namespace list changes
  createEffect(() => {
    setDependenciesGraph(createDependenciesGraph(kustomization(), allKustomizations()));
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
      if (children.length > MAX_CHILDREN_PER_PAGE && isResourceTypeVisible(childResourceType)) {
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

  // Build dependency graph of Kustomizations using spec.dependsOn
  const createDependenciesGraph = (root: Kustomization | null, allKnown: Kustomization[]) => {
    if (!root) return;

    const g = new graphlib.Graph({ directed: true });
    g.setGraph({
      rankdir: "TB",
      nodesep: 100,
      ranksep: 80,
      marginx: 20,
      marginy: 20,
      align: "UL",
    });
    g.setDefaultEdgeLabel(() => ({}));

    const visitedUp = new Set<string>();
    const visitedDown = new Set<string>();

    // Neutral colors for all nodes in Dependencies graph; current will be highlighted
    const neutralColors = { fill: "#f3f4f4", stroke: "#dee2e6", strokeWidth: "1" } as const;

    const makeId = (k: Kustomization) => `kustomization-${k.metadata.namespace}-${k.metadata.name}`;
    const makeKey = (k: Kustomization) => `${k.metadata.namespace}/${k.metadata.name}`;

    const ensureNode = (k: Kustomization) => {
      const id = makeId(k);
      if (!g.hasNode(id)) {
        // Highlight only the currently viewed kustomization (not all ancestors/descendants)
        const isCurrent = k.metadata.name === root.metadata.name && k.metadata.namespace === root.metadata.namespace;
        const finalColors = isCurrent 
          ? { ...neutralColors, fill: "#fff3cd" } // soft yellow
          : neutralColors;
        createNodeWithCardRenderer(
          g,
          id,
          k,
          "kustomize.toolkit.fluxcd.io/Kustomization",
          finalColors
        );
      }
      return id;
    };

    const findOrStub = (name: string, namespace: string): Kustomization => {
      const found = allKnown.find(k => k.metadata.name === name && k.metadata.namespace === namespace);
      if (found) return found;
      // Create a minimal stub so it can render
      return {
        apiVersion: root.apiVersion,
        kind: root.kind,
        metadata: { name, namespace },
        spec: {} as any,
      } as Kustomization;
    };

    // Build a reverse index: key => list of dependents
    const dependentsIndex: Record<string, Kustomization[]> = {};
    allKnown.forEach(k => {
      const deps: Array<{ name: string; namespace?: string }> = (k as any).spec?.dependsOn || [];
      deps.forEach(dep => {
        const depNs = dep.namespace || k.metadata.namespace;
        const key = `${depNs}/${dep.name}`;
        if (!dependentsIndex[key]) dependentsIndex[key] = [];
        dependentsIndex[key].push(k);
      });
    });

    const walkUp = (current: Kustomization) => {
      const key = makeKey(current);
      if (visitedUp.has(key)) return;
      visitedUp.add(key);

      const currentId = ensureNode(current);
      const dependsOn: Array<{ name: string; namespace?: string }> = (current as any).spec?.dependsOn || [];
      dependsOn.forEach(dep => {
        const depNs = dep.namespace || current.metadata.namespace;
        const depK = findOrStub(dep.name, depNs);
        const depId = ensureNode(depK);
        g.setEdge(depId, currentId);
        if (allKnown.find(k => k.metadata.name === depK.metadata.name && k.metadata.namespace === depK.metadata.namespace)) {
          walkUp(depK);
        }
      });
    };

    const walkDown = (current: Kustomization) => {
      const key = makeKey(current);
      if (visitedDown.has(key)) return;
      visitedDown.add(key);

      const currentId = ensureNode(current);
      const children = dependentsIndex[key] || [];
      children.forEach(child => {
        const childId = ensureNode(child);
        g.setEdge(currentId, childId);
        walkDown(child);
      });
    };

    ensureNode(root);
    walkUp(root);
    walkDown(root);

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
        
        if (children.length > MAX_CHILDREN_PER_PAGE && isResourceTypeVisible(childResourceType)) {
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
                      {StatusBadges(k())}
                    </div>
                  </div>
                  <div class="header-actions">                    
                    <button class="sync-button" onClick={async () => {
                      if (!k()) return;
                      
                      setDiffLoading(true);
                      setDiffDrawerOpen(true);
                      
                      try {
                        const result = await handleFluxDiff(k(), apiResourceStore.contextInfo?.current);
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
                          disabled={canReconcile() === false}
                          title={canReconcile() === false ? "Not permitted" : undefined}
                          onClick={() => {
                            handleFluxReconcile(k(), apiResourceStore.contextInfo?.current);
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
                            class={`context-menu-item ${canReconcileWithSources() === false ? 'disabled' : ''}`}
                            onClick={() => {
                              if (canReconcileWithSources() === false) return;
                              handleFluxReconcileWithSources(k(), apiResourceStore.contextInfo?.current);
                              setDropdownOpen(false);
                            }}
                            title={canReconcileWithSources() === false ? "Not permitted" : undefined}
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
                        disabled={canPatchKustomization() === false}
                        title={canPatchKustomization() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(k(), false, apiResourceStore.contextInfo?.current) // Resume
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
                        disabled={canPatchKustomization() === false}
                        title={canPatchKustomization() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(k(), true, apiResourceStore.contextInfo?.current) // Suspend
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
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 4;">
                      <span class="label">Events:</span>
                      <ul style="font-family: monospace; font-size: 12px;">
                        {k().events.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
                          <li>
                            <span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: 
                            <span>
                              {(() => {
                                const msg = (event.message || '').replace(/[\r\n]+/g, ' ');
                                const truncated = msg.length > 300;
                                const shown = truncated ? msg.slice(0, 300) + '…' : msg;
                                return (
                                  <>
                                    {shown}
                                    {truncated && (
                                      <button
                                        class="inline-open-events"
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveMainTab('events'); }}
                                        style={{ "margin-left": "6px", "font-size": "12px", "padding": "0", "border": "none", "background": "transparent", "text-decoration": "underline", "cursor": "pointer" }}
                                        title="Open events"
                                      >
                                        open events..
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </span>
                          </li>
                        ))} 
                      </ul>
                    </div>
                    {k().status?.conditions?.find(c => c.type === 'Ready') && (
                      <div class="info-item full-width" style="grid-row: 2 / 4;">
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
                            {renderRevision(
                              k().status?.lastAttemptedRevision,
                              k().spec.sourceRef.kind,
                              k().source?.kind === 'GitRepository' ? (k().source as GitRepository)?.spec?.url : undefined
                            )}
                          </div>
                          <div class="info-item">
                            <span class="label">Last Handled Reconcile:</span>
                            <span class="value">{new Date(k().status?.lastHandledReconcileAt || '').toLocaleString()}</span>
                          </div>
                          <div class="info-item" style={{ "grid-column": "4 / 6" }}>
                            <span class="label">Last Applied Revision:</span>
                            {renderRevision(
                              k().status?.lastAppliedRevision,
                              k().spec.sourceRef.kind,
                              k().source?.kind === 'GitRepository' ? (k().source as GitRepository)?.spec?.url : undefined
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div class="info-item full-width">
                      <details>
                        <summary class="label">Conditions</summary>
                        <pre class="conditions-yaml">
                          {k().status?.conditions ? stringifyYAML(k().status?.conditions) : 'No conditions available'}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>
              {/* Tabs for main graphs */}
              <div style="padding: 0rem 1rem 1rem 1rem">
                <Tabs
                  tabs={[
                    { key: 'resource', label: 'Resource Tree' },
                    { key: 'dependencies', label: 'Dependencies' },
                    { key: 'events', label: (
                      <span>
                        Events{(() => {
                          const t = k();
                          const count = (t?.events || []).length;
                          return count ? ` (${count})` : '';
                        })()}
                      </span>
                    ) }
                  ]}
                  activeKey={activeMainTab()}
                  onChange={(k) => setActiveMainTab(k as 'resource' | 'dependencies' | 'events')}
                  style={{ "margin-top": "12px" }}
                />

                <Show when={activeMainTab() === 'resource'}>
                <div class="resource-tree-wrapper">
                  <ResourceTree
                    g={graph}
                    resourceTypeVisibilityDropdown={<ResourceTypeVisibilityDropdown 
                        resourceTypes={allResourceTypes()}
                        visibleResourceTypes={visibleResourceTypes}
                        toggleResourceTypeVisibility={toggleResourceTypeVisibility}
                        setAllResourceTypesVisibility={setAllResourceTypesVisibility}
                      />}
                  />
                </div>
              </Show>
              <Show when={activeMainTab() === 'events'}>
                <div class="resource-tree-wrapper">
                  <div class="info-grid">
                    <div class="info-item full-width">
                      <EventList events={(kustomization()?.events || []) as Event[]} />
                    </div>
                  </div>
                </div>
              </Show>
                <Show when={activeMainTab() === 'dependencies'}>
                <div class="resource-tree-wrapper">
                  <ResourceTree
                    g={dependenciesGraph}
                    resourceTypeVisibilityDropdown={<div></div>}
                  />
                </div>
              </Show>
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
