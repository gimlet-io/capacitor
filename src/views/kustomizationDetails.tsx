// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, JSX } from "solid-js";
import type {
  Deployment,
  Kustomization,
  Pod,
  Service,
  ReplicaSet,
  KustomizationWithInventory,
  DeploymentWithResources,
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { getHumanReadableStatus } from "../utils/conditions.ts";
import { createNode, ResourceTree } from "../components/ResourceTree.tsx";
import * as graphlib from "graphlib";
import { useFilterStore } from "../store/filterStore.tsx";
import { handleFluxReconcile, handleFluxSuspend, handleFluxDiff } from "../utils/fluxUtils.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { stringify as stringifyYAML } from "@std/yaml";

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

  // Initialize state for the specific kustomization and its related resources
  const [kustomization, setKustomization] = createSignal<Kustomization | null>(null);
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
  const [replicaSets, setReplicaSets] = createSignal<ReplicaSet[]>([]);
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [services, setServices] = createSignal<Service[]>([]);
  const [kustomizationWithInventory, setKustomizationWithInventory] = createSignal<KustomizationWithInventory | null>(null);
  const [sourceRepository, setSourceRepository] = createSignal<any | null>(null);

  const [graph, setGraph] = createSignal<graphlib.Graph>();

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<
    AbortController[]
  >([]);

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  const [diffData, setDiffData] = createSignal<any>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

  // Set up watches when component mounts or params change
  createEffect(() => {
    if (params.namespace && params.name) {
      setupWatches(params.namespace, params.name);
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

    const watches = [];

    watches.push(
      {
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
            }
          }
        },
      },
      {
        path: `/k8s/api/v1/pods?watch=true`,
        callback: (event: { type: string; object: Pod }) => {
          if (event.type === 'ADDED') {
            setPods(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setPods(prev => prev.map(p => p.metadata.name === event.object.metadata.name ? event.object : p));
          } else if (event.type === 'DELETED') {
            setPods(prev => prev.filter(p => p.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/apis/apps/v1/replicasets?watch=true`,
        callback: (event: { type: string; object: ReplicaSet }) => {
          if (event.type === 'ADDED') {
            setReplicaSets(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setReplicaSets(prev => prev.map(rs => rs.metadata.name === event.object.metadata.name ? event.object : rs));
          } else if (event.type === 'DELETED') {
            setReplicaSets(prev => prev.filter(rs => rs.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/apis/apps/v1/deployments?watch=true`,
        callback: (event: { type: string; object: Deployment }) => {
          if (event.type === 'ADDED') {
            setDeployments(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setDeployments(prev => prev.map(d => d.metadata.name === event.object.metadata.name ? event.object : d));
          } else if (event.type === 'DELETED') {
            setDeployments(prev => prev.filter(d => d.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/api/v1/services?watch=true`,
        callback: (event: { type: string; object: Service }) => {
          if (event.type === 'ADDED') {
            setServices(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setServices(prev => prev.map(d => d.metadata.name === event.object.metadata.name ? event.object : d));
          } else if (event.type === 'DELETED') {
            setServices(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
          }
        }
      }
    );

    const controllers = watches.map(({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
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

  // Update inventory when resources change
  createEffect(() => {
    const k = kustomization();
    if (!k) return;

    const inventory = k.status?.inventory?.entries || [];
    const currentDeployments = deployments();
    const currentReplicaSets = replicaSets();
    const currentPods = pods();
    const currentServices = services();

    const matchingDeployments = currentDeployments
      .filter(d => 
        inventory.some(entry => 
          entry.id === `${d.metadata.namespace}_${d.metadata.name}_apps_Deployment`
        )
      )
      .map(deployment => {
        // Find ReplicaSets owned by this Deployment
        const deploymentReplicaSets = currentReplicaSets
          .filter(rs => 
            rs.metadata.ownerReferences?.some(ref => 
              ref.kind === 'Deployment' && 
              ref.name === deployment.metadata.name &&
              rs.metadata.namespace === deployment.metadata.namespace
            )
          )
          .map(replicaSet => ({
            ...replicaSet,
            // Find Pods owned by this ReplicaSet
            pods: currentPods.filter(pod => 
              pod.metadata.ownerReferences?.some(ref => 
                ref.kind === 'ReplicaSet' && 
                ref.name === replicaSet.metadata.name &&
                pod.metadata.namespace === replicaSet.metadata.namespace
              )
            )
          }));

        return {
          ...deployment,
          replicaSets: deploymentReplicaSets
        } as DeploymentWithResources;
      });

    const matchingServices = currentServices.filter(s => 
      inventory.some(entry => 
        entry.id === `${s.metadata.namespace}_${s.metadata.name}__Service`
      )
    );

    setKustomizationWithInventory({
      ...k,
      inventoryItems: {
        deployments: matchingDeployments,
        services: matchingServices
      }
    });
  });

  createEffect(() => {
    setGraph(createGraph(kustomizationWithInventory()));
  });

  const createGraph = (kustomization: KustomizationWithInventory | null) => {
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
    const kustomizationId = createNode(
      g,
      `kustomization-${kustomization.metadata.name}`,
      `Kustomization: ${kustomization.metadata.name}`,
      {
        fontSize: 14,
        fontWeight: "bold",
        fill:
          kustomization.status?.conditions?.some((c) =>
              c.type === "Ready" && c.status === "True"
            )
            ? "#e6f4ea"
            : "#fce8e6",
        stroke:
          kustomization.status?.conditions?.some((c) =>
            c.type === "Ready" && c.status === "True"
            )
            ? "#137333"
            : "#c5221f",
        strokeWidth: "2",
        resource: kustomization,
        resourceType: "kustomize.toolkit.fluxcd.io/Kustomization"
      },
    );

    // Add nodes and edges for deployments
    kustomization.inventoryItems.deployments.forEach((deployment) => {
      const isReady =
        deployment.status.availableReplicas === deployment.status.replicas;
      const deploymentId = createNode(
        g,
        `deployment-${deployment.metadata.name}`,
        `Deployment: ${deployment.metadata.name}`,
        {
          fill: isReady ? "#e6f4ea" : "#fce8e6",
          stroke: isReady ? "#137333" : "#c5221f",
          strokeWidth: "1",
          resource: deployment,
          resourceType: "apps/Deployment"
        },
      );
      g.setEdge(kustomizationId, deploymentId);

      // Add replica sets
      deployment.replicaSets.forEach((replicaSet) => {
        const rsId = createNode(
          g,
          `replicaset-${replicaSet.metadata.name}`,
          `ReplicaSet: ${replicaSet.metadata.name}`,
          {
            fill: "#e8f0fe",
            stroke: "#1a73e8",
            strokeWidth: "1",
            resource: replicaSet,
            resourceType: "apps/ReplicaSet"
          },
        );
        g.setEdge(deploymentId, rsId);

        // Add pods
        replicaSet.pods.forEach((pod) => {
          const podId = createNode(
            g,
            `pod-${pod.metadata.name}`,
            `Pod: ${pod.metadata.name}`,
            {
              fill: "#fff",
              stroke: "#666",
              strokeWidth: "1",
              resource: pod,
              resourceType: "core/Pod"
            },
          );
          g.setEdge(rsId, podId);
        });
      });
    });

    // Add nodes for services
    kustomization.inventoryItems.services.forEach((service) => {
      const serviceId = createNode(
        g,
        `service-${service.metadata.name}`,
        `Service: ${service.metadata.name}`,
        {
          fill: "#e6f4ea",
          stroke: "#137333",
          strokeWidth: "1",
          resource: service,
          resourceType: "core/Service"
        },
      );
      g.setEdge(kustomizationId, serviceId);
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
