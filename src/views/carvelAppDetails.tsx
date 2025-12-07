// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { CarvelApp, Event } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { stringify as stringifyYAML } from "@std/yaml";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";
import { createNodeWithCardRenderer, ResourceTree } from "../components/ResourceTree.tsx";
import { ResourceTypeVisibilityDropdown } from "../components/ResourceTypeVisibilityDropdown.tsx";
import * as graphlib from "graphlib";
import { Tabs } from "../components/Tabs.tsx";
import { ConditionType, ConditionStatus } from "../utils/conditions.ts";
import { LogsViewer } from "../components/resourceDetail/LogsViewer.tsx";
import { useAppConfig } from "../store/appConfigStore.tsx";
import { CarvelValuesViewer } from "../components/resourceDetail/CarvelValuesViewer.tsx";

export function CarvelAppDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const filterStore = useFilterStore();

  const [carvelApp, setCarvelApp] = createSignal<CarvelApp | null>(null);
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Resource tree state
  const [graph, setGraph] = createSignal<graphlib.Graph>();
  const [allResourceTypes, setAllResourceTypes] = createSignal<string[]>([]);
  const [visibleResourceTypes, setVisibleResourceTypes] = createSignal<Set<string>>(new Set());
  const [includeAllResources, setIncludeAllResources] = createSignal(false);
  const [includeOnlyCarvel, setIncludeOnlyCarvel] = createSignal(false);
  const [diagramData, setDiagramData] = createSignal<any>(null);
  
  const [activeMainTab, setActiveMainTab] = createSignal<"resource" | "status" | "values" | "logs">("resource");
  const { carvelConfig } = useAppConfig();

  const isResourceTypeVisible = (resourceType: string): boolean => visibleResourceTypes().has(resourceType);
  const toggleResourceTypeVisibility = (resourceType: string): void => {
    setVisibleResourceTypes(prev => {
      const next = new Set(prev);
      if (next.has(resourceType)) next.delete(resourceType); else next.add(resourceType);
      return next;
    });
  };
  const setAllResourceTypesVisibility = (visible: boolean): void => {
    if (visible) setVisibleResourceTypes(new Set<string>(allResourceTypes())); else setVisibleResourceTypes(new Set<string>());
  };

  const DEFAULT_HIDDEN_RESOURCE_TYPES = [
    'apps/ReplicaSet',
    'rbac.authorization.k8s.io/Role',
    'rbac.authorization.k8s.io/RoleBinding',
    'rbac.authorization.k8s.io/ClusterRole',
    'rbac.authorization.k8s.io/ClusterRoleBinding',
    'core/ServiceAccount'
  ];

  createEffect(() => {
    if (params.namespace && params.name && apiResourceStore.apiResources) {
      setupWatches(params.namespace, params.name);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });
  });

  const setupWatches = (ns: string, name: string) => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setCarvelApp(null);

    type CarvelAppEvent = { type: string; object: CarvelApp };
    const controllers: AbortController[] = [];

    // Resolve API path and plural for CarvelApp dynamically
    const carvelAppApi = (apiResourceStore.apiResources || []).find(r => r.group === 'kappctrl.k14s.io' && r.kind === 'App');
    const baseApiPath = carvelAppApi?.apiPath || '/k8s/apis/kappctrl.k14s.io/v1alpha1';
    const pluralName = carvelAppApi?.name || 'apps';

    // Watch CarvelApp itself
    {
      const controller = new AbortController();
      const path = `${baseApiPath}/namespaces/${ns}/${pluralName}?watch=true`;
      const callback = (event: CarvelAppEvent) => {
        if ((event.type === 'ADDED' || event.type === 'MODIFIED') && event.object.metadata.name === name) {
          setCarvelApp(event.object);
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, apiResourceStore.contextInfo?.current);
      controllers.push(controller);
    }

    setWatchControllers(controllers);
  };

  // Fetch diagram data for resource tree
  createEffect(() => {
    const app = carvelApp();
    if (!app) return;
    
    (async () => {
      try {
        const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
        const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
        
        // Build query parameters based on checkbox states
        const queryParams = new URLSearchParams();
        if (includeAllResources()) {
          queryParams.set('allResources', 'true');
        } else if (includeOnlyCarvel()) {
          queryParams.set('onlyCarvel', 'true');
        }
        const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
        const url = `${apiPrefix}/carvelAppDiagram/${params.namespace}/${params.name}${queryString}`;
        
        const response = await fetch(url);
        if (!response.ok) {
          console.error('Failed to fetch diagram data');
          return;
        }
        
        const data = await response.json();
        console.log('[CarvelApp] Diagram API response:', data);
        console.log('[CarvelApp] Has child_objects?', !!data.child_objects, 'Count:', data.child_objects?.length);
        setDiagramData(data);
      } catch (e) {
        console.error('Failed to fetch Carvel App diagram:', e);
      }
    })();
  });

  // Track if we've done initial setup to prevent infinite loops
  let initialSetupDone = false;

  // Rebuild graph when data changes
  createEffect(() => {
    const app = carvelApp();
    const data = diagramData();
    
    console.log('[CarvelApp] Data effect triggered - app:', !!app, 'data:', !!data, 'child_objects:', data?.child_objects?.length);
    
    if (!app || !data) {
      console.log('[CarvelApp] Skipping graph build - missing app or data');
      return;
    }
    
    // Build resource tree graph - always build to show at least the root node
    console.log('[CarvelApp] Building resource tree with', data.child_objects?.length || 0, 'child objects');
    initialSetupDone = false; // Reset flag when new data arrives
    buildResourceTree(app, data);
  });

  // Rebuild graph when visibility changes (after initial setup)
  createEffect(() => {
    const app = carvelApp();
    const data = diagramData();
    const visible = visibleResourceTypes(); // Track visibility changes
    
    // Only rebuild if we have data and initial setup is complete
    if (!app || !data || !initialSetupDone) {
      return;
    }
    
    console.log('[CarvelApp] Visibility changed, rebuilding graph');
    buildResourceTree(app, data);
  });

  const buildResourceTree = (app: CarvelApp, tree: any) => {
    console.log('[CarvelApp] buildResourceTree called with tree:', tree);
    
    const g = new graphlib.Graph({ directed: true });
    g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 80, marginx: 20, marginy: 20, align: 'UL' });
    g.setDefaultEdgeLabel(() => ({}));

    const rootId = createNodeWithCardRenderer(
      g,
      `carvelapp-${app.metadata.namespace}-${app.metadata.name}`,
      app as unknown as Record<string, unknown>,
      'kappctrl.k14s.io/App',
      {
        fill: (app.status?.conditions || []).some(c => c.type === 'ReconcileSucceeded' && c.status === 'True') ? '#e6f4ea' : '#fce8e6',
        stroke: (app.status?.conditions || []).some(c => c.type === 'ReconcileSucceeded' && c.status === 'True') ? '#137333' : '#c5221f',
        strokeWidth: '2'
      }
    );
    console.log('[CarvelApp] Created root node with ID:', rootId);

    // Build resource tree from child_objects
    if (tree.child_objects && Array.isArray(tree.child_objects)) {
      // Collect all resource types from the tree
      const collectResourceTypes = (node: any, types: Set<string>) => {
        const resourceType = `${node.group || 'core'}/${node.kind}`;
        types.add(resourceType);
        if (node.child_objects && Array.isArray(node.child_objects)) {
          node.child_objects.forEach((child: any) => collectResourceTypes(child, types));
        }
      };
      
      const resourceTypes = new Set<string>();
      tree.child_objects.forEach((child: any) => collectResourceTypes(child, resourceTypes));
      
      console.log('[CarvelApp] Collected resource types:', Array.from(resourceTypes));
      
      // Only set resource types and initial visibility if not already set
      if (!initialSetupDone) {
        const sortedTypes = Array.from(resourceTypes).sort();
        const initialVisible = new Set<string>();
        sortedTypes.forEach(t => { 
          if (!DEFAULT_HIDDEN_RESOURCE_TYPES.includes(t)) initialVisible.add(t); 
        });
        
        setAllResourceTypes(sortedTypes);
        setVisibleResourceTypes(initialVisible);
        initialSetupDone = true; // Mark setup as complete
        console.log('[CarvelApp] Set initial visibility:', Array.from(initialVisible));
      } else {
        console.log('[CarvelApp] Using existing visibility:', Array.from(visibleResourceTypes()));
      }

      // Draw child_objects
      tree.child_objects.forEach((child: any) => {
        drawResourceNode(g, child, rootId);
      });
    }

    console.log('[CarvelApp] Graph nodes:', g.nodes().length, 'edges:', g.edges().length);
    setGraph(g);
  };

  const drawResourceNode = (g: graphlib.Graph, resource: any, parentId: string) => {
    const resourceType = `${resource.group || 'core'}/${resource.kind}`;
    const visible = isResourceTypeVisible(resourceType);
    
    console.log('[CarvelApp] Drawing node:', resource.name, 'type:', resourceType, 'visible:', visible);
    console.log('[CarvelApp] Resource structure:', resource);
    
    // Always track the resource for its ID, but only render if visible
    let nodeId = parentId;
    if (visible) {
      // Get the current app for parent information
      const app = carvelApp();
      
      // Transform Carvel API resource structure to match what createNodeWithCardRenderer expects
      const normalizedResource = {
        ...resource,
        metadata: {
          name: resource.name,
          namespace: resource.namespace,
          uid: resource.uid || `${resource.namespace}-${resource.name}`,
        },
        apiVersion: resource.apiVersion || `${resource.group}/${resource.version || 'v1'}`,
        kind: resource.kind,
        status: resource.status || {},
        // Add cluster and parent information for remote resource fetching
        _cluster: resource.cluster,
        _parentApp: app ? {
          kind: 'App',
          name: app.metadata.name,
          namespace: app.metadata.namespace
        } : undefined,
      };
      
      nodeId = createNodeWithCardRenderer(
        g,
        `${resourceType.replace('/', '-')}-${resource.namespace || 'default'}-${resource.name}`,
        normalizedResource as unknown as Record<string, unknown>,
        resourceType,
        { fill: '#e6f4ea', stroke: '#137333', strokeWidth: '1' }
      );
      g.setEdge(parentId, nodeId);
      console.log('[CarvelApp] Created node:', nodeId);
    } else {
      console.log('[CarvelApp] Skipped invisible node:', resource.name);
    }

    // Recursively draw child_objects, using current nodeId as parent if visible, otherwise use original parent
    if (resource.child_objects && Array.isArray(resource.child_objects)) {
      resource.child_objects.forEach((child: any) => {
        drawResourceNode(g, child, nodeId);
      });
    }
  };

  // Carvel operations
  const handlePause = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const response = await fetch(`${apiPrefix}/carvelApp/${app.metadata.namespace}/${app.metadata.name}/pause`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        console.log(data.message);
      } else {
        console.error(data.error);
      }
    } catch (e) {
      console.error('Failed to pause App:', e);
    }
  };

  const handleUnpause = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const response = await fetch(`${apiPrefix}/carvelApp/${app.metadata.namespace}/${app.metadata.name}/unpause`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        console.log(data.message);
      } else {
        console.error(data.error);
      }
    } catch (e) {
      console.error('Failed to unpause App:', e);
    }
  };

  const handleCancel = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const response = await fetch(`${apiPrefix}/carvelApp/${app.metadata.namespace}/${app.metadata.name}/cancel`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        console.log(data.message);
      } else {
        console.error(data.error);
      }
    } catch (e) {
      console.error('Failed to cancel App:', e);
    }
  };

  const handleUncancel = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const response = await fetch(`${apiPrefix}/carvelApp/${app.metadata.namespace}/${app.metadata.name}/uncancel`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        console.log(data.message);
      } else {
        console.error(data.error);
      }
    } catch (e) {
      console.error('Failed to uncancel App:', e);
    }
  };

  const handleTrigger = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const response = await fetch(`${apiPrefix}/carvelApp/${app.metadata.namespace}/${app.metadata.name}/trigger`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        console.log(data.message);
      } else {
        console.error(data.error);
      }
    } catch (e) {
      console.error('Failed to trigger App:', e);
    }
  };

  const handleBackClick = () => {
    navigate("/");
  };

  // Helper functions for spec info
  const getFetchInfo = (app: CarvelApp): string => {
    if (!app.spec?.fetch || !Array.isArray(app.spec.fetch)) return 'N/A';
    
    const parts: string[] = [];
    for (const item of app.spec.fetch) {
      if (item.inline) {
        parts.push('inline');
      } else if (item.image?.url) {
        parts.push(`image: ${item.image.url}`);
      } else if (item.imgpkgBundle?.image) {
        parts.push(`imgpkgBundle: ${item.imgpkgBundle.image}`);
      } else if (item.http?.url) {
        parts.push(`http: ${item.http.url}`);
      } else if (item.git?.url) {
        parts.push(`git: ${item.git.url}`);
      } else if (item.helmChart) {
        const chart = item.helmChart;
        const chartName = chart.name || '';
        const version = chart.version ? `@${chart.version}` : '';
        const repo = chart.repository?.url ? ` (${chart.repository.url})` : '';
        parts.push(`helmChart: ${chartName}${version}${repo}`);
      }
    }
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };

  const getTemplateInfo = (app: CarvelApp): string => {
    if (!app.spec?.template || !Array.isArray(app.spec.template)) return 'N/A';
    
    const parts: string[] = [];
    for (const item of app.spec.template) {
      if (item.ytt) parts.push('ytt');
      if (item.kbld) parts.push('kbld');
      if (item.helmTemplate) parts.push('helmTemplate');
      if (item.cue) parts.push('cue');
      if (item.sops) parts.push('sops');
    }
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };

  const getTargetCluster = (app: CarvelApp): string => {
    return app.spec?.cluster?.kubeconfigSecretRef?.name || 'in-cluster';
  };

  return (
    <div class="kustomization-details">
      <Show when={carvelApp()} fallback={<div class="loading">Loading...</div>}>
        {(app) => {
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{app().metadata.namespace}/{app().metadata.name}</h1>
                    <div class="kustomization-status">
                      {StatusBadges(app() as any)}
                    </div>
                  </div>
                  <div class="header-actions">
                    {app().spec?.paused ? (
                      <button class="sync-button resume" onClick={handleUnpause}>
                        Unpause
                      </button>
                    ) : (
                      <button class="sync-button" onClick={handlePause}>
                        Pause
                      </button>
                    )}
                    {app().spec?.canceled ? (
                      <button class="sync-button resume" onClick={handleUncancel}>
                        Uncancel
                      </button>
                    ) : (
                      <button class="sync-button" onClick={handleCancel}>
                        Cancel
                      </button>
                    )}
                    <button class="sync-button" onClick={handleTrigger}>
                      Trigger
                    </button>
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid" style="grid-template-columns: 1fr 1fr;">
                    {/* Left column: Specification Summary */}
                    <div class="info-item" style="grid-column: 1 / 2;">
                      <h3 style="margin-bottom: 0.5rem;">Specification</h3>
                      <div class="info-grid">
                        <div class="info-item">
                          <span class="label">Paused:</span>
                          <span class="value">
                            <span class={`badge ${app().spec?.paused ? 'badge-paused' : 'badge-ready'}`}>
                              {app().spec?.paused ? 'true' : 'false'}
                            </span>
                          </span>
                        </div>
                        <div class="info-item">
                          <span class="label">Canceled:</span>
                          <span class="value">
                            <span class={`badge ${app().spec?.canceled ? 'badge-canceled' : 'badge-ready'}`}>
                              {app().spec?.canceled ? 'true' : 'false'}
                            </span>
                          </span>
                        </div>
                        <div class="info-item">
                          <span class="label">Service Account:</span>
                          <span class="value">{app().spec?.serviceAccountName || 'default'}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Sync Period:</span>
                          <span class="value">{app().spec?.syncPeriod || '30s'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Fetch:</span>
                          <span class="value">{getFetchInfo(app())}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Template:</span>
                          <span class="value">{getTemplateInfo(app())}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Target:</span>
                          <span class="value">{getTargetCluster(app())}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right column: Status Summary */}
                    <div class="info-item" style="grid-column: 2 / 3;">
                      <h3 style="margin-bottom: 0.5rem;">Status</h3>
                      <div class="info-grid">
                        <div class="info-item full-width">
                          <span class="label">Friendly Description:</span>
                          <span class="value">{app().status?.friendlyDescription || 'N/A'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Useful Error Message:</span>
                          <span class="value">{app().status?.usefulErrorMessage || 'N/A'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Reconciliation Status:</span>
                          <span class="value">
                            {(() => {
                              const conditions = app().status?.conditions || [];
                              const reconciling = conditions.find(c => c.type === 'Reconciling');
                              const failed = conditions.find(c => c.type === 'ReconcileFailed');
                              const succeeded = conditions.find(c => c.type === 'ReconcileSucceeded');
                              
                              const parts: string[] = [];
                              if (reconciling?.status === 'True') {
                                parts.push('Reconciling');
                              }
                              if (failed?.status === 'True') {
                                parts.push('ReconcileFailed');
                              }
                              if (succeeded?.status === 'True') {
                                parts.push('ReconcileSucceeded');
                              }
                              return parts.join(', ') || 'Unknown';
                            })()}
                          </span>
                        </div>
                        <div class="info-item">
                          <span class="label">Observed Generation:</span>
                          <span class="value">{app().status?.observedGeneration || '—'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="value" style="font-style: italic; color: #666;">
                            For details, see Status tab
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </header>
            </>
          );
        }}
      </Show>

      <div style="padding: 0rem 1rem 1rem 1rem">
        <Tabs
          tabs={[
            { key: "resource", label: "Resource Tree" },
            { key: "status", label: "Status" },
            { key: "values", label: "Values" },
            { key: "logs", label: "kapp-controller Logs" },
          ]}
          activeKey={activeMainTab()}
          onChange={(k) => setActiveMainTab(k as "resource" | "status" | "values" | "logs")}
          class=""
          style={{ "margin-top": "12px" }}
        />

        {/* Resource Tree */}
        <Show when={activeMainTab() === "resource"}>
          <div class="resource-tree-wrapper">
            <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-bottom: 1rem;">
              <label style="display: flex; align-items: center; gap: 0.5rem;">
                <input
                  type="checkbox"
                  checked={includeOnlyCarvel()}
                  onChange={(e) => {
                    setIncludeOnlyCarvel(e.currentTarget.checked);
                    // Uncheck "Include all Resources" when this is checked
                    if (e.currentTarget.checked) {
                      setIncludeAllResources(false);
                    }
                  }}
                />
                Include Only Carvel Resources
              </label>
              <label style="display: flex; align-items: center; gap: 0.5rem;">
                <input
                  type="checkbox"
                  checked={includeAllResources()}
                  onChange={(e) => {
                    setIncludeAllResources(e.currentTarget.checked);
                    // Uncheck "Include Only Carvel Resources" when this is checked
                    if (e.currentTarget.checked) {
                      setIncludeOnlyCarvel(false);
                    }
                  }}
                />
                Include all Resources
              </label>
            </div>
            <Show when={!!graph()}>
              <ResourceTree
                g={graph}
                resourceTypeVisibilityDropdown={
                  <ResourceTypeVisibilityDropdown
                    resourceTypes={allResourceTypes()}
                    visibleResourceTypes={visibleResourceTypes}
                    toggleResourceTypeVisibility={toggleResourceTypeVisibility}
                    setAllResourceTypesVisibility={setAllResourceTypesVisibility}
                  />
                }
              />
            </Show>
          </div>
        </Show>

        {/* Status Tab - styled like Values tab */}
        <Show when={activeMainTab() === "status" && !!diagramData()}>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1rem;">
            {/* Fetch Status */}
            <div class="merged-values-section">
              <div class="merged-values-header">
                <h3>Fetch</h3>
              </div>
              <Show when={diagramData()?.status_info?.fetch}>
                <pre class="yaml-content">
                  <code class="hljs language-yaml">
                    {stringifyYAML(diagramData()!.status_info!.fetch)}
                  </code>
                </pre>
              </Show>
              <Show when={!diagramData()?.status_info?.fetch}>
                <p style="color: var(--linear-text-secondary); font-style: italic; padding: 16px 0;">
                  No fetch status available
                </p>
              </Show>
            </div>

            {/* Template Status */}
            <div class="merged-values-section">
              <div class="merged-values-header">
                <h3>Template</h3>
              </div>
              <Show when={diagramData()?.status_info?.template}>
                <pre class="yaml-content">
                  <code class="hljs language-yaml">
                    {stringifyYAML(diagramData()!.status_info!.template)}
                  </code>
                </pre>
              </Show>
              <Show when={!diagramData()?.status_info?.template}>
                <p style="color: var(--linear-text-secondary); font-style: italic; padding: 16px 0;">
                  No template status available
                </p>
              </Show>
            </div>

            {/* Deploy Status */}
            <div class="merged-values-section">
              <div class="merged-values-header">
                <h3>Deploy</h3>
              </div>
              <Show when={diagramData()?.status_info?.deploy}>
                <pre class="yaml-content">
                  <code class="hljs language-yaml">
                    {stringifyYAML(diagramData()!.status_info!.deploy)}
                  </code>
                </pre>
              </Show>
              <Show when={!diagramData()?.status_info?.deploy}>
                <p style="color: var(--linear-text-secondary); font-style: italic; padding: 16px 0;">
                  No deploy status available
                </p>
              </Show>
            </div>

            {/* Inspect Status */}
            <div class="merged-values-section">
              <div class="merged-values-header">
                <h3>Inspect</h3>
              </div>
              <Show when={diagramData()?.status_info?.inspect}>
                <pre class="yaml-content">
                  <code class="hljs language-yaml">
                    {stringifyYAML(diagramData()!.status_info!.inspect)}
                  </code>
                </pre>
              </Show>
              <Show when={!diagramData()?.status_info?.inspect}>
                <p style="color: var(--linear-text-secondary); font-style: italic; padding: 16px 0;">
                  No inspect status available
                </p>
              </Show>
            </div>
          </div>
        </Show>

        {/* Values Tab */}
        <Show when={activeMainTab() === "values" && !!carvelApp()}>
          <CarvelValuesViewer
            namespace={carvelApp()!.metadata.namespace}
            name={carvelApp()!.metadata.name}
            kind="App"
          />
        </Show>

        {/* Logs Tab - kapp-controller */}
        <Show when={activeMainTab() === "logs" && !!carvelConfig()}>
          <LogsViewer
            resource={{
              apiVersion: "apps/v1",
              kind: "Deployment",
              metadata: { 
                name: carvelConfig()!.kappController.deploymentName, 
                namespace: carvelConfig()!.namespace 
              },
              spec: { 
                selector: { 
                  matchLabels: { 
                    [carvelConfig()!.kappController.labelKey]: carvelConfig()!.kappController.labelValue 
                  } 
                } 
              }
            }}
            isOpen={activeMainTab() === "logs"}
            initialSearch={carvelApp()?.metadata.name as string}
            autoDetectJson={false}
            defaultHideNonMatches={true}
            contentMaxHeightPx={250}
          />
        </Show>
      </div>
    </div>
  );
}
