// deno-lint-ignore-file jsx-button-has-type
import { render } from "solid-js/web";
import { createSignal, createResource, createEffect } from "solid-js";
import { PodList, DeploymentList, ServiceList, FluxResourceList } from "./components/index.ts";
import type { Pod, Deployment, ServiceWithResources, Kustomization, Source } from "./types/k8s.ts";
import { For, Show } from "solid-js";
import { watchStatus, setupWatches } from "./watches.tsx";

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(false);
  const [namespace, setNamespace] = createSignal<string>();
  const [cardType, setCardType] = createSignal<'services' | 'deployments' | 'pods' | 'fluxcd'>('services');

  // Resource state
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
  const [services, setServices] = createSignal<ServiceWithResources[]>([]);
  const [kustomizations, setKustomizations] = createSignal<Kustomization[]>([]);
  const [sources, setSources] = createSignal<Source[]>([]);

  const [namespaces] = createResource(async () => {
    const response = await fetch('/k8s/api/v1/namespaces');
    const data = await response.json();
    const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
    return nsList;
  });

  // Set the default namespace or the first namespace if no namespace is selected
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

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed());
  };

  // Call setupWatches when namespace changes
  createEffect(() => {
    setupWatches(
      namespace(),
      pods,
      setPods,
      deployments,
      setDeployments,
      setServices,
      setKustomizations,
      setSources
    );
  });

  return (
    <div class="layout">
      <aside class={`sidebar ${isSidebarCollapsed() ? 'collapsed' : ''}`} id="sidebar">
        <button class="sidebar-toggle" onClick={toggleSidebar}>☰</button>
        <div class="filters">
          <select
            class="namespace-select"
            onChange={(e) => setNamespace(e.currentTarget.value)}
          >
            <For each={namespaces() || []}>
              {(ns) => (
                <option 
                  value={ns} 
                  selected={ns === "flux-system"}
                >
                  {ns}
                </option>
              )}
            </For>
          </select>
          <select
            class="card-type-select"
            onChange={(e) => setCardType(e.currentTarget.value as 'services' | 'deployments' | 'pods' | 'fluxcd')}
          >
            <option value="services" selected={cardType() === 'services'}>Service Cards</option>
            <option value="deployments" selected={cardType() === 'deployments'}>Deployment Cards</option>
            <option value="pods" selected={cardType() === 'pods'}>Pod Cards</option>
            <option value="fluxcd" selected={cardType() === 'fluxcd'}>FluxCD</option>
          </select>
        </div>
      </aside>
      <main class="main-content">
        <h1>Kubernetes Resources</h1>
        <div class="controls">
          <span class="watch-status" style={{ "color": watchStatus() === "●" ? "green" : "red" }}>
            {watchStatus()}
          </span>
        </div>
        <div class="resources-grid">
          <section class="resource-section full-width">
            <Show when={cardType() === 'services'}>
              <ServiceList services={services()} />
            </Show>
            <Show when={cardType() === 'deployments'}>
              <DeploymentList deployments={deployments()} pods={pods()} />
            </Show>
            <Show when={cardType() === 'pods'}>
              <PodList pods={pods()} />
            </Show>
            <Show when={cardType() === 'fluxcd'}>
              <div class="flux-resources">
                <FluxResourceList kustomizations={kustomizations()} sources={sources()} />
              </div>
            </Show>
          </section>
        </div>
      </main>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
