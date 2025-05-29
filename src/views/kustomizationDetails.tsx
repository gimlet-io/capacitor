// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, createMemo } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import type {
  Deployment,
  Kustomization,
  Pod,
  Service,
  ReplicaSet,
  KustomizationWithInventory,
  DeploymentWithResources
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { getHumanReadableStatus } from "../utils/conditions.ts";
import { createNode, ResourceTree } from "../components/ResourceTree.tsx";
import * as graphlib from "graphlib";
import { useFilterStore } from "../store/filterStore.tsx";
import { handleFluxReconcile, handleFluxSuspend, handleFluxDiff } from "../utils/fluxUtils.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";

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
                    {/* <span class="watch-status" style={{ "color": watchStatus() === "●" ? "green" : "red" } as any}>
                      {watchStatus()}
                    </span> */}
                    {/* <div class="status-badges">
                      <span class={`health-badge ${k().status?.conditions?.find(c => c.type === 'Ready')?.status?.toLowerCase() || 'unknown'}`}>
                        {k().status?.conditions?.find(c => c.type === 'Ready')?.status || 'Unknown'}
                      </span>
                      <span class={`sync-badge ${k().status?.conditions?.find(c => c.type === 'Reconciling') ? 'syncing' : 'idle'}`}>
                        {k().status?.conditions?.find(c => c.type === 'Reconciling') ? 'Syncing' : 'Idle'}
                      </span>
                    </div> */}
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
                    {k().status?.lastAppliedRevision && (
                      <div class="info-item">
                        <span class="label">Revision:</span>
                        <span class="value">{k().status?.lastAppliedRevision}</span>
                      </div>
                    )}
                    {k().status?.conditions?.find(c => c.type === 'Ready')?.message && (
                      <div class="info-item full-width">
                        <span class="label">Message:</span>
                        <span class="value">{k().status?.conditions?.find(c => c.type === 'Ready')?.message}</span>
                      </div>
                    )}
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
