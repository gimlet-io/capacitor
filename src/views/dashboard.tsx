// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createResource, createEffect, onMount, untrack } from "solid-js";
import { PodList, DeploymentList, ServiceList, FluxResourceList, ArgoCDResourceList, Combobox } from "../components/index.ts";
import type { Pod, Deployment, ServiceWithResources, Kustomization, Source, Event, ArgoCDApplication, Service } from "../types/k8s.ts";
import { For, Show } from "solid-js";
import { updateServiceMatchingResources } from "../utils/k8s.ts";
import { watchResource } from "../watches.tsx";
import { onCleanup } from "solid-js";

export function Dashboard() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(false);
  const [namespace, setNamespace] = createSignal<string>();
  const [cardType, setCardType] = createSignal<'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd'>('fluxcd');
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isSearchFocused, setIsSearchFocused] = createSignal(false);

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
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
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


  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed());
  };

  // Handle keyboard shortcuts
  onMount(() => {
    document.addEventListener('keydown', (e) => {
      // Focus search on '/'
      if (e.key === '/' && !isSearchFocused()) {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }

      // Card type shortcuts
      if (!isSearchFocused()) {
        const cardType = CARD_TYPES.find(type => type.hotkey === e.key.toLowerCase());
        if (cardType) {
          e.preventDefault();
          setCardType(cardType.value);
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

  // Call setupWatches when namespace or card type changes
  createEffect(() => {
    setupWatches(namespace(), cardType());
  });

  const setupWatches = (ns: string | undefined, cardType: 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd') => {
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
      watchResource(path, callback, controller, setWatchStatus);
      return controller;
    });

    setWatchControllers(controllers);
  };

  return (
    <div class="layout">
      <aside class={`sidebar ${isSidebarCollapsed() ? 'collapsed' : ''}`} id="sidebar">
        <button class="sidebar-toggle" onClick={toggleSidebar}>☰</button>
        <div class="filters">
          <div class="namespace-combobox">
            <Combobox
              value={namespace() || ""}
              options={namespaces() || []}
              onSelect={(value: string) => {
                setNamespace(value);
              }}
              hotkey="n"
              placeholder="Select namespace"
            />
          </div>
          <div class="combobox">
            <Combobox
              value={cardType()}
              options={CARD_TYPES.map(type => type.label + " (" + type.hotkey + ")")}
              onSelect={(value: string) => {
                const t = CARD_TYPES.find(type => type.label + " (" + type.hotkey + ")" === value);
                if (t) {
                  setCardType(t.value);
                }
              }}
              placeholder="Select resource type"
            />
          </div>
        </div>
        {/* <EventList events={events()} /> */}
      </aside>
      <main class="main-content">
        <div class="header-container">
          <h1>Kubernetes Resources</h1>
          <span class="watch-status" style={{ "color": watchStatus() === "●" ? "green" : "red" } as any}>
            {watchStatus()}
          </span>
        </div>
        <div class="controls">
          <div class="search-container">
            <input
              type="text"
              class="search-input"
              placeholder="Search resources"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
            />
            <span class="search-hotkey">/</span>
          </div>
        </div>
        <div class="resources-grid">
          <section class="resource-section full-width">
            <Show when={cardType() === 'services'}>
              <ServiceList services={filteredServices()} />
            </Show>
            <Show when={cardType() === 'deployments'}>
              <DeploymentList deployments={filteredDeployments()} pods={filteredPods()} />
            </Show>
            <Show when={cardType() === 'pods'}>
              <PodList pods={filteredPods()} />
            </Show>
            <Show when={cardType() === 'fluxcd'}>
              <div class="flux-resources">
                <FluxResourceList kustomizations={filteredKustomizations()} sources={filteredSources()} />
              </div>
            </Show>
            <Show when={cardType() === 'argocd'}>
              <div class="argocd-resources">
                <ArgoCDResourceList applications={filteredApplications()} />
              </div>
            </Show>
          </section>
        </div>
      </main>
    </div>
  );
}