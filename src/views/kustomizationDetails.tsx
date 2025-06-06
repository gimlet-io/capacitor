// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, JSX } from "solid-js";
import type {
  Kustomization,
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { getHumanReadableStatus } from "../utils/conditions.ts";
import { createNodeWithCardRenderer, ResourceTree } from "../components/ResourceTree.tsx";
import * as graphlib from "graphlib";
import { useFilterStore } from "../store/filterStore.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { handleFluxReconcile, handleFluxSuspend, handleFluxDiff } from "../utils/fluxUtils.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { stringify as stringifyYAML } from "@std/yaml";

// Utility function to parse inventory entry ID and extract resource info
interface InventoryResourceInfo {
  namespace: string;
  name: string;
  resourceType: string; // e.g., "apps/Deployment", "core/Service"
}

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
    console.log("Parsed inventory entry:", parsed);
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

  const [graph, setGraph] = createSignal<graphlib.Graph>();

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<
    AbortController[]
  >([]);

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  const [diffData, setDiffData] = createSignal<any>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

  // Monitor filterStore.k8sResources for changes
  createEffect(() => {
    if (filterStore.k8sResources.length > 0) {
      console.log("k8sResources are now loaded, length:", filterStore.k8sResources.length);
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
    
    console.log("Checking if we can set up dynamic watches:", 
      "kustomization loaded:", !!k, 
      "inventory entries:", k?.status?.inventory?.entries?.length,
      "k8sResources loaded:", resourcesLoaded);
    
    if (k?.status?.inventory?.entries && resourcesLoaded && params.namespace) {
      console.log("Setting up dynamic watches from reactive effect");
      setupDynamicWatches(k.status.inventory.entries, params.namespace);
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
              console.log("Setting up dynamic watches from kustomization watch callback");
              setupDynamicWatches(event.object.status.inventory.entries, ns);
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
  };

  const extraWatches: Record<string, ExtraWatchConfig[]> = {
    'apps/Deployment': [
      {
        resourceType: 'core/Pod',
      }
    ]
  };

  // Set up dynamic watches based on inventory entries
  const setupDynamicWatches = (inventory: Array<{ id: string; v: string }>, _kustomizationNs: string) => {
    const resourceTypes = getUniqueResourceTypesFromInventory(inventory);

    resourceTypes.forEach(resourceType => {
      const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType.resourceType);
      if (!k8sResource) {
        console.warn(`Unknown resource type in inventory: ${resourceType}. Available resource types:`, filterStore.k8sResources.map(r => r.id));
        return;
      }

      let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
      if (k8sResource.namespaced) {
        watchPath = `${k8sResource.apiPath}/namespaces/${resourceType.namespace}/${k8sResource.name}?watch=true`;
      }
      
      const controller = new AbortController();
      
      watchResource(
        watchPath,
        (event: { type: string; object: any }) => {
          if (event.type === 'ADDED') {
            setDynamicResources(prev => {
              const current = prev[resourceType.resourceType] || [];
              return {
                ...prev,
                [resourceType.resourceType]: [...current, event.object].sort((a, b) => 
                  a.metadata.name.localeCompare(b.metadata.name)
                )
              };
            });
          } else if (event.type === 'MODIFIED') {
            setDynamicResources(prev => {
              const current = prev[resourceType.resourceType] || [];
              return {
                ...prev,
                [resourceType.resourceType]: current.map((res: any) => 
                  res.metadata.name === event.object.metadata.name && 
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
                [resourceType.resourceType]: current.filter((res: any) => 
                  !(res.metadata.name === event.object.metadata.name && 
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
    });
  };

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

  // Filter resources that are actually in the inventory
  const getInventoryResources = () => {
    const k = kustomization();
    if (!k?.status?.inventory?.entries) return {};
    
    const inventory = k.status.inventory.entries;
    const inventoryResourcesByType: Record<string, any[]> = {};
    
    // Group inventory entries by resource type
    const inventoryByType: Record<string, Array<{ id: string; parsed: InventoryResourceInfo }>> = {};
    inventory.forEach(entry => {
      const parsed = parseInventoryEntryId(entry.id);
      if (parsed) {
        if (!inventoryByType[parsed.resourceType]) {
          inventoryByType[parsed.resourceType] = [];
        }
        inventoryByType[parsed.resourceType].push({ id: entry.id, parsed });
      }
    });
    
    // For each resource type, filter the dynamic resources to only include those in inventory
    Object.entries(inventoryByType).forEach(([resourceType, inventoryEntries]) => {
      const allResources = dynamicResources()[resourceType] || [];
      const inventoryResources = allResources.filter(resource => 
        inventoryEntries.some(entry => 
          entry.parsed.namespace === resource.metadata.namespace &&
          entry.parsed.name === resource.metadata.name
        )
      );
      
      if (inventoryResources.length > 0) {
        inventoryResourcesByType[resourceType] = inventoryResources;
      }
    });
    
    return inventoryResourcesByType;
  };

  createEffect(() => {
    setGraph(createGraph(kustomization(), getInventoryResources()));
  });

  const createGraph = (kustomization: Kustomization | null, inventoryResources: Record<string, any[]>) => {
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

    // Add nodes for each resource type in the inventory
    Object.entries(inventoryResources).forEach(([resourceType, resources]) => {
      resources.forEach((resource, index) => {
        const resourceId = createNodeWithCardRenderer(
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
        
        // Connect all resources to the kustomization
        g.setEdge(kustomizationId, resourceId);
      });
    });

    // Handle special relationships for deployments, replicasets, and pods
    const deployments = inventoryResources['apps/Deployment'] || [];
    const replicaSets = inventoryResources['apps/ReplicaSet'] || [];
    const pods = inventoryResources['core/Pod'] || [];
    
    deployments.forEach(deployment => {
      const deploymentId = `apps-Deployment-${deployment.metadata.name}`;
      
      // Find ReplicaSets owned by this Deployment
      const deploymentReplicaSets = replicaSets.filter(rs => 
        rs.metadata.ownerReferences?.some((ref: any) => 
          ref.kind === 'Deployment' && 
          ref.name === deployment.metadata.name &&
          rs.metadata.namespace === deployment.metadata.namespace
        )
      );
      
      deploymentReplicaSets.forEach(replicaSet => {
        const rsId = `apps-ReplicaSet-${replicaSet.metadata.name}`;
        
        // If both nodes exist in the graph, connect them
        if (g.hasNode(deploymentId) && g.hasNode(rsId)) {
          g.setEdge(deploymentId, rsId);
        }
        
        // Find Pods owned by this ReplicaSet
        const replicaSetPods = pods.filter(pod => 
          pod.metadata.ownerReferences?.some((ref: any) => 
            ref.kind === 'ReplicaSet' && 
            ref.name === replicaSet.metadata.name &&
            pod.metadata.namespace === replicaSet.metadata.namespace
          )
        );
        
        replicaSetPods.forEach(pod => {
          const podId = `core-Pod-${pod.metadata.name}`;
          
          // If both nodes exist in the graph, connect them
          if (g.hasNode(rsId) && g.hasNode(podId)) {
            g.setEdge(rsId, podId);
          }
        });
      });
    });

    return g;
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
                    <button class="sync-button" onClick={() => handleFluxReconcile(k())}>Reconcile</button>
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

              <div class="resource-tree-container">
                <ResourceTree g={graph} />
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
