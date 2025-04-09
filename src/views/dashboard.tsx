// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createResource, createEffect, onMount, untrack } from "solid-js";
import { PodList, DeploymentList, ServiceList, FluxResourceList, EventList, ArgoCDResourceList } from "../components/index.ts";
import type { Pod, Deployment, ServiceWithResources, Kustomization, Source, Event, ArgoCDApplication } from "../types/k8s.ts";
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
  const [namespaceSearch, setNamespaceSearch] = createSignal("");
  const [isNamespaceDropdownOpen, setIsNamespaceDropdownOpen] = createSignal(false);
  const [selectedNamespaceIndex, setSelectedNamespaceIndex] = createSignal(0);

  const [watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

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

  // Filter namespaces based on search
  const filteredNamespaces = () => {
    const query = namespaceSearch().toLowerCase();
    if (!query) return namespaces() || [];
    return (namespaces() || []).filter((ns: string) => 
      ns.toLowerCase().includes(query)
    );
  };

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

  // Handle keyboard shortcuts
  onMount(() => {
    document.addEventListener('keydown', (e) => {
      // Focus namespace selector on 'n'
      if (e.key === 'n' && !isSearchFocused()) {
        e.preventDefault();
        const namespaceInput = document.querySelector('.namespace-input') as HTMLInputElement;
        if (namespaceInput) {
          namespaceInput.focus();
          setIsNamespaceDropdownOpen(true);
          setNamespaceSearch("");
        }
      }
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
        switch (e.key.toLowerCase()) {
          case 'a':
            e.preventDefault();
            setCardType('argocd');
            break;
          case 'f':
            e.preventDefault();
            setCardType('fluxcd');
            break;
          case 'd':
            e.preventDefault();
            setCardType('deployments');
            break;
          case 's':
            e.preventDefault();
            setCardType('services');
            break;
          case 'p':
            e.preventDefault();
            setCardType('pods');
            break;
        }
      }

      // Handle namespace dropdown navigation
      if (isNamespaceDropdownOpen()) {
        const filtered = filteredNamespaces();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedNamespaceIndex((prev) => 
            Math.min(prev + 1, filtered.length - 1)
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedNamespaceIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const selectedNs = filtered[selectedNamespaceIndex()];
          if (selectedNs) {
            setNamespace(selectedNs);
            setNamespaceSearch(selectedNs);
            setIsNamespaceDropdownOpen(false);
          }
        }
      }

      // Handle Escape key to blur inputs
      if (e.key === 'Escape') {
        const namespaceInput = document.querySelector('.namespace-input') as HTMLInputElement;
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        if (namespaceInput) namespaceInput.blur();
        if (searchInput) searchInput.blur();
        setIsNamespaceDropdownOpen(false);
      }
    });
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });
  });

  // Filter resources based on search query
  const filteredPods = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return pods();
    return pods().filter(pod => 
      pod.metadata.name.toLowerCase().includes(query) ||
      (pod.metadata.namespace?.toLowerCase() || '').includes(query)
    );
  };

  const filteredDeployments = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return deployments();
    return deployments().filter(deployment => 
      deployment.metadata.name.toLowerCase().includes(query) ||
      (deployment.metadata.namespace?.toLowerCase() || '').includes(query)
    );
  };

  const filteredServices = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return services();
    return services().filter(service => 
      service.metadata.name.toLowerCase().includes(query) ||
      (service.metadata.namespace?.toLowerCase() || '').includes(query)
    );
  };

  const filteredKustomizations = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return kustomizations();
    return kustomizations().filter(kustomization => 
      kustomization.metadata.name.toLowerCase().includes(query) ||
      kustomization.metadata.namespace.toLowerCase().includes(query)
    );
  };

  const filteredSources = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return sources();
    return sources().filter(source => 
      source.metadata.name.toLowerCase().includes(query) ||
      source.metadata.namespace.toLowerCase().includes(query)
    );
  };

  const filteredApplications = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return applications();
    return applications().filter(app => 
      (namespaces() === 'all-namespaces' || app.metadata.namespace === namespaces()) &&
      (query === '' || 
        app.metadata.name.toLowerCase().includes(query) ||
        app.spec.project.toLowerCase().includes(query) ||
        app.spec.source.repoURL.toLowerCase().includes(query))
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
            <input
              type="text"
              class="namespace-input"
              value={namespaceSearch() || namespace() || ""}
              onInput={(e) => {
                setNamespaceSearch(e.currentTarget.value);
                setIsNamespaceDropdownOpen(true);
                setSelectedNamespaceIndex(0);
              }}
              onFocus={() => {
                setIsNamespaceDropdownOpen(true);
                setNamespaceSearch("");
              }}
              onBlur={() => setTimeout(() => setIsNamespaceDropdownOpen(false), 200)}
            />
            <span class="namespace-hotkey">n</span>
            <Show when={isNamespaceDropdownOpen()}>
              <div class="namespace-dropdown">
                <For each={filteredNamespaces()}>
                  {(ns: string, index) => (
                    <div
                      class="namespace-option"
                      classList={{ 
                        'selected': ns === namespace(),
                        'highlighted': index() === selectedNamespaceIndex()
                      }}
                      onClick={() => {
                        setNamespace(ns);
                        setNamespaceSearch(ns);
                        setIsNamespaceDropdownOpen(false);
                      }}
                    >
                      {ns}
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <select
            class="card-type-select"
            onChange={(e) => setCardType(e.currentTarget.value as 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd')}
          >
            <option value="argocd" selected={cardType() === 'argocd'}>ArgoCD (a)</option>
            <option value="fluxcd" selected={cardType() === 'fluxcd'}>FluxCD (f)</option>
            <option value="services" selected={cardType() === 'services'}>Services (s)</option>
            <option value="deployments" selected={cardType() === 'deployments'}>Deployments (d)</option>
            <option value="pods" selected={cardType() === 'pods'}>Pods (p)</option>
          </select>
        </div>
        <EventList events={events()} />
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