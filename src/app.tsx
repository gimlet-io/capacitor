// deno-lint-ignore-file jsx-button-has-type
import { render } from "solid-js/web";
import { createSignal, createResource, createEffect, untrack, createMemo} from "solid-js";
import { PodList, DeploymentList, ServiceList } from "./components/index.ts";
import type { PodList as PodListType, DeploymentList as DeploymentListType, ServiceList as ServiceListType, Pod, Deployment, Service } from "./types/k8s.ts";
import { For } from "solid-js";

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(false);
  const [namespace, setNamespace] = createSignal<string>();
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  const [namespaces] = createResource(async () => {
    const response = await fetch('/k8s/api/v1/namespaces');
    const data = await response.json();
    const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
    return nsList;
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

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed());
  };

  const [pods] = createResource(namespace, async (ns) => {
    const response = await fetch(`/k8s/api/v1/namespaces/${ns}/pods`);
    const data: PodListType = await response.json();
    return data.items;
  });

  const [deployments] = createResource(namespace, async (ns) => {
    const response = await fetch(`/k8s/apis/apps/v1/namespaces/${ns}/deployments`);
    const data: DeploymentListType = await response.json();
    await new Promise(resolve => setTimeout(resolve, 2000));
    return data.items;
  });

  const [services] = createResource(namespace, async (ns) => {
    const response = await fetch(`/k8s/api/v1/namespaces/${ns}/services`);
    const data: ServiceListType = await response.json();
    return data.items;
  });

  const watchResource = async (path: string, callback: (event: any) => void, controller: AbortController) => {
    try {
      const response = await fetch(path, { signal: controller.signal });
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              callback(event);
            } catch (e) {
              console.error('Error parsing watch event:', e);
            }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Watch aborted:', path);
        return;
      }
      console.error('Watch error:', error);
      setWatchStatus("○");
      setTimeout(() => watchResource(path, callback, controller), 5000);
    }
  };

  const setupWatches = (ns: string | undefined) => {
    if (!ns) return;
    console.log('Setting up watches for namespace:', ns);

    // Cancel existing watches
    untrack(() => {
      console.log('Controllers:', watchControllers());
      watchControllers().forEach(controller => controller.abort());
    });

    const watches = [
      {
        path: `/k8s/api/v1/namespaces/${ns}/pods?watch=true`,
        callback: (event: { type: string; object: Pod }) => {
          console.log('Pod event:', event);
          if (event.type === 'ADDED' || event.type === 'MODIFIED' || event.type === 'DELETED') {
            console.log('Pod details:', {
              name: event.object.metadata.name,
              phase: event.object.status.phase,
              containers: event.object.spec.containers.map(c => c.name)
            });
          }
        }
      },
      {
        path: `/k8s/apis/apps/v1/namespaces/${ns}/deployments?watch=true`,
        callback: (event: { type: string; object: Deployment }) => {
          console.log('Deployment event:', event);
          if (event.type === 'ADDED' || event.type === 'MODIFIED' || event.type === 'DELETED') {
            console.log('Deployment details:', {
              name: event.object.metadata.name,
              replicas: event.object.spec.replicas,
              availableReplicas: event.object.status.availableReplicas
            });
          }
        }
      },
      {
        path: `/k8s/api/v1/namespaces/${ns}/services?watch=true`,
        callback: (event: { type: string; object: Service }) => {
          console.log('Service event:', event);
          if (event.type === 'ADDED' || event.type === 'MODIFIED' || event.type === 'DELETED') {
            console.log('Service details:', {
              name: event.object.metadata.name,
              type: event.object.spec.type,
              clusterIP: event.object.spec.clusterIP
            });
          }
        }
      }
    ];

    const controllers = watches.map( ({ path, callback }) => {
      const controller = new AbortController();
      watchResource(path, callback, controller);
      return controller;
    });

    setWatchControllers(controllers);
  };

  // Call setupWatches when namespace changes
  createEffect(() => {
    setupWatches(namespace());
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
        </div>
      </aside>
      <main class="main-content">
        <h1>Kubernetes Resources</h1>
        <div class="controls">
          <span id="watchStatus" class="watch-status">{watchStatus()}</span>
        </div>
        <div class="resources-grid">
          <section class="resource-section">
            <h2>Pods</h2>
            <PodList pods={pods() || []} />
          </section>
          <section class="resource-section">
            <h2>Deployments</h2>
            <DeploymentList deployments={deployments() || []} />
          </section>
          <section class="resource-section">
            <h2>Services</h2>
            <ServiceList services={services() || []} />
          </section>
        </div>
      </main>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
