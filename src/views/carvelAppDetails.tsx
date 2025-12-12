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

  const parseGroupVersion = (apiVersion?: string): { group: string; version: string } => {
    if (!apiVersion) return { group: "", version: "v1" };
    const parts = apiVersion.split("/");
    if (parts.length === 2) return { group: parts[0], version: parts[1] };
    return { group: "", version: parts[0] || "v1" };
  };

  const isCarvelResource = (obj: any): boolean => {
    const gv = parseGroupVersion(obj?.apiVersion);
    const kind = obj?.kind;
    return (gv.group === "kappctrl.k14s.io" && kind === "App") || (gv.group === "packaging.carvel.dev" && kind === "PackageInstall");
  };

  const sortChildrenByKappApplyOrder = (children: any[]): any[] => {
    // Ported from the old server-side logic: only affects App/PackageInstall nodes
    const getAnnotations = (n: any): Record<string, string> => (n?.metadata?.annotations || {}) as Record<string, string>;
    const getChangeGroups = (ann: Record<string, string>) =>
      Object.entries(ann)
        .filter(([k, v]) => (k === "kapp.k14s.io/change-group" || k.startsWith("kapp.k14s.io/change-group.")) && typeof v === "string" && v)
        .map(([, v]) => v);
    const parseChangeRule = (rule: string) => {
      const parts = rule.trim().split(/\s+/);
      if (parts.length < 4) return null;
      return { action: parts[0], timing: parts[1], dependencyType: parts[2], dependencyName: parts[3] };
    };
    const getChangeRules = (ann: Record<string, string>) =>
      Object.entries(ann)
        .filter(([k, v]) => (k === "kapp.k14s.io/change-rule" || k.startsWith("kapp.k14s.io/change-rule.")) && typeof v === "string" && v)
        .map(([, v]) => parseChangeRule(v))
        .filter(Boolean) as Array<{ action: string; timing: string; dependencyType: string; dependencyName: string }>;

    const groupToNodes = new Map<string, number[]>();
    const nodeToGroups = new Map<number, string[]>();
    const nodeDeps = new Map<number, string[]>();
    const allGroups = new Set<string>();

    children.forEach((child, idx) => {
      if (!isCarvelResource(child)) return;
      const ann = getAnnotations(child);
      const groups = getChangeGroups(ann);
      if (groups.length === 0) return;

      nodeToGroups.set(idx, groups);
      groups.forEach((g) => {
        allGroups.add(g);
        groupToNodes.set(g, [...(groupToNodes.get(g) || []), idx]);
      });

      const deps: string[] = [];
      for (const r of getChangeRules(ann)) {
        if (r.action === "upsert" && r.timing === "after" && r.dependencyType === "upserting") {
          deps.push(r.dependencyName);
          allGroups.add(r.dependencyName);
        }
      }
      if (deps.length) nodeDeps.set(idx, deps);
    });

    // groupDeps: group -> groups it depends on
    const groupDeps = new Map<string, Set<string>>();
    for (const [nodeIdx, deps] of nodeDeps.entries()) {
      const groups = nodeToGroups.get(nodeIdx) || [];
      for (const g of groups) {
        const set = groupDeps.get(g) || new Set<string>();
        deps.forEach((d) => set.add(d));
        groupDeps.set(g, set);
      }
    }

    // Kahn topological sort (inDegree = dependency count)
    const inDegree = new Map<string, number>();
    allGroups.forEach((g) => inDegree.set(g, 0));
    groupDeps.forEach((deps, g) => inDegree.set(g, deps.size));

    const queue: string[] = [];
    for (const g of allGroups) if ((inDegree.get(g) || 0) === 0) queue.push(g);

    const sortedGroups: string[] = [];
    while (queue.length) {
      const g = queue.shift()!;
      sortedGroups.push(g);
      for (const [gg, deps] of groupDeps.entries()) {
        if (deps.has(g)) {
          inDegree.set(gg, (inDegree.get(gg) || 0) - 1);
          if ((inDegree.get(gg) || 0) === 0) queue.push(gg);
        }
      }
    }

    const out: any[] = [];
    const processed = new Set<number>();
    for (const g of sortedGroups) {
      const idxs = groupToNodes.get(g) || [];
      for (const idx of idxs) {
        if (!processed.has(idx)) {
          out.push(children[idx]);
          processed.add(idx);
        }
      }
    }
    children.forEach((c, idx) => {
      if (!processed.has(idx)) out.push(c);
    });
    return out;
  };

  const fetchDiagramDataFromApiServer = async (app: CarvelApp) => {
    const apiResources = apiResourceStore.apiResources || [];
    const assoc = (app as any)?.status?.deploy?.kapp?.associatedResources;
    const labelFull = assoc?.label as string | undefined;
    const groupKinds = assoc?.groupKinds as Array<{ group?: string; kind?: string }> | undefined;
    const namespaces = assoc?.namespaces as string[] | undefined;

    if (!labelFull || !groupKinds || groupKinds.length === 0) return { child_objects: [] as any[] };
    const parts = labelFull.split("=");
    if (parts.length !== 2) return { child_objects: [] as any[] };
    const kappLabel = parts[1];

    // If the App targets a remote cluster, the associated resources likely live there.
    // We can still render the App node, but we can't safely fetch remote resources in-browser.
    const targetsRemote = !!(app as any)?.spec?.cluster?.kubeconfigSecretRef?.name;
    if (targetsRemote) return { child_objects: [] as any[] };

    const includeAll = includeAllResources();
    const includeOnly = includeOnlyCarvel();
    if (!includeAll && !includeOnly) return { child_objects: [] as any[] };

    const selector = `kapp.k14s.io/app=${kappLabel}`;

    const listForGk = async (group: string, kind: string, ns?: string) => {
      const r = apiResources.find(ar => ar.group === group && ar.kind === kind);
      if (!r) return [] as any[];
      const apiPath = r.apiPath; // already includes /k8s/<ctx>/...
      const plural = r.name;
      const namespaced = (r as any).namespaced as boolean;
      const qs = `labelSelector=${encodeURIComponent(selector)}`;

      const url = namespaced
        ? `${apiPath}/namespaces/${ns}/${plural}?${qs}`
        : `${apiPath}/${plural}?${qs}`;

      const resp = await fetch(url);
      if (!resp.ok) return [] as any[];
      const data = await resp.json().catch(() => ({}));
      return Array.isArray((data as any).items) ? (data as any).items : [];
    };

    const keyOf = (obj: any) => {
      const gv = parseGroupVersion(obj?.apiVersion);
      const kind = obj?.kind || "";
      const ns = obj?.metadata?.namespace || "";
      const name = obj?.metadata?.name || "";
      return `${gv.group}/${kind}/${ns}/${name}`;
    };

    const toNode = (obj: any) => {
      const gv = parseGroupVersion(obj?.apiVersion);
      const ns = obj?.metadata?.namespace || "";
      const name = obj?.metadata?.name || "";
      return {
        ...obj,
        // Fields expected by existing carvel graph rendering
        group: gv.group || "core",
        version: gv.version,
        name,
        namespace: ns,
        cluster: "in-cluster",
        child_objects: [] as any[],
      };
    };

    const visited = new Set<string>();
    const buildSubtree = async (rootObj: any): Promise<any> => {
      const rootKey = keyOf(rootObj);
      if (visited.has(rootKey)) return toNode(rootObj);
      visited.add(rootKey);

      const node = toNode(rootObj);
      const assoc2 = (rootObj as any)?.status?.deploy?.kapp?.associatedResources;
      const label2Full = assoc2?.label as string | undefined;
      const groupKinds2 = assoc2?.groupKinds as Array<{ group?: string; kind?: string }> | undefined;
      const namespaces2 = assoc2?.namespaces as string[] | undefined;
      if (!label2Full || !groupKinds2 || !groupKinds2.length) return node;

      const p2 = label2Full.split("=");
      if (p2.length !== 2) return node;
      const selector2 = `kapp.k14s.io/app=${p2[1]}`;

      const listForGk2 = async (group: string, kind: string, ns?: string) => {
        const r = apiResources.find(ar => ar.group === group && ar.kind === kind);
        if (!r) return [] as any[];
        const apiPath = r.apiPath;
        const plural = r.name;
        const namespaced = (r as any).namespaced as boolean;
        const qs = `labelSelector=${encodeURIComponent(selector2)}`;
        const url = namespaced
          ? `${apiPath}/namespaces/${ns}/${plural}?${qs}`
          : `${apiPath}/${plural}?${qs}`;
        const resp = await fetch(url);
        if (!resp.ok) return [] as any[];
        const data = await resp.json().catch(() => ({}));
        return Array.isArray((data as any).items) ? (data as any).items : [];
      };

      const seen = new Set<string>();
      const children: any[] = [];
      for (const gk of groupKinds2) {
        const g = gk.group || "";
        const k = gk.kind || "";
        if (!k) continue;

        const r = apiResources.find(ar => ar.group === g && ar.kind === k);
        const namespaced = r ? ((r as any).namespaced as boolean) : true;
        if (namespaced) {
          for (const ns of (namespaces2 || [])) {
            if (!ns || ns === "(cluster)") continue;
            const items = await listForGk2(g, k, ns);
            for (const it of items) {
              const childKey = keyOf(it);
              if (seen.has(childKey)) continue;
              seen.add(childKey);
              if (includeOnly && !isCarvelResource(it)) continue;
              children.push(isCarvelResource(it) ? await buildSubtree(it) : toNode(it));
            }
          }
        } else if ((namespaces2 || []).includes("(cluster)")) {
          const items = await listForGk2(g, k, "");
          for (const it of items) {
            const childKey = keyOf(it);
            if (seen.has(childKey)) continue;
            seen.add(childKey);
            if (includeOnly && !isCarvelResource(it)) continue;
            children.push(isCarvelResource(it) ? await buildSubtree(it) : toNode(it));
          }
        }
      }

      node.child_objects = sortChildrenByKappApplyOrder(children);
      return node;
    };

    // Root App subtree
    const rootNode = await buildSubtree(app as any);
    return { child_objects: rootNode.child_objects || [] };
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
        // Re-run when toggles change
        includeAllResources();
        includeOnlyCarvel();
        const data = await fetchDiagramDataFromApiServer(app);
        console.log('[CarvelApp] Diagram (client-side) response:', data);
        console.log('[CarvelApp] Has child_objects?', !!(data as any).child_objects, 'Count:', (data as any).child_objects?.length);
        setDiagramData(data as any);
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
        // Remote-cluster fetching is intentionally not supported.
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
  const patchAppSpec = async (specPatch: Record<string, unknown>) => {
    const app = carvelApp();
    if (!app) return;

    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
    const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";

    // Resolve API path and plural dynamically (fallback to known defaults)
    const carvelAppApi = (apiResourceStore.apiResources || []).find(r => r.group === "kappctrl.k14s.io" && r.kind === "App");
    const withContextK8sApiPath = (apiPath: string) => {
      if (apiPath.startsWith("/k8s/api/") || apiPath.startsWith("/k8s/apis/")) {
        return apiPath.replace("/k8s", k8sPrefix);
      }
      return apiPath;
    };
    const baseApiPath = withContextK8sApiPath(carvelAppApi?.apiPath || "/k8s/apis/kappctrl.k14s.io/v1alpha1");
    const pluralName = carvelAppApi?.name || "apps";

    const url = `${baseApiPath}/namespaces/${app.metadata.namespace}/${pluralName}/${app.metadata.name}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/merge-patch+json" },
      body: JSON.stringify({ spec: specPatch }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as any)?.message || (data as any)?.error || `PATCH failed (${response.status})`);
    }
  };

  const handlePause = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      await patchAppSpec({ paused: true });
    } catch (e) {
      console.error('Failed to pause App:', e);
    }
  };

  const handleUnpause = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      await patchAppSpec({ paused: false });
    } catch (e) {
      console.error('Failed to unpause App:', e);
    }
  };

  const handleCancel = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      await patchAppSpec({ canceled: true });
    } catch (e) {
      console.error('Failed to cancel App:', e);
    }
  };

  const handleUncancel = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      await patchAppSpec({ canceled: false });
    } catch (e) {
      console.error('Failed to uncancel App:', e);
    }
  };

  const handleTrigger = async () => {
    const app = carvelApp();
    if (!app) return;
    
    try {
      await patchAppSpec({ paused: true });
      await new Promise((r) => setTimeout(r, 500));
      await patchAppSpec({ paused: false });
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
