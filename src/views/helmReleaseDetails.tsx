// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import type { HelmRelease, Event, Kustomization, ExtendedKustomization } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { handleFluxReconcile, handleFluxReconcileWithSources, handleFluxSuspend, handleFluxDiff } from "../utils/fluxUtils.tsx";
import { checkPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { stringify as stringifyYAML, parse as parseYAML } from "@std/yaml";
import { HelmValues } from "../components/resourceDetail/HelmValues.tsx";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";
import { createNodeWithCardRenderer, createNode, ResourceTree, createPaginationNode } from "../components/ResourceTree.tsx";
import { ResourceTypeVisibilityDropdown } from "../components/ResourceTypeVisibilityDropdown.tsx";
import * as graphlib from "graphlib";
import { Tabs } from "../components/Tabs.tsx";
import { HelmManifest } from "../components/resourceDetail/HelmManifest.tsx";
import { HelmHistory } from "../components/resourceDetail/HelmHistory.tsx";

export function HelmReleaseDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const filterStore = useFilterStore();

  const [helmRelease, setHelmRelease] = createSignal<HelmRelease & { events?: Event[] } | null>(null);
  const [canReconcile, setCanReconcile] = createSignal<boolean | undefined>(undefined);
  const [canReconcileWithSources, setCanReconcileWithSources] = createSignal<boolean | undefined>(undefined);
  const [canPatch, setCanPatch] = createSignal<boolean | undefined>(undefined);

  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  type FluxDiffResult = { fileName: string; clusterYaml: string; appliedYaml: string; created: boolean; hasChanges: boolean; deleted: boolean };
  const [diffData, setDiffData] = createSignal<FluxDiffResult[] | null>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

  // Resource tree state
  const [graph, setGraph] = createSignal<graphlib.Graph>();
  const [allResourceTypes, setAllResourceTypes] = createSignal<string[]>([]);
  const [visibleResourceTypes, setVisibleResourceTypes] = createSignal<Set<string>>(new Set());
  const [paginationState, setPaginationState] = createSignal<Record<string, number>>({});
  const [dynamicResources, setDynamicResources] = createSignal<Record<string, Array<{ metadata: { name: string; namespace?: string } }>>>({});
  const [manifestResources, setManifestResources] = createSignal<MinimalRes[]>([]);
  const [activeMainTab, setActiveMainTab] = createSignal<"resource" | "values" | "manifest" | "history">("history");

  const isResourceTypeVisible = (resourceType: string): boolean => visibleResourceTypes().has(resourceType);
  const toggleResourceTypeVisibility = (resourceType: string): void => {
    setVisibleResourceTypes(prev => {
      const next = new Set(prev);
      if (next.has(resourceType)) next.delete(resourceType); else next.add(resourceType);
      return next;
    });
  };
  const setAllResourceTypesVisibility = (isVisible: boolean): void => {
    if (isVisible) setVisibleResourceTypes(new Set<string>(allResourceTypes())); else setVisibleResourceTypes(new Set<string>());
  };

  // Values tab content handled by HelmValues component

  const DEFAULT_HIDDEN_RESOURCE_TYPES = [
    'apps/ReplicaSet',
    'rbac.authorization.k8s.io/Role',
    'rbac.authorization.k8s.io/RoleBinding',
    'rbac.authorization.k8s.io/ClusterRole',
    'rbac.authorization.k8s.io/ClusterRoleBinding',
    'core/ServiceAccount'
  ];

  // Extra watches to build parent->children relationships (similar to Kustomization)
  const extraWatches: Record<string, Array<{
    resourceType: string;
    isParent: (child: Record<string, any>, parent: Record<string, any>) => boolean;
  }>> = {
    'apps/Deployment': [
      {
        resourceType: 'apps/ReplicaSet',
        isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'Deployment' && o.name === parent.metadata.name)
      }
    ],
    'apps/ReplicaSet': [
      {
        resourceType: 'core/Pod',
        isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'ReplicaSet' && o.name === parent.metadata.name)
      }
    ],
    'core/PersistentVolumeClaim': [
      {
        resourceType: 'core/PersistentVolume',
        isParent: (child, parent) => child.spec?.claimRef?.name === parent.metadata.name
      }
    ],
    'batch/CronJob': [
      {
        resourceType: 'batch/Job',
        isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'CronJob' && o.name === parent.metadata.name)
      }
    ],
    'bitnami.com/SealedSecret': [
      {
        resourceType: 'core/Secret',
        isParent: (child, parent) => child.metadata.name === parent.metadata.name && child.metadata.namespace === parent.metadata.namespace
      }
    ],
    'keda.sh/ScaledJob': [
      {
        resourceType: 'batch/Job',
        isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'ScaledJob' && o.name === parent.metadata.name)
      }
    ],
    'keda.sh/ScaledObject': [
      {
        resourceType: 'apps/Deployment',
        isParent: (child, parent) => parent.spec?.scaleTargetRef?.name === child.metadata.name && parent.spec?.scaleTargetRef?.kind === 'Deployment'
      }
    ]
  };

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

  // Compute permissions
  createEffect(() => {
    const hr = helmRelease();
    if (!hr) {
      setCanReconcile(undefined);
      setCanReconcileWithSources(undefined);
      setCanPatch(undefined);
      return;
    }

    const mainRes: MinimalK8sResource = { apiVersion: hr.apiVersion, kind: hr.kind, metadata: { name: hr.metadata.name, namespace: hr.metadata.namespace } };
    (async () => {
      const canPatchMain = await checkPermissionSSAR(mainRes, { verb: 'patch' }, apiResourceStore.apiResources);
      setCanReconcile(canPatchMain);
      setCanPatch(canPatchMain);

      // Check source permission when available (HelmRepository or GitRepository)
      type SourceRefLike = { apiVersion?: string; kind: string; name: string; namespace?: string };
      const src = hr.spec?.chart?.spec?.sourceRef as SourceRefLike | undefined;
      if (src?.kind && src?.name) {
        const srcRes: MinimalK8sResource = {
          apiVersion: src.apiVersion || '',
          kind: src.kind,
          metadata: { name: src.name, namespace: src.namespace || hr.metadata.namespace }
        };
        const canPatchSrc = await checkPermissionSSAR(srcRes, { verb: 'patch' }, apiResourceStore.apiResources);
        setCanReconcileWithSources(canPatchMain && canPatchSrc);
      } else {
        setCanReconcileWithSources(canPatchMain);
      }
    })();
  });

  const setupWatches = (ns: string, name: string) => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setHelmRelease(null);

    type HelmReleaseEvent = { type: string; object: HelmRelease };
    type EventWatch = { type: string; object: Event };
    const controllers: AbortController[] = [];

    // Resolve API path and plural for HelmRelease dynamically
    const helmReleaseApi = (apiResourceStore.apiResources || []).find(r => r.group === 'helm.toolkit.fluxcd.io' && r.kind === 'HelmRelease');
    const baseApiPath = helmReleaseApi?.apiPath || '/k8s/apis/helm.toolkit.fluxcd.io/v2beta1';
    const pluralName = helmReleaseApi?.name || 'helmreleases';

    // Watch HelmRelease itself (Flux CRD)
    {
      const controller = new AbortController();
      const path = `${baseApiPath}/namespaces/${ns}/${pluralName}?watch=true`;
      const callback = (event: HelmReleaseEvent) => {
        if ((event.type === 'ADDED' || event.type === 'MODIFIED') && event.object.metadata.name === name) {
          setHelmRelease((prev) => {
            const currentEvents = prev?.events || [];
            const merged: HelmRelease & { events?: Event[] } = { ...event.object, events: currentEvents };
            return merged;
          });
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus);
      controllers.push(controller);
    }

    // Watch Events in namespace and keep last few relevant to this HelmRelease
    {
      const controller = new AbortController();
      const path = `/k8s/api/v1/namespaces/${ns}/events?watch=true`;
      const callback = (event: EventWatch) => {
        const obj = event.object;
        setHelmRelease((prev) => {
          if (!prev) return prev;
          const relevant = obj.involvedObject.kind === 'HelmRelease' && obj.involvedObject.name === name && obj.involvedObject.namespace === ns;
          if (!relevant) return prev;
          const list = (prev.events || []).filter((e) => e.metadata.name !== obj.metadata.name);
          const merged: HelmRelease & { events?: Event[] } = { ...prev, events: [obj, ...list].slice(0, 50) };
          return merged;
        });
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus);
      controllers.push(controller);
    }

    setWatchControllers(controllers);
  };

  // Build resource tree from Helm manifest of latest revision, then watch live objects
  createEffect(() => {
    const hr = helmRelease();
    // Require k8s resource catalog to be loaded for watches
    if (!hr || !filterStore.k8sResources || filterStore.k8sResources.length === 0) return;
    (async () => {
      try {
        const ns = hr.metadata.namespace;
        const name = hr.metadata.name;
        // Fetch history to get latest revision
        const histResp = await fetch(`/api/helm/history/${ns}/${name}`);
        if (!histResp.ok) throw new Error('Failed to fetch Helm history');
        const histData = await histResp.json();
        const releases: Array<{ revision: number }> = Array.isArray(histData.releases) ? histData.releases : [];
        if (releases.length === 0) return;
        const latest = releases.sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
        const revision = latest.revision;
        // Fetch manifest for latest revision
        const manResp = await fetch(`/api/helm/manifest/${ns}/${name}?revision=${revision}`);
        if (!manResp.ok) throw new Error('Failed to fetch Helm manifest');
        const manData = await manResp.json();
        const manifest: string = manData.manifest || '';
        const resources = parseManifestResources(manifest, ns);
        setManifestResources(resources);
        // Base resource types from manifest
        const manifestTypes = Array.from(new Set(resources.map(r => r.resourceType)));
        // Collect extra watch types (e.g., ReplicaSet, Pod) so we can render runtime children
        const extraWatchTypes = new Set<string>();
        Object.values(extraWatches).forEach(configs => configs.forEach(cfg => extraWatchTypes.add(cfg.resourceType)));
        // Union
        const allTypesSet = new Set<string>(manifestTypes);
        extraWatchTypes.forEach(t => allTypesSet.add(t));
        const allTypes = Array.from(allTypesSet).sort((a, b) => (a.split('/')[1] || '').localeCompare(b.split('/')[1] || ''));
        setAllResourceTypes(allTypes);
        const initialVisible = new Set<string>();
        allTypes.forEach(t => { if (!DEFAULT_HIDDEN_RESOURCE_TYPES.includes(t)) initialVisible.add(t); });
        setVisibleResourceTypes(initialVisible);
        // Start live watches for each type+namespace present in manifest
        const seenKeys = new Set<string>();
        resources.forEach(res => {
          const key = `${res.resourceType}::${res.metadata.namespace || ''}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          watchType(res.resourceType, res.metadata.namespace || ns);
        });
        // Also watch extra types that may not be included in manifest (e.g., Pods, ReplicaSets)
        // Ensure we watch them in namespaces actually referenced by parents
        const nsSet = new Set<string>(resources.map(r => r.metadata.namespace || ns));
        extraWatchTypes.forEach(type => {
          for (const n of nsSet) {
            const key = `${type}::${n}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              watchType(type, n);
            }
          }
        });
        // Build initial graph using live data filtered by manifest contents
        setGraph(createHelmGraph(hr, resources));
      } catch (e) {
        console.error('Failed to build Helm resource tree:', e);
      }
    })();
  });

  // Rebuild graph when dynamic resources update
  createEffect(() => {
    // create dependency on dynamicResources
    const _ = Object.keys(dynamicResources()).length;
    const hr = helmRelease();
    if (hr && manifestResources().length > 0) {
      setGraph(createHelmGraph(hr, manifestResources()));
    }
  });

  type MinimalRes = { apiVersion: string; kind: string; metadata: { name: string; namespace?: string }; resourceType: string };
  const parseManifestResources = (yamlContent: string, fallbackNs: string): MinimalRes[] => {
    if (!yamlContent || yamlContent.trim() === '') return [];
    const docs = yamlContent.split(/^---$/m).map(d => d.trim()).filter(Boolean);
    const out: MinimalRes[] = [];
    for (const doc of docs) {
      try {
        const parsed = parseYAML(doc) as unknown;
        if (!parsed || typeof parsed !== 'object') continue;
        const obj = parsed as { apiVersion?: string; kind?: string; metadata?: { name?: string; namespace?: string } };
        const apiVersion = String(obj.apiVersion || 'v1');
        const kind = String(obj.kind || '');
        const metadata = obj.metadata || {};
        const name = String(metadata.name || '');
        const ns = metadata.namespace || fallbackNs;
        if (!kind || !name) continue;
        const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : 'core';
        const resourceType = `${group}/${kind}`;
        out.push({ apiVersion, kind, metadata: { name, namespace: ns }, resourceType });
      } catch (_) {
        // ignore invalid docs
      }
    }
    return out;
  };

  const createHelmGraph = (hr: HelmRelease, resList: MinimalRes[]) => {
    const g = new graphlib.Graph({ directed: true });
    g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 80, marginx: 20, marginy: 20, align: 'UL' });
    g.setDefaultEdgeLabel(() => ({}));

    const rootId = createNodeWithCardRenderer(
      g,
      `helmrelease-${hr.metadata.namespace}-${hr.metadata.name}`,
      hr as unknown as Record<string, unknown>,
      'helm.toolkit.fluxcd.io/HelmRelease',
      {
        fill: (hr.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True') ? '#e6f4ea' : '#fce8e6',
        stroke: (hr.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True') ? '#137333' : '#c5221f',
        strokeWidth: '2'
      }
    );

    // Build an inclusion index by type and namespace from manifest
    const includeIndex: Record<string, Record<string, Set<string>>> = {};
    for (const r of resList) {
      const ns = r.metadata.namespace || '';
      if (!includeIndex[r.resourceType]) includeIndex[r.resourceType] = {};
      if (!includeIndex[r.resourceType][ns]) includeIndex[r.resourceType][ns] = new Set<string>();
      includeIndex[r.resourceType][ns].add(r.metadata.name);
    }

    // Use live resources from dynamicResources and filter to ones included in manifest
    const live = dynamicResources();
    Object.entries(includeIndex).forEach(([type, byNs]) => {
      const allOfType = (live[type] || []) as Array<Record<string, any>>;
      const items = allOfType.filter(obj => {
        const ns = obj.metadata?.namespace || '';
        const set = byNs[ns];
        return !!set && set.has(obj.metadata?.name);
      });
      if (items.length > 5 && isResourceTypeVisible(type)) {
        const paginationKey = `${rootId}-${type}`;
        const currentPage = paginationState()[paginationKey] || 0;
        const pageSize = 5;
        const totalPages = Math.ceil(items.length / pageSize);
        const startIndex = currentPage * pageSize;
        const endIndex = Math.min(startIndex + pageSize, items.length);
        const visibleChildren = items.slice(startIndex, endIndex);
        const paginationResourceId = createNode(g, `pagination-${paginationKey}`, '', {
          fill: '#f8f9fa',
          stroke: '#dee2e6',
          strokeWidth: '1',
          jsxContent: createPaginationNode(type, startIndex, endIndex, totalPages, currentPage, setPaginationState, paginationKey, items.length),
          width: 250,
          height: 70
        });
        g.setEdge(rootId, paginationResourceId);
        // Attach children recursively based on extraWatches
        const enriched = visibleChildren.map(item => enrichWithChildren(type, item, live));
        enriched.forEach(child => drawLiveResource(g, child, type, paginationResourceId));
      } else {
        const enriched = items.map(item => enrichWithChildren(type, item, live));
        enriched.forEach(child => drawLiveResource(g, child, type, rootId));
      }
    });

    return g;
  };

  const drawLiveResource = (g: graphlib.Graph, resource: Record<string, any>, resourceType: string, parentId: string) => {
    const visible = isResourceTypeVisible(resourceType);
    let resourceId = parentId;
    if (visible) {
      resourceId = createNodeWithCardRenderer(
        g,
        `${resourceType.replace('/', '-')}-${resource.metadata.name}`,
        resource as unknown as Record<string, unknown>,
        resourceType,
        { fill: '#e6f4ea', stroke: '#137333', strokeWidth: '1' }
      );
      g.setEdge(parentId, resourceId);
    }
    // Recursively draw children if present
    const children = resource && Array.isArray(resource.children) ? resource.children as Array<Record<string, any>> : [];
    if (children.length > 0) {
      const childrenByType: Record<string, Array<Record<string, any>>> = {};
      for (const child of children) {
        const apiVersion = String(child.apiVersion || 'v1');
        const kind = String(child.kind || child.metadata?.ownerReferences?.[0]?.kind || '');
        if (!kind) continue;
        const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : 'core';
        const childType = `${group}/${kind}`;
        if (!childrenByType[childType]) childrenByType[childType] = [];
        childrenByType[childType].push(child);
      }
      Object.entries(childrenByType).forEach(([childType, items]) => {
        if (items.length > 5 && isResourceTypeVisible(childType)) {
          const paginationKey = `${resourceId}-${childType}`;
          const currentPage = paginationState()[paginationKey] || 0;
          const pageSize = 5;
          const totalPages = Math.ceil(items.length / pageSize);
          const startIndex = currentPage * pageSize;
          const endIndex = Math.min(startIndex + pageSize, items.length);
          const visibleChildren = items.slice(startIndex, endIndex);
          const paginationResourceId = createNode(g, `pagination-${paginationKey}`, '', {
            fill: '#f8f9fa', stroke: '#dee2e6', strokeWidth: '1',
            jsxContent: createPaginationNode(childType, startIndex, endIndex, totalPages, currentPage, setPaginationState, paginationKey, items.length),
            width: 250, height: 70
          });
          g.setEdge(resourceId, paginationResourceId);
          visibleChildren.forEach(child => drawLiveResource(g, child, childType, paginationResourceId));
        } else {
          items.forEach(child => drawLiveResource(g, child, childType, resourceId));
        }
      });
    }
    return resourceId;
  };

  // Recursively attach children using extraWatches mapping
  const enrichWithChildren = (parentType: string, parent: Record<string, any>, live: Record<string, Array<Record<string, any>>>): Record<string, any> => {
    const configs = extraWatches[parentType] || [];
    if (configs.length === 0) return parent;
    const allChildren: Array<Record<string, any>> = [];
    for (const cfg of configs) {
      const pool = live[cfg.resourceType] || [];
      for (const child of pool) {
        if (cfg.isParent(child, parent)) {
          // Recurse for grandchildren
          const enrichedChild = enrichWithChildren(cfg.resourceType, child, live);
          allChildren.push(enrichedChild);
        }
      }
    }
    if (allChildren.length === 0) return parent;
    return { ...parent, children: allChildren };
  };

  // Watch a specific resource type in a namespace and update dynamicResources
  const watchType = (resourceType: string, namespace: string) => {
    const k8sResource = filterStore.k8sResources.find(res => res.id === resourceType);
    if (!k8sResource) return;
    let watchPath = `${k8sResource.apiPath}/${k8sResource.name}?watch=true`;
    if (k8sResource.namespaced) {
      watchPath = `${k8sResource.apiPath}/namespaces/${namespace}/${k8sResource.name}?watch=true`;
    }
    const controller = new AbortController();
    watchResource(
      watchPath,
      (event: { type: string; object: { metadata: { name: string; namespace?: string } } }) => {
        if (event.type === 'ADDED') {
          setDynamicResources(prev => {
            const current = prev[resourceType] || [];
            return { ...prev, [resourceType]: [...current, event.object].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)) };
          });
        } else if (event.type === 'MODIFIED') {
          setDynamicResources(prev => {
            const current = prev[resourceType] || [];
            return { ...prev, [resourceType]: current.map(res => (res.metadata.name === event.object.metadata.name && (res.metadata.namespace || '') === (event.object.metadata.namespace || '')) ? event.object : res) };
          });
        } else if (event.type === 'DELETED') {
          setDynamicResources(prev => {
            const current = prev[resourceType] || [];
            return { ...prev, [resourceType]: current.filter(res => !(res.metadata.name === event.object.metadata.name && (res.metadata.namespace || '') === (event.object.metadata.namespace || ''))) };
          });
        }
        // Rebuild graph on any update
        const hr = helmRelease();
        if (hr && manifestResources().length > 0) {
          setGraph(createHelmGraph(hr, manifestResources()));
        }
      },
      controller,
      () => {}
    );
    setWatchControllers(prev => [...prev, controller]);
  };

  

  const handleBackClick = () => {
    navigate("/");
  };

  return (
    <div class="kustomization-details">
      <Show when={helmRelease()} fallback={<div class="loading">Loading...</div>}>
        {(hr) => {
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{hr().metadata.namespace}/{hr().metadata.name}</h1>
                    <div class="kustomization-status">
                      {StatusBadges(hr() as unknown as ExtendedKustomization)}
                    </div>
                  </div>
                  <div class="header-actions">
                    <button class="sync-button" onClick={async () => {
                      setDiffLoading(true);
                      setDiffDrawerOpen(true);
                      try {
                        const result = await handleFluxDiff(hr());
                        setDiffData(result);
                      } catch (error) {
                        console.error("Failed to generate diff:", error);
                        setDiffData(null);
                      } finally {
                        setDiffLoading(false);
                      }
                    }}>Diff</button>
                    <button
                      class="sync-button reconcile-button"
                      disabled={canReconcile() === false}
                      title={canReconcile() === false ? "Not permitted" : undefined}
                      onClick={() => handleFluxReconcile(hr())}
                    >
                      Reconcile
                    </button>
                    <button
                      class="sync-button"
                      disabled={canReconcileWithSources() === false}
                      title={canReconcileWithSources() === false ? "Not permitted" : undefined}
                      onClick={() => handleFluxReconcileWithSources(hr())}
                    >
                      Reconcile with sources
                    </button>
                    {hr().spec.suspend ? (
                      <button
                        class="sync-button resume"
                        style={{ "background-color": "#188038", "color": "white" }}
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(hr(), false).catch((e) => console.error("Failed to resume HelmRelease:", e));
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>▶</span> Resume
                      </button>
                    ) : (
                      <button
                        class="sync-button suspend"
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(hr(), true).catch((e) => console.error("Failed to suspend HelmRelease:", e));
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>⏸</span> Suspend
                      </button>
                    )}
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Chart:</span>
                      <span class="value">{hr().spec.chart.spec.chart}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Source:</span>
                      <span class="value">{hr().spec.chart.spec.sourceRef.kind}/{hr().spec.chart.spec.sourceRef.namespace ? `${hr().spec.chart.spec.sourceRef.namespace}/` : ''}{hr().spec.chart.spec.sourceRef.name}</span>
                    </div>
                    {hr().spec.chart.spec.version && (
                      <div class="info-item">
                        <span class="label">Version:</span>
                        <span class="value">{hr().spec.chart.spec.version}</span>
                      </div>
                    )}
                    {hr().spec.releaseName && (
                      <div class="info-item">
                        <span class="label">Release Name:</span>
                        <span class="value">{hr().spec.releaseName}</span>
                      </div>
                    )}
                    {hr().spec.targetNamespace && (
                      <div class="info-item">
                        <span class="label">Target Namespace:</span>
                        <span class="value">{hr().spec.targetNamespace}</span>
                      </div>
                    )}
                    <div class="info-item">
                      <span class="label">Interval:</span>
                      <span class="value">{hr().spec.interval}</span>
                    </div>
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 4;">
                      <span class="label">Events:</span>
                      <ul style="font-family: monospace; font-size: 12px;">
                        {(hr().events || []).sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
                          <li><span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: {event.message}</li>
                        ))}
                      </ul>
                    </div>
                    {hr().status && (
                      <div class="info-item full-width">
                        <div class="info-grid">
                          <div class="info-item" style={{ "grid-column": "1 / 3" }}>
                            <span class="label">Last Attempted Revision:</span>
                            <span class="value">{hr().status?.lastAttemptedRevision || 'None'}</span>
                          </div>
                          <div class="info-item">
                            <span class="label">Last Applied Revision:</span>
                            <span class="value">{hr().status?.lastAppliedRevision || 'None'}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div class="info-item full-width">
                      <details>
                        <summary class="label">Conditions</summary>
                        <pre class="conditions-yaml">
                          {hr().status?.conditions ? stringifyYAML(hr().status!.conditions) : 'No conditions available'}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>
            </>
          );
        }}
      </Show>

      <Show when={diffDrawerOpen()}>
        <DiffDrawer
          resource={(helmRelease() as unknown as Kustomization) as Kustomization}
          diffData={diffData()}
          isOpen={diffDrawerOpen()}
          onClose={() => {
            setDiffDrawerOpen(false);
            setDiffData(null);
            setDiffLoading(false);
          }}
          loading={diffLoading()}
        />
      </Show>

      <div style="padding: 16px">
        <Tabs
            tabs={[
              { key: "history", label: "Release History" },
              { key: "values", label: "Values" },
              { key: "manifest", label: "Manifest" },
              { key: "resource", label: "Resource Tree" },
            ]}
            activeKey={activeMainTab()}
            onChange={(k) => setActiveMainTab(k as "resource" | "values" | "manifest" | "history")}
            class=""
            style={{ "margin-top": "12px" }}
        />

      {/* Resource Tree */}
        <Show when={activeMainTab() === "resource" && !!graph()}>
        <div class="resource-tree-wrapper">
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
        </div>
      </Show>

      {/* Values Tab */}
      <Show when={activeMainTab() === "values" && !!helmRelease()}>
        <HelmValues namespace={helmRelease()!.metadata.namespace} name={helmRelease()!.metadata.name} />
      </Show>

      {/* Manifest Tab */}
      <Show when={activeMainTab() === "manifest" && !!helmRelease()}>
        <HelmManifest namespace={helmRelease()!.metadata.namespace} name={helmRelease()!.metadata.name} />
      </Show>

      {/* Release History Tab */}
      <Show when={activeMainTab() === "history" && !!helmRelease()}>
        <HelmHistory
          namespace={helmRelease()!.metadata.namespace}
          name={helmRelease()!.metadata.name}
          apiVersion={helmRelease()!.apiVersion}
          kind={helmRelease()!.kind}
        />
      </Show>
      </div>
    </div>
  );
}


