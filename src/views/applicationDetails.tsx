// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import type {
  Deployment,
  ArgoCDApplication,
  Pod,
  Service,
  ReplicaSet,
  ArgoCDApplicationWithResources,
  DeploymentWithResources
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { createNode, createNodeWithCardRenderer, ResourceTree } from "../components/ResourceTree.tsx";
import * as graphlib from "graphlib";

export function ApplicationDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();

  // Initialize state for the specific kustomization and its related resources
  const [argoCDApplication, setArgoCDApplication] = createSignal<ArgoCDApplication | null>(null);
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
  const [replicaSets, setReplicaSets] = createSignal<ReplicaSet[]>([]);
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [services, setServices] = createSignal<Service[]>([]);
  const [argoCDApplicationWithResources, setArgoCDApplicationWithResources] = createSignal<ArgoCDApplicationWithResources | null>(null);

  const [graph, setGraph] = createSignal<graphlib.Graph>();

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<
    AbortController[]
  >([]);

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
        path: `/k8s/apis/argoproj.io/v1alpha1/namespaces/${ns}/applications?watch=true`,
        callback: (event: { type: string; object: ArgoCDApplication }) => {
          if (event.type === "ADDED" || event.type === "MODIFIED") {
            if (event.object.metadata.name === name) {
              setArgoCDApplication(event.object);
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
      watchResource(path, callback, controller, setWatchStatus, undefined, apiResourceStore.contextInfo?.current);
      return controller;
    });

    setWatchControllers(controllers);
  };

  // Update inventory when resources change
  createEffect(() => {
    const app = argoCDApplication();
    if (!app) return;

    const resources = app.status?.resources || [];
    const currentDeployments = deployments();
    const currentReplicaSets = replicaSets();
    const currentPods = pods();
    const currentServices = services();

    const matchingDeployments = currentDeployments
      .filter(d => 
        resources.some(entry => 
          entry.kind === 'Deployment' &&
          entry.namespace === d.metadata.namespace &&
          entry.name === d.metadata.name
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
      resources.some(entry => 
        entry.kind === 'Service' &&
        entry.namespace === s.metadata.namespace &&
        entry.name === s.metadata.name
      )
    );

    setArgoCDApplicationWithResources({
      ...app,
      resources: {
        deployments: matchingDeployments,
        services: matchingServices
      }
    });
  });

  createEffect(() => {
    setGraph(createGraph(argoCDApplicationWithResources()));
  });

  const createGraph = (application: ArgoCDApplicationWithResources | null) => {
    if (!application) return;
    
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
    const applicationId = createNode(
      g,
      `application-${application.metadata.name}`,
      `Application: ${application.metadata.name}`,
      {
        fontSize: 14,
        fontWeight: "bold",
        fill:
          application.status?.health?.status === "Healthy"
            ? "#e6f4ea"
            : "#fce8e6",
        stroke:
          application.status?.health?.status === "Healthy"
            ? "#137333"
            : "#c5221f",
        strokeWidth: "2",
        resource: application,
        resourceType: "argoproj.io/Application"
      },
    );

    // Add nodes and edges for deployments
    application.resources.deployments.forEach((deployment) => {
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
      g.setEdge(applicationId, deploymentId);

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
        replicaSet.pods.forEach((pod, index) => {
          // Alternate between card styles based on index
          const rendererName = index % 3 === 0 ? "compact" : 
                              index % 3 === 1 ? "detailed" : "horizontal";
                              
          const podId = createNodeWithCardRenderer(
            g,
            `pod-${pod.metadata.name}`,
            pod,
            "core/Pod",
            {
              fill: "#fff",
              stroke: "#666",
              strokeWidth: "1",
              rendererName
            },
          );
          g.setEdge(rsId, podId);
        });
      });
    });

    // Add nodes for services
    application.resources.services.forEach((service) => {
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
      g.setEdge(applicationId, serviceId);
    });

    return g;
  };

  const handleBackClick = () => {
    // Global filter state is already maintained by the filter store
    navigate("/");
  };

  return (
    <div class="kustomization-details">
      <Show when={argoCDApplication()} fallback={<div class="loading">Loading...</div>}>
        {(app) => {
          const application = app();
          const metadata = application.metadata;
          const spec = application.spec;
          const status = application.status;
          const syncStatus = application.status?.sync?.status || 'Unknown';
          const healthStatus = application.status?.health?.status || 'Unknown';

          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{application.metadata.name}</h1>
                    <span class="watch-status" style={{ "color": watchStatus() === "●" ? "green" : "red" } as any}>
                      {watchStatus()}
                    </span>
                    <div class="status-badges">
                      <span class={`status-badge sync-${syncStatus.toLowerCase()}`}>
                        Sync: {syncStatus}
                      </span> 
                      <span class={`status-badge health-${healthStatus.toLowerCase()}`}>
                        Health: {healthStatus}
                      </span>
                    </div>
                  </div>
                  <div class="header-actions">
                    <button class="sync-button" onClick={() => {}}>Sync</button>
                    <button class="refresh-button" onClick={() => {}}>Refresh</button>
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Namespace:</span>
                      <span class="value">{metadata.namespace}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Source:</span>
                      <span class="value">{spec.source.repoURL}</span>
                    </div>
                    {application.spec.source.targetRevision && (

                    <div class="info-item">
                      <span class="label">Target Revision:</span>
                      <span class="value">{spec.source.targetRevision}</span>
                    </div>
                    )}
                    {application.spec.source.path && (
                    <div class="info-item">
                      <span class="label">Path:</span>
                      <span class="value">{spec.source.path}</span>
                    </div>
                    )}
                    {application.spec.source.chart && (
                    <div class="info-item">
                      <span class="label">Chart:</span>
                      <span class="value">{spec.source.chart}</span>
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
    </div>
  );
}
