// deno-lint-ignore-file jsx-button-has-type
import { render } from "solid-js/web";
import { createSignal, createResource, createEffect, untrack} from "solid-js";
import { PodList, DeploymentList, ServiceList } from "./components/index.ts";
import type { Pod, Deployment, Service } from "./types/k8s.ts";
import { For } from "solid-js";

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(false);
  const [namespace, setNamespace] = createSignal<string>();
  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Resource state
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
  const [services, setServices] = createSignal<Service[]>([]);

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

  const watchResource = async (path: string, callback: (event: any) => void, controller: AbortController) => {
    try {
      const response = await fetch(path, { signal: controller.signal });
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      setWatchStatus("●");

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
      setTimeout(() => {
        console.log('Restarting watch:', path);
        watchResource(path, callback, controller)
      }, 5000);
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

    // Clear existing resources
    setPods([]);
    setDeployments([]);
    setServices([]);

    const watches = [
      {
        path: `/k8s/api/v1/namespaces/${ns}/pods?watch=true`,
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
        path: `/k8s/apis/apps/v1/namespaces/${ns}/deployments?watch=true`,
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
        path: `/k8s/api/v1/namespaces/${ns}/services?watch=true`,
        callback: (event: { type: string; object: Service }) => {
          if (event.type === 'ADDED') {
            setServices(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setServices(prev => prev.map(s => s.metadata.name === event.object.metadata.name ? event.object : s));
          } else if (event.type === 'DELETED') {
            setServices(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
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

  createEffect(() => {
    console.log('Pods:', pods());
    console.log('Deployments:', deployments());
    console.log('Services:', services());
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
          <span class="watch-status" style={{ color: watchStatus() === "●" ? "green" : "red" }}>
            {watchStatus()}
          </span>
        </div>
        <div class="resources-grid">
          <section class="resource-section full-width">
            <h2>Services</h2>
            <ServiceList 
              services={services() || []} 
              pods={pods() || []}
              deployments={deployments() || []}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
