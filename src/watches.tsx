import { createSignal } from "solid-js";
import type { Pod, Deployment, Service, ServiceWithResources, Kustomization, Source, Event, ArgoCDApplication } from "./types/k8s.ts";
import { updateServiceMatchingResources } from "./utils/k8s.ts";
import { untrack } from "solid-js";

export const [watchStatus, setWatchStatus] = createSignal("●");
export const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

export const watchResource = async (path: string, callback: (event: any) => void, controller: AbortController) => {
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
            console.log(line);
            console.error('Error parsing watch event:', e);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
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

export const setupDashboardWatches = (
  ns: string | undefined,
  cardType: string,
  pods: () => Pod[],
  setPods: (fn: (prev: Pod[]) => Pod[]) => void,
  deployments: () => Deployment[],
  setDeployments: (fn: (prev: Deployment[]) => Deployment[]) => void,
  setServices: (fn: (prev: ServiceWithResources[]) => ServiceWithResources[]) => void,
  setKustomizations: (fn: (prev: Kustomization[]) => Kustomization[]) => void,
  setSources: (fn: (prev: Source[]) => Source[]) => void,
  setApplications: (fn: (prev: ArgoCDApplication[]) => ArgoCDApplication[]) => void,
  setEvents: (fn: (prev: Event[]) => Event[]) => void
) => {
  if (!ns) return;
  console.log('Setting up watches for namespace:', ns, 'card type:', cardType);

  // Cancel existing watches
  untrack(() => {
    watchControllers().forEach(controller => controller.abort());
  });

  // Clear existing resources
  setPods(() => []);
  setDeployments(() => []);
  setServices(() => []);
  setKustomizations(() => []);
  setSources(() => []);
  setApplications(() => []);
  setEvents(() => []);

  const watches = [];

  // Always watch events regardless of card type
  watches.push({
    path: `/k8s/api/v1/namespaces/${ns}/events?watch=true`,
    callback: (event: { type: string; object: Event }) => {
      if (event.type === 'ADDED') {
        setEvents(prev => [...prev, event.object]);
      } else if (event.type === 'MODIFIED') {
        setEvents(prev => prev.map(e => e.metadata.name === event.object.metadata.name ? event.object : e));
      } else if (event.type === 'DELETED') {
        setEvents(prev => prev.filter(e => e.metadata.name !== event.object.metadata.name));
      }
    }
  });

  // Only set up watches for the selected card type
  if (cardType !== 'fluxcd') {
    // Kubernetes resource watches
    watches.push(
      {
        path: `/k8s/api/v1/namespaces/${ns}/pods?watch=true`,
        callback: (event: { type: string; object: Pod }) => {
          if (event.type === 'ADDED') {
            setPods(prev => [...prev, event.object]);
            setServices(prev => prev.map(service => updateServiceMatchingResources(service, [...pods(), event.object], deployments())));
          } else if (event.type === 'MODIFIED') {
            setPods(prev => prev.map(p => p.metadata.name === event.object.metadata.name ? event.object : p));
            setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
          } else if (event.type === 'DELETED') {
            setPods(prev => prev.filter(p => p.metadata.name !== event.object.metadata.name));
            setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
          }
        }
      },
      {
        path: `/k8s/apis/apps/v1/namespaces/${ns}/deployments?watch=true`,
        callback: (event: { type: string; object: Deployment }) => {
          if (event.type === 'ADDED') {
            setDeployments(prev => [...prev, event.object]);
            setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), [...deployments(), event.object])));
          } else if (event.type === 'MODIFIED') {
            setDeployments(prev => prev.map(d => d.metadata.name === event.object.metadata.name ? event.object : d));
            setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
          } else if (event.type === 'DELETED') {
            setDeployments(prev => prev.filter(d => d.metadata.name !== event.object.metadata.name));
            setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
          }
        }
      },
      {
        path: `/k8s/api/v1/namespaces/${ns}/services?watch=true`,
        callback: (event: { type: string; object: Service }) => {
          if (event.type === 'ADDED') {
            setServices(prev => [...prev, updateServiceMatchingResources(event.object, pods(), deployments())]);
          } else if (event.type === 'MODIFIED') {
            setServices(prev => prev.map(s => 
              s.metadata.name === event.object.metadata.name 
                ? updateServiceMatchingResources(event.object, pods(), deployments())
                : s
            ));
          } else if (event.type === 'DELETED') {
            setServices(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
          }
        }
      }
    );
  }

  if (cardType === 'fluxcd') {
    // FluxCD resource watches
    watches.push(
      {
        path: `/k8s/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/${ns}/kustomizations?watch=true`,
        callback: (event: { type: string; object: Kustomization }) => {
          if (event.type === 'ADDED') {
            setKustomizations(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setKustomizations(prev => prev.map(k => k.metadata.name === event.object.metadata.name ? event.object : k));
          } else if (event.type === 'DELETED') {
            setKustomizations(prev => prev.filter(k => k.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/apis/source.toolkit.fluxcd.io/v1beta2/namespaces/${ns}/ocirepositories?watch=true`,
        callback: (event: { type: string; object: Source }) => {
          if (event.type === 'ADDED') {
            setSources(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setSources(prev => prev.map(s => s.metadata.name === event.object.metadata.name ? event.object : s));
          } else if (event.type === 'DELETED') {
            setSources(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/apis/source.toolkit.fluxcd.io/v1/namespaces/${ns}/helmrepositories?watch=true`,
        callback: (event: { type: string; object: Source }) => {
          if (event.type === 'ADDED') {
            setSources(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setSources(prev => prev.map(s => s.metadata.name === event.object.metadata.name ? event.object : s));
          } else if (event.type === 'DELETED') {
            setSources(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/apis/source.toolkit.fluxcd.io/v1/namespaces/${ns}/helmcharts?watch=true`,
        callback: (event: { type: string; object: Source }) => {
          if (event.type === 'ADDED') {
            setSources(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setSources(prev => prev.map(s => s.metadata.name === event.object.metadata.name ? event.object : s));
          } else if (event.type === 'DELETED') {
            setSources(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
          }
        }
      },
      {
        path: `/k8s/apis/source.toolkit.fluxcd.io/v1/namespaces/${ns}/gitrepositories?watch=true`,
        callback: (event: { type: string; object: Source }) => {
          if (event.type === 'ADDED') {
            setSources(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setSources(prev => prev.map(s => s.metadata.name === event.object.metadata.name ? event.object : s));
          } else if (event.type === 'DELETED') {
            setSources(prev => prev.filter(s => s.metadata.name !== event.object.metadata.name));
          }
        }
      }
    );
  }

  if (cardType === 'argocd') {
    // ArgoCD Application watches
    watches.push(
      {
        path: `/k8s/apis/argoproj.io/v1alpha1/namespaces/${ns}/applications?watch=true`,
        callback: (event: { type: string; object: ArgoCDApplication }) => {
          if (event.type === 'ADDED') {
            setApplications(prev => [...prev, event.object]);
          } else if (event.type === 'MODIFIED') {
            setApplications(prev => prev.map(a => a.metadata.name === event.object.metadata.name ? event.object : a));
          } else if (event.type === 'DELETED') {
            setApplications(prev => prev.filter(a => a.metadata.name !== event.object.metadata.name));
          }
        }
      }
    );
  }

  const controllers = watches.map(({ path, callback }) => {
    const controller = new AbortController();
    watchResource(path, callback, controller);
    return controller;
  });

  setWatchControllers(controllers);
};

export function setupKustomizationWatches(
  namespace: string,
  name: string,
  setKustomization: (k: Kustomization) => void,
  setDeployments: (d: Deployment[]) => void,
  setPods: (p: Pod[]) => void,
  setServices: (s: ServiceWithResources[]) => void
) {
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
    watchResource(path, callback, controller);
    return controller;
  });

  setWatchControllers(controllers);
}
