// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { Tabs } from "../components/Tabs.tsx";
import { ResourceTree, createNodeWithCardRenderer, createNode, createPaginationNode } from "../components/ResourceTree.tsx";
import { ResourceTypeVisibilityDropdown } from "../components/ResourceTypeVisibilityDropdown.tsx";
import { HelmValues } from "../components/resourceDetail/HelmValues.tsx";
import { HelmManifest } from "../components/resourceDetail/HelmManifest.tsx";
import { HelmHistory } from "../components/resourceDetail/HelmHistory.tsx";
import { parse as parseYAML } from "@std/yaml";
import * as graphlib from "graphlib";

type HelmRelease = {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace: string; creationTimestamp?: string };
  spec?: { chart?: string; chartVersion?: string };
  status?: { status?: string; revision?: number; appVersion?: string };
};

export function HelmClassicReleaseDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const filterStore = useFilterStore();

  const [helmRelease, setHelmRelease] = createSignal<HelmRelease | null>(null);
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

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

  const extraWatches: Record<string, Array<{
    resourceType: string;
    isParent: (child: Record<string, any>, parent: Record<string, any>) => boolean;
  }>> = {
    'apps/Deployment': [
      { resourceType: 'apps/ReplicaSet', isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'Deployment' && o.name === parent.metadata.name) }
    ],
    'apps/ReplicaSet': [
      { resourceType: 'core/Pod', isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'ReplicaSet' && o.name === parent.metadata.name) }
    ],
    'core/PersistentVolumeClaim': [
      { resourceType: 'core/PersistentVolume', isParent: (child, parent) => child.spec?.claimRef?.name === parent.metadata.name }
    ],
    'batch/CronJob': [
      { resourceType: 'batch/Job', isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'CronJob' && o.name === parent.metadata.name) }
    ],
    'bitnami.com/SealedSecret': [
      { resourceType: 'core/Secret', isParent: (child, parent) => child.metadata.name === parent.metadata.name && child.metadata.namespace === parent.metadata.namespace }
    ],
    'keda.sh/ScaledJob': [
      { resourceType: 'batch/Job', isParent: (child, parent) => child.metadata.ownerReferences?.some((o: any) => o.kind === 'ScaledJob' && o.name === parent.metadata.name) }
    ],
    'keda.sh/ScaledObject': [
      { resourceType: 'apps/Deployment', isParent: (child, parent) => parent.spec?.scaleTargetRef?.name === child.metadata.name && parent.spec?.scaleTargetRef?.kind === 'Deployment' }
    ]
  };

  createEffect(() => {
    if (params.namespace && params.name && filterStore.k8sResources) {
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

    setHelmRelease({ apiVersion: 'helm.sh/v3', kind: 'Release', metadata: { name, namespace: ns } });

    const controllers: AbortController[] = [];

    // Watch Helm classic releases
    {
      const k8sResource = filterStore.k8sResources.find(res => res.id === 'helm.sh/Release');
      if (k8sResource) {
        const controller = new AbortController();
        const path = `${k8sResource.apiPath}/namespaces/${ns}/${k8sResource.name}?watch=true`;
        watchResource(
          path,
          (event: { type: string; object: HelmRelease }) => {
            if ((event.type === 'ADDED' || event.type === 'MODIFIED') && event.object.metadata?.name === name) {
              setHelmRelease(event.object);
            }
          },
          controller,
          () => {}
        );
        controllers.push(controller);
      }
    }

    setWatchControllers(controllers);
  };

  // Build resource tree from Helm manifest of latest revision, then watch live objects
  createEffect(() => {
    const hr = helmRelease();
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
        const nsSet = new Set<string>(resources.map(r => r.metadata.namespace || ns));
        const extraTypes = new Set<string>();
        Object.values(extraWatches).forEach(configs => configs.forEach(cfg => extraTypes.add(cfg.resourceType)));
        extraTypes.forEach(type => {
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
      } catch (_) {}
    }
    return out;
  };

  const createHelmGraph = (hr: HelmRelease, resList: MinimalRes[]) => {
    const g = new graphlib.Graph({ directed: true });
    g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 80, marginx: 20, marginy: 20, align: 'UL' });
    g.setDefaultEdgeLabel(() => ({}));

    const deployed = String(hr.status?.status || '').toLowerCase() === 'deployed';
    const rootId = createNodeWithCardRenderer(
      g,
      `helmclassic-${hr.metadata.namespace}-${hr.metadata.name}`,
      { apiVersion: hr.apiVersion || 'helm.sh/v3', kind: 'Release', metadata: { name: hr.metadata.name, namespace: hr.metadata.namespace } },
      'helm.sh/Release',
      {
        fill: deployed ? '#e6f4ea' : '#fce8e6',
        stroke: deployed ? '#137333' : '#c5221f',
        strokeWidth: '2'
      }
    );

    const includeIndex: Record<string, Record<string, Set<string>>> = {};
    for (const r of resList) {
      const ns = r.metadata.namespace || '';
      if (!includeIndex[r.resourceType]) includeIndex[r.resourceType] = {};
      if (!includeIndex[r.resourceType][ns]) includeIndex[r.resourceType][ns] = new Set<string>();
      includeIndex[r.resourceType][ns].add(r.metadata.name);
    }

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

  const enrichWithChildren = (parentType: string, parent: Record<string, any>, live: Record<string, Array<Record<string, any>>>): Record<string, any> => {
    const configs = extraWatches[parentType] || [];
    if (configs.length === 0) return parent;
    const allChildren: Array<Record<string, any>> = [];
    for (const cfg of configs) {
      const pool = live[cfg.resourceType] || [];
      for (const child of pool) {
        if (cfg.isParent(child, parent)) {
          const enrichedChild = enrichWithChildren(cfg.resourceType, child, live);
          allChildren.push(enrichedChild);
        }
      }
    }
    if (allChildren.length === 0) return parent;
    return { ...parent, children: allChildren };
  };

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

  const StatusBadge = (props: { status?: string }) => {
    const getColor = (status?: string) => {
      switch ((status || '').toLowerCase()) {
        case 'deployed':
          return 'var(--success-color)';
        case 'failed':
          return 'var(--error-color)';
        case 'pending-install':
        case 'pending-upgrade':
        case 'pending-rollback':
          return 'var(--warning-color)';
        case 'superseded':
          return 'var(--linear-text-tertiary)';
        default:
          return 'var(--linear-text-secondary)';
      }
    };
    return <span style={{ color: getColor(props.status), 'font-weight': '500' }}>{props.status || ''}</span>;
  };

  return (
    <div class="kustomization-details">
      <Show when={helmRelease()} fallback={<div class="loading">Loading...</div>}>
        {(hr) => (
          <>
            <header class="kustomization-header">
              <div class="header-top">
                <div class="header-left">
                  <button class="back-button" onClick={handleBackClick}>
                    <span class="icon">←</span> Back
                  </button>
                  <h1>{hr().metadata.namespace}/{hr().metadata.name}</h1>
                </div>
              </div>

              <div class="header-info">
                <div class="info-grid">
                  <div class="info-item">
                    <span class="label">Chart:</span>
                    <span class="value">{hr().spec?.chart || ''}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">Chart Version:</span>
                    <span class="value">{hr().spec?.chartVersion || ''}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">App Version:</span>
                    <span class="value">{hr().status?.appVersion || ''}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">Revision:</span>
                    <span class="value">{hr().status?.revision || ''}</span>
                  </div>
                  <div class="info-item">
                    <span class="label">Status:</span>
                    <span class="value"><StatusBadge status={hr().status?.status} /></span>
                  </div>
                  <div class="info-item">
                    <span class="label">Age:</span>
                    <span class="value">{useCalculateAge(hr().metadata.creationTimestamp || '')()}</span>
                  </div>
                </div>
              </div>
            </header>
          </>
        )}
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
            apiVersion={helmRelease()!.apiVersion || 'helm.sh/v3'}
            kind={helmRelease()!.kind || 'Release'}
          />
        </Show>
      </div>
    </div>
  );
}


