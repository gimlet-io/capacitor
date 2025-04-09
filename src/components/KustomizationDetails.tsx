// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createEffect, untrack, onCleanup } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { Show, For } from "solid-js";
import type { Kustomization, Deployment, Pod, ServiceWithResources } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";

export function KustomizationDetails() {
  const params = useParams();
  const navigate = useNavigate();

  // Initialize state for the specific kustomization and its related resources
  const [kustomization, setKustomization] = createSignal<Kustomization | null>(null);
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [services, setServices] = createSignal<ServiceWithResources[]>([]);

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Set up watches when component mounts or params change
  createEffect(() => {
    if (params.namespace && params.name) {
      setupWatches(params.namespace, params.name);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  const setupWatches = (namespace: string, name: string) => {
    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  
    const watches = [];
  
    watches.push(
      {
        path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/${namespace}/kustomizations?watch=true`,
        callback: (event: { type: string; object: Kustomization }) => {
          if (event.type === 'ADDED' || event.type === 'MODIFIED') {
            if (event.object.metadata.name === name) {
              setKustomization(event.object);
            }
          }
        }
      },
    );
  
    const controllers = watches.map(({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });
  
    setWatchControllers(controllers);
  }

  return (
    <div class="kustomization-details">
      <header class="kustomization-header">
        <div class="header-actions">
          <button onClick={() => navigate("/")}>Back to Dashboard</button>
        </div>
        
        <Show when={kustomization()} fallback={<div>Loading...</div>}>
          {(k) => {
            const kustomization = k();
            const metadata = kustomization.metadata;
            const spec = kustomization.spec;
            const status = kustomization.status;
            
            return (
              <div class="kustomization-info">
                <h1>{metadata.name}</h1>
                <div class="info-grid">
                  <div class="info-item">
                    <span class="label">Namespace:</span>
                    <span class="value">{metadata.namespace}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">Path:</span>
                    <span class="value">{spec.path}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">Source:</span>
                    <span class="value">{spec.sourceRef.kind}/{spec.sourceRef.name}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">Interval:</span>
                    <span class="value">{spec.interval}</span>
                  </div>
                  {status?.lastAppliedRevision && (
                    <div class="info-item">
                      <span class="label">Revision:</span>
                      <span class="value">{status.lastAppliedRevision}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        </Show>
      </header>

      <main class="kustomization-content">
        <div class="resource-tree">
          <h2>Resource Tree</h2>
          <div class="tree-placeholder">
            Resource tree visualization will be displayed here
          </div>
        </div>

        <div class="resource-details">
          <Show when={kustomization()}>
            {(k) => {
              const kustomization = k();
              const status = kustomization.status;
              
              return (
                <>
                  <Show when={status?.conditions}>
                    <div class="details-section">
                      <h3>Conditions</h3>
                      <div class="conditions">
                        <For each={status?.conditions || []}>
                          {(condition) => (
                            <div class={`condition ${condition.status.toLowerCase()}`}>
                              <p>Type: {condition.type}</p>
                              <p>Status: {condition.status}</p>
                              {condition.reason && <p>Reason: {condition.reason}</p>}
                              {condition.message && <p>Message: {condition.message}</p>}
                              <p>Last Transition: {new Date(condition.lastTransitionTime).toLocaleString()}</p>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show when={status?.inventory?.entries}>
                    <div class="details-section">
                      <h3>Inventory</h3>
                      <div class="inventory">
                        <For each={status?.inventory?.entries || []}>
                          {(entry) => (
                            <div class="inventory-entry">
                              <p>ID: {entry.id}</p>
                              <p>Version: {entry.v}</p>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </>
              );
            }}
          </Show>
        </div>
      </main>
    </div>
  );
}
