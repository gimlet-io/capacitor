// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createResource, createEffect, onMount, untrack } from "solid-js";
import { PodList, DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList, Combobox } from "../components/index.ts";
import type { Pod, Deployment, ServiceWithResources, Kustomization, Source, Event, ArgoCDApplication, Service, DeploymentWithResources } from "../types/k8s.ts";
import { For, Show } from "solid-js";
import { updateServiceMatchingResources, updateDeploymentMatchingResources } from "../utils/k8s.ts";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";

export function Dashboard() {
  const [namespace, setNamespace] = createSignal<string>();
  const [resourceFilter, setResourceFilter] = createSignal<'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd'>('pods');
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchFocused, setSearchFocused] = createSignal(false);

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  const CARD_TYPES = [
    { value: 'argocd', label: 'ArgoCD', hotkey: 'a' },
    { value: 'fluxcd', label: 'FluxCD', hotkey: 'f' },
    { value: 'services', label: 'Services', hotkey: 's' },
    { value: 'deployments', label: 'Deployments', hotkey: 'd' },
    { value: 'pods', label: 'Pods', hotkey: 'p' }
  ] as const;

  // Resource state
  const [pods, setPods] = createSignal<Pod[]>([]);
  const [deployments, setDeployments] = createSignal<DeploymentWithResources[]>([]);
  const [services, setServices] = createSignal<ServiceWithResources[]>([]);
  const [kustomizations, setKustomizations] = createSignal<Kustomization[]>([]);
  const [sources, setSources] = createSignal<Source[]>([]);
  const [applications, setApplications] = createSignal<ArgoCDApplication[]>([]);
  const [events, setEvents] = createSignal<Event[]>([]);

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

  // Handle keyboard shortcuts
  onMount(() => {
    document.addEventListener('keydown', (e) => {
      // Focus search on '/'
      if (e.key === '/' && !searchFocused()) {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }

      // Resource type shortcuts
      if (!searchFocused()) {
        const cardType = CARD_TYPES.find(type => type.hotkey === e.key.toLowerCase());
        if (cardType) {
          e.preventDefault();
          setResourceFilter(cardType.value);
        }
      }

      // Handle Escape key to blur inputs
      if (e.key === 'Escape') {
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        if (searchInput) searchInput.blur();
      }
    });
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  // Filter resources based on search query
  const filteredPods = () => filterResources(pods(), searchQuery());
  const filteredDeployments = () => filterResources(deployments(), searchQuery());
  const filteredServices = () => filterResources(services(), searchQuery());
  const filteredKustomizations = () => filterResources(kustomizations(), searchQuery());
  const filteredSources = () => filterResources(sources(), searchQuery());
  const filteredApplications = () => filterResources(applications(), searchQuery());

  const filterResources = <T extends { metadata: { name: string; namespace: string } }>(
    resources: T[],
    query: string
  ): T[] => {
    if (!query) return resources;
    const lowerQuery = query.toLowerCase();
    return resources.filter(resource =>
      resource.metadata.name.toLowerCase().includes(lowerQuery) ||
      resource.metadata.namespace.toLowerCase().includes(lowerQuery)
    );
  };

  // Call setupWatches when namespace or resource filter changes
  createEffect(() => {
    setupWatches(namespace(), resourceFilter());
  });

  const setupWatches = (ns: string | undefined, resourceFilter: 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd') => {
    if (!ns) return;
    console.log('Setting up watches for namespace:', ns, 'resource type:', resourceFilter);

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

    if (resourceFilter === 'pods' || resourceFilter === 'services' || resourceFilter === 'deployments') {
      watches.push(
        {
          path: `/k8s/api/v1/namespaces/${ns}/pods?watch=true`,
          callback: (event: { type: string; object: Pod }) => {
            if (event.type === 'ADDED') {
              setPods(prev => [...prev, event.object]);
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, [...pods(), event.object], deployments())));
            } else if (event.type === 'MODIFIED') {
              setPods(prev => prev.map(p => p.metadata.name === event.object.metadata.name ? event.object : p));
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            } else if (event.type === 'DELETED') {
              setPods(prev => prev.filter(p => p.metadata.name !== event.object.metadata.name));
              setDeployments(prev => prev.map(deployment => updateDeploymentMatchingResources(deployment, pods())));
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), deployments())));
            }
          }
        },
        {
          path: `/k8s/apis/apps/v1/namespaces/${ns}/deployments?watch=true`,
          callback: (event: { type: string; object: Deployment }) => {
            if (event.type === 'ADDED') {
              setDeployments(prev => [...prev, updateDeploymentMatchingResources(event.object, pods())]);
              setServices(prev => prev.map(service => updateServiceMatchingResources(service, pods(), [...deployments(), event.object])));
            } else if (event.type === 'MODIFIED') {
              setDeployments(prev => prev.map(d => d.metadata.name === event.object.metadata.name ? updateDeploymentMatchingResources(event.object, pods()) : d));
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

    if (resourceFilter === 'fluxcd') {
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
        }
      );
    }

    if (resourceFilter === 'argocd') {
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
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
  };

  return (
    <div class="layout">
      <main class="main-content">
        <div class="controls">
          <div class="namespace-combobox">
            <Combobox
              value={namespace() || ""}
              options={namespaces()?.map((ns: string) => ({ value: ns, label: ns })) || []}
              onSelect={(value: string) => {
                setNamespace(value);
              }}
              hotkey="n"
              placeholder="Select namespace"
            />
          </div>
          <div class="combobox">
            <Combobox
              value={resourceFilter()}
              options={CARD_TYPES.map(type => ({ value: type.value, label: type.label, hotkey: type.hotkey }))}
              onSelect={(value: string) => {
                setResourceFilter(value as 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd');
              }}
              placeholder="Select resource type"
              disableKeyboardNavigation
            />
          </div>
          <div class="search-container">
            <input
              type="text"
              class="search-input"
              placeholder="Search resources"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
            <span class="search-hotkey">/</span>
          </div>
          <span 
            class="watch-status" 
            style={{ "color": watchStatus() === "●" ? "var(--linear-green)" : "var(--linear-red)" } as any}
          >
            {watchStatus()}
          </span>
        </div>
        <div class="resources-grid">
          <section class="resource-section full-width">
            <Show when={resourceFilter() === 'services'}>
              <ServiceList services={filteredServices()} />
            </Show>
            <Show when={resourceFilter() === 'deployments'}>
              <DeploymentList deployments={filteredDeployments()} />
            </Show>
            <Show when={resourceFilter() === 'pods'}>
              <PodList pods={filteredPods()} />
            </Show>
            <Show when={resourceFilter() === 'fluxcd'}>
              <FluxResourceList kustomizations={filteredKustomizations()} sources={filteredSources()} />
            </Show>
            <Show when={resourceFilter() === 'argocd'}>
              <ArgoCDResourceList applications={filteredApplications()} />
            </Show>
          </section>
        </div>
      </main>
    </div>
  );
}