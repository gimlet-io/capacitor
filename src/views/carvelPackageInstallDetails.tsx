// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { CarvelPackageInstall } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";
import { createNodeWithCardRenderer, ResourceTree } from "../components/ResourceTree.tsx";
import { ResourceTypeVisibilityDropdown } from "../components/ResourceTypeVisibilityDropdown.tsx";
import * as graphlib from "graphlib";
import { Tabs } from "../components/Tabs.tsx";
import { LogsViewer } from "../components/resourceDetail/LogsViewer.tsx";
import { useAppConfig } from "../store/appConfigStore.tsx";
import { CarvelValuesViewer } from "../components/resourceDetail/CarvelValuesViewer.tsx";
import { OpenAPISchemaViewer } from "../components/resourceDetail/OpenAPISchemaViewer.tsx";

export function CarvelPackageInstallDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const filterStore = useFilterStore();

  const [packageInstall, setPackageInstall] = createSignal<CarvelPackageInstall | null>(null);
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Resource tree state
  const [graph, setGraph] = createSignal<graphlib.Graph>();
  const [allResourceTypes, setAllResourceTypes] = createSignal<string[]>([]);
  const [visibleResourceTypes, setVisibleResourceTypes] = createSignal<Set<string>>(new Set());
  const [includeAllResources, setIncludeAllResources] = createSignal(false);
  const [includeOnlyCarvel, setIncludeOnlyCarvel] = createSignal(false);
  const [diagramData, setDiagramData] = createSignal<any>(null);
  const [packageLoading, setPackageLoading] = createSignal(false);
  const [packageError, setPackageError] = createSignal<string | null>(null);
  
  const [activeMainTab, setActiveMainTab] = createSignal<"resource" | "package" | "values" | "logs">("resource");
  const [packageData, setPackageData] = createSignal<any>(null);
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

    const groupDeps = new Map<string, Set<string>>();
    for (const [nodeIdx, deps] of nodeDeps.entries()) {
      const groups = nodeToGroups.get(nodeIdx) || [];
      for (const g of groups) {
        const set = groupDeps.get(g) || new Set<string>();
        deps.forEach((d) => set.add(d));
        groupDeps.set(g, set);
      }
    }

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

  const fetchAppByName = async (namespace: string, name: string) => {
    const apiResources = apiResourceStore.apiResources || [];
    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
    const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
    const withContextK8sApiPath = (apiPath: string) => {
      if (apiPath.startsWith("/k8s/api/") || apiPath.startsWith("/k8s/apis/")) {
        return apiPath.replace("/k8s", k8sPrefix);
      }
      return apiPath;
    };

    const appApi = apiResources.find(r => r.group === "kappctrl.k14s.io" && r.kind === "App");
    const baseApiPath = withContextK8sApiPath(appApi?.apiPath || "/k8s/apis/kappctrl.k14s.io/v1alpha1");
    const pluralName = appApi?.name || "apps";
    const url = `${baseApiPath}/namespaces/${namespace}/${pluralName}/${name}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json().catch(() => null);
  };

  const fetchDiagramDataFromApiServer = async (pkgi: CarvelPackageInstall) => {
    // Mirror the previous server behavior:
    // - Always include the associated App as a child node
    // - Only populate the App's children when includeAll/includeOnlyCarvel is enabled
    const includeAll = includeAllResources();
    const includeOnly = includeOnlyCarvel();

    const app = await fetchAppByName(pkgi.metadata.namespace, pkgi.metadata.name);
    if (!app) return { child_objects: [] as any[] };

    const apiResources = apiResourceStore.apiResources || [];
    const assoc = (app as any)?.status?.deploy?.kapp?.associatedResources;
    const labelFull = assoc?.label as string | undefined;
    const groupKinds = assoc?.groupKinds as Array<{ group?: string; kind?: string }> | undefined;
    const namespaces = assoc?.namespaces as string[] | undefined;

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
        group: gv.group || "core",
        version: gv.version,
        name,
        namespace: ns,
        cluster: "in-cluster",
        child_objects: [] as any[],
      };
    };

    // Always include the App node at minimum
    const appNode = toNode(app);

    // If neither toggle is enabled, return the App node without expanding children.
    if (!includeAll && !includeOnly) {
      return { child_objects: [appNode] };
    }

    // For expanded views, if kapp metadata is missing, still return the App node.
    if (!labelFull || !groupKinds || groupKinds.length === 0) {
      return { child_objects: [appNode] };
    }
    const parts = labelFull.split("=");
    if (parts.length !== 2) return { child_objects: [appNode] };
    const kappLabel = parts[1];

    const targetsRemote = !!(app as any)?.spec?.cluster?.kubeconfigSecretRef?.name;
    if (targetsRemote) return { child_objects: [appNode] };

    const selector = `kapp.k14s.io/app=${kappLabel}`;

    const listForGk = async (group: string, kind: string, ns?: string) => {
      const r = apiResources.find(ar => ar.group === group && ar.kind === kind);
      if (!r) return [] as any[];
      const apiPath = r.apiPath;
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

      const includeOnly = includeOnlyCarvel();
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

    const expandedAppNode = await buildSubtree(app);
    return { child_objects: [expandedAppNode] };
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

    setPackageInstall(null);

    type PackageInstallEvent = { type: string; object: CarvelPackageInstall };
    const controllers: AbortController[] = [];

    // Resolve API path and plural for PackageInstall dynamically
    const pkgiApi = (apiResourceStore.apiResources || []).find(r => r.group === 'packaging.carvel.dev' && r.kind === 'PackageInstall');
    const baseApiPath = pkgiApi?.apiPath || '/k8s/apis/packaging.carvel.dev/v1alpha1';
    const pluralName = pkgiApi?.name || 'packageinstalls';

    // Watch PackageInstall itself
    {
      const controller = new AbortController();
      const path = `${baseApiPath}/namespaces/${ns}/${pluralName}?watch=true`;
      const callback = (event: PackageInstallEvent) => {
        if ((event.type === 'ADDED' || event.type === 'MODIFIED') && event.object.metadata.name === name) {
          setPackageInstall(event.object);
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
    const pkgi = packageInstall();
    if (!pkgi) return;
    
    (async () => {
      try {
        includeAllResources();
        includeOnlyCarvel();
        const data = await fetchDiagramDataFromApiServer(pkgi);
        console.log('[PackageInstall] Diagram (client-side) response:', data);
        console.log('[PackageInstall] Has child_objects?', !!(data as any).child_objects, 'Count:', (data as any).child_objects?.length);
        setDiagramData(data as any);
      } catch (e) {
        console.error('Failed to fetch PackageInstall diagram:', e);
      }
    })();
  });

  // Fetch Package details when Package tab is active
  createEffect(() => {
    const pkgi = packageInstall();
    const tab = activeMainTab();
    
    if (tab !== "package" || !pkgi) {
      return;
    }

    // Get package name from PackageInstall status.version
    const packageVersion = pkgi.status?.version;
    const packageRefName = pkgi.spec?.packageRef?.refName;
    
    if (!packageRefName || !packageVersion) {
      setPackageError("Package reference or version not found in PackageInstall");
      return;
    }

    // Package CR name format: refName.version
    const packageName = `${packageRefName}.${packageVersion}`;
    
    (async () => {
      try {
        setPackageLoading(true);
        setPackageError(null);
        
        const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
        const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";

        const withContextK8sApiPath = (apiPath: string) => {
          // `apiResourceStore` already returns context-aware paths (e.g. /k8s/<ctx>/apis/..).
          // Only inject context when the path is the legacy non-context form (/k8s/api/* or /k8s/apis/*).
          if (apiPath.startsWith("/k8s/api/") || apiPath.startsWith("/k8s/apis/")) {
            return apiPath.replace("/k8s", k8sPrefix);
          }
          return apiPath;
        };

        const pkgApi = (apiResourceStore.apiResources || []).find(r => r.group === "data.packaging.carvel.dev" && r.kind === "Package");
        const baseApiPath = withContextK8sApiPath(pkgApi?.apiPath || "/k8s/apis/data.packaging.carvel.dev/v1alpha1");
        const pluralName = pkgApi?.name || "packages";

        const url = `${baseApiPath}/namespaces/${params.namespace}/${pluralName}/${packageName}`;
        
        const response = await fetch(url);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setPackageError(errorData.error || `Failed to fetch Package (${response.status})`);
          setPackageLoading(false);
          return;
        }
        
        const data = await response.json();
        console.log('[PackageInstall] Package data:', data);
        // Keep the previous UI expectations (had a "cluster" field)
        setPackageData({ ...(data as any), cluster: "in-cluster" });
        setPackageLoading(false);
      } catch (e) {
        console.error('Failed to fetch Package details:', e);
        setPackageError(String(e));
        setPackageLoading(false);
      }
    })();
  });

  // Track if we've done initial setup to prevent infinite loops
  let initialSetupDone = false;

  // Rebuild graph when data changes
  createEffect(() => {
    const pkgi = packageInstall();
    const data = diagramData();
    
    console.log('[PackageInstall] Data effect triggered - pkgi:', !!pkgi, 'data:', !!data, 'child_objects:', data?.child_objects?.length);
    
    if (!pkgi || !data) {
      console.log('[PackageInstall] Skipping graph build - missing pkgi or data');
      return;
    }
    
    // Build resource tree graph - always build to show at least the root node
    console.log('[PackageInstall] Building resource tree with', data.child_objects?.length || 0, 'child objects');
    initialSetupDone = false; // Reset flag when new data arrives
    buildResourceTree(pkgi, data);
  });

  // Rebuild graph when visibility changes (after initial setup)
  createEffect(() => {
    const pkgi = packageInstall();
    const data = diagramData();
    const visible = visibleResourceTypes(); // Track visibility changes
    
    // Only rebuild if we have data and initial setup is complete
    if (!pkgi || !data || !initialSetupDone) {
      return;
    }
    
    console.log('[PackageInstall] Visibility changed, rebuilding graph');
    buildResourceTree(pkgi, data);
  });

  const buildResourceTree = (pkgi: CarvelPackageInstall, tree: any) => {
    console.log('[PackageInstall] buildResourceTree called with tree:', tree);
    
    const g = new graphlib.Graph({ directed: true });
    g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 80, marginx: 20, marginy: 20, align: 'UL' });
    g.setDefaultEdgeLabel(() => ({}));

    const rootId = createNodeWithCardRenderer(
      g,
      `packageinstall-${pkgi.metadata.namespace}-${pkgi.metadata.name}`,
      pkgi as unknown as Record<string, unknown>,
      'packaging.carvel.dev/PackageInstall',
      {
        fill: (pkgi.status?.conditions || []).some(c => c.type === 'ReconcileSucceeded' && c.status === 'True') ? '#e6f4ea' : '#fce8e6',
        stroke: (pkgi.status?.conditions || []).some(c => c.type === 'ReconcileSucceeded' && c.status === 'True') ? '#137333' : '#c5221f',
        strokeWidth: '2'
      }
    );
    console.log('[PackageInstall] Created root node with ID:', rootId);

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
      
      console.log('[PackageInstall] Collected resource types:', Array.from(resourceTypes));
      
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
        console.log('[PackageInstall] Set initial visibility:', Array.from(initialVisible));
      } else {
        console.log('[PackageInstall] Using existing visibility:', Array.from(visibleResourceTypes()));
      }

      // Draw child_objects
      tree.child_objects.forEach((child: any) => {
        drawResourceNode(g, child, rootId);
      });
    }

    console.log('[PackageInstall] Graph nodes:', g.nodes().length, 'edges:', g.edges().length);
    setGraph(g);
  };

  const drawResourceNode = (g: graphlib.Graph, resource: any, parentId: string) => {
    const resourceType = `${resource.group || 'core'}/${resource.kind}`;
    const visible = isResourceTypeVisible(resourceType);
    
    console.log('[PackageInstall] Drawing node:', resource.name, 'type:', resourceType, 'visible:', visible);
    console.log('[PackageInstall] Resource structure:', resource);
    
    // Always track the resource for its ID, but only render if visible
    let nodeId = parentId;
    if (visible) {
      // Get the current packageInstall for parent information
      const pkgi = packageInstall();
      
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
      };
      
      nodeId = createNodeWithCardRenderer(
        g,
        `${resourceType.replace('/', '-')}-${resource.namespace || 'default'}-${resource.name}`,
        normalizedResource as unknown as Record<string, unknown>,
        resourceType,
        { fill: '#e6f4ea', stroke: '#137333', strokeWidth: '1' }
      );
      g.setEdge(parentId, nodeId);
      console.log('[PackageInstall] Created node:', nodeId);
    } else {
      console.log('[PackageInstall] Skipped invisible node:', resource.name);
    }

    // Recursively draw child_objects, using current nodeId as parent if visible, otherwise use original parent
    if (resource.child_objects && Array.isArray(resource.child_objects)) {
      resource.child_objects.forEach((child: any) => {
        drawResourceNode(g, child, nodeId);
      });
    }
  };

  // PackageInstall operations
  const patchPackageInstallSpec = async (specPatch: Record<string, unknown>) => {
    const pkgi = packageInstall();
    if (!pkgi) return;

    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
    const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";

    const pkgiApi = (apiResourceStore.apiResources || []).find(r => r.group === "packaging.carvel.dev" && r.kind === "PackageInstall");
    const withContextK8sApiPath = (apiPath: string) => {
      if (apiPath.startsWith("/k8s/api/") || apiPath.startsWith("/k8s/apis/")) {
        return apiPath.replace("/k8s", k8sPrefix);
      }
      return apiPath;
    };
    const baseApiPath = withContextK8sApiPath(pkgiApi?.apiPath || "/k8s/apis/packaging.carvel.dev/v1alpha1");
    const pluralName = pkgiApi?.name || "packageinstalls";

    const url = `${baseApiPath}/namespaces/${pkgi.metadata.namespace}/${pluralName}/${pkgi.metadata.name}`;

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
    const pkgi = packageInstall();
    if (!pkgi) return;
    
    try {
      await patchPackageInstallSpec({ paused: true });
    } catch (e) {
      console.error('Failed to pause PackageInstall:', e);
    }
  };

  const handleUnpause = async () => {
    const pkgi = packageInstall();
    if (!pkgi) return;
    
    try {
      await patchPackageInstallSpec({ paused: false });
    } catch (e) {
      console.error('Failed to unpause PackageInstall:', e);
    }
  };

  const handleCancel = async () => {
    const pkgi = packageInstall();
    if (!pkgi) return;
    
    try {
      await patchPackageInstallSpec({ canceled: true });
    } catch (e) {
      console.error('Failed to cancel PackageInstall:', e);
    }
  };

  const handleUncancel = async () => {
    const pkgi = packageInstall();
    if (!pkgi) return;
    
    try {
      await patchPackageInstallSpec({ canceled: false });
    } catch (e) {
      console.error('Failed to uncancel PackageInstall:', e);
    }
  };

  const handleTrigger = async () => {
    const pkgi = packageInstall();
    if (!pkgi) return;
    
    try {
      await patchPackageInstallSpec({ paused: true });
      await new Promise((r) => setTimeout(r, 500));
      await patchPackageInstallSpec({ paused: false });
    } catch (e) {
      console.error('Failed to trigger PackageInstall:', e);
    }
  };

  const handleBackClick = () => {
    navigate("/");
  };

  // Helper functions for spec info
  const getPackageRef = (pkgi: CarvelPackageInstall): string => {
    if (!pkgi.spec?.packageRef) return 'N/A';
    
    const ref = pkgi.spec.packageRef;
    const version = ref.versionSelection?.constraints || '';
    return `${ref.refName}${version ? ` (${version})` : ''}`;
  };

  const getValuesInfo = (pkgi: CarvelPackageInstall): string => {
    if (!pkgi.spec?.values || !Array.isArray(pkgi.spec.values)) return 'N/A';
    
    const parts: string[] = [];
    for (const value of pkgi.spec.values) {
      if (value.secretRef?.name) {
        parts.push(`secret: ${value.secretRef.name}`);
      }
      if (value.configMapRef?.name) {
        parts.push(`configMap: ${value.configMapRef.name}`);
      }
    }
    return parts.length > 0 ? parts.join(', ') : 'inline';
  };

  const getTargetCluster = (pkgi: CarvelPackageInstall): string => {
    return pkgi.spec?.cluster?.kubeconfigSecretRef?.name || 'in-cluster';
  };

  return (
    <div class="kustomization-details">
      <Show when={packageInstall()} fallback={<div class="loading">Loading...</div>}>
        {(pkgi) => {
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{pkgi().metadata.namespace}/{pkgi().metadata.name}</h1>
                    <div class="kustomization-status">
                      {StatusBadges(pkgi() as any)}
                    </div>
                  </div>
                  <div class="header-actions">
                    {pkgi().spec?.paused ? (
                      <button class="sync-button resume" onClick={handleUnpause}>
                        Unpause
                      </button>
                    ) : (
                      <button class="sync-button" onClick={handlePause}>
                        Pause
                      </button>
                    )}
                    {pkgi().spec?.canceled ? (
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
                            <span class={`badge ${pkgi().spec?.paused ? 'badge-paused' : 'badge-ready'}`}>
                              {pkgi().spec?.paused ? 'true' : 'false'}
                            </span>
                          </span>
                        </div>
                        <div class="info-item">
                          <span class="label">Canceled:</span>
                          <span class="value">
                            <span class={`badge ${pkgi().spec?.canceled ? 'badge-canceled' : 'badge-ready'}`}>
                              {pkgi().spec?.canceled ? 'true' : 'false'}
                            </span>
                          </span>
                        </div>
                        <div class="info-item">
                          <span class="label">Service Account:</span>
                          <span class="value">{pkgi().spec?.serviceAccountName || 'default'}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Sync Period:</span>
                          <span class="value">{pkgi().spec?.syncPeriod || '30s'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Package:</span>
                          <span class="value">{getPackageRef(pkgi())}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Values:</span>
                          <span class="value">{getValuesInfo(pkgi())}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Target:</span>
                          <span class="value">{getTargetCluster(pkgi())}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right column: Status Summary */}
                    <div class="info-item" style="grid-column: 2 / 3;">
                      <h3 style="margin-bottom: 0.5rem;">Status</h3>
                      <div class="info-grid">
                        <div class="info-item full-width">
                          <span class="label">Friendly Description:</span>
                          <span class="value">{pkgi().status?.friendlyDescription || 'N/A'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Useful Error Message:</span>
                          <span class="value">{pkgi().status?.usefulErrorMessage || 'N/A'}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="label">Reconciliation Status:</span>
                          <span class="value">
                            {(() => {
                              const conditions = pkgi().status?.conditions || [];
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
                          <span class="value">{pkgi().status?.observedGeneration || '—'}</span>
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
            { key: "package", label: "Package Details" },
            { key: "values", label: "Values" },
            { key: "logs", label: "kapp-controller Logs" },
          ]}
          activeKey={activeMainTab()}
          onChange={(k) => setActiveMainTab(k as "resource" | "package" | "values" | "logs")}
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

        {/* Package Details Tab */}
        <Show when={activeMainTab() === "package"}>
          <div style="margin-top: 1rem;">
            <Show when={packageLoading()}>
              <div style="padding: 2rem; text-align: center; color: var(--linear-text-secondary);">
                <p>Loading package details...</p>
              </div>
            </Show>
            
            <Show when={packageError()}>
              <div style="padding: 2rem; text-align: center; color: var(--red-text);">
                <p>Error loading package: {packageError()}</p>
              </div>
            </Show>
            
            <Show when={!packageLoading() && !packageError() && packageData()}>
              {() => {
                const pkg = packageData()!;
                const spec = pkg.spec || {};
                const template = spec.template?.spec || {};
                
                return (
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    {/* Package Overview */}
                    <div class="merged-values-section" style="grid-column: 1 / -1;">
                      <div class="merged-values-header">
                        <h3>Package Overview</h3>
                      </div>
                      <div class="info-grid" style="padding: 0.75rem 1rem;">
                        <div class="info-item">
                          <span class="label">Package Name:</span>
                          <span class="value" style="font-family: monospace;">{spec.refName || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Version:</span>
                          <span class="value" style="font-family: monospace;">{spec.version || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Released At:</span>
                          <span class="value">{spec.releasedAt || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Cluster:</span>
                          <span class="value">{pkg.cluster || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Release Notes & Capacity Requirements side by side */}
                    <Show when={spec.releaseNotes}>
                      <div class="merged-values-section">
                        <div class="merged-values-header">
                          <h3>Release Notes</h3>
                        </div>
                        <div style="padding: 0.75rem 1rem; color: var(--linear-text-primary); line-height: 1.5; font-size: 0.9rem;">
                          {spec.releaseNotes}
                        </div>
                      </div>
                    </Show>

                    <Show when={spec.capacityRequirementsDescription}>
                      <div class="merged-values-section">
                        <div class="merged-values-header">
                          <h3>Capacity Requirements</h3>
                        </div>
                        <div style="padding: 0.75rem 1rem; color: var(--linear-text-primary); line-height: 1.5; font-size: 0.9rem;">
                          {spec.capacityRequirementsDescription}
                        </div>
                      </div>
                    </Show>

                    {/* Licenses & Included Software side by side */}
                    <Show when={spec.licenses && spec.licenses.length > 0}>
                      <div class="merged-values-section">
                        <div class="merged-values-header">
                          <h3>Licenses</h3>
                        </div>
                        <div style="padding: 0.75rem 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
                          <For each={spec.licenses}>
                            {(license: string) => (
                              <span style="padding: 0.25rem 0.75rem; background: var(--linear-border); border-radius: 4px; color: var(--linear-text-primary); font-size: 0.85rem;">
                                {license}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={spec.includedSoftware && spec.includedSoftware.length > 0}>
                      <div class="merged-values-section">
                        <div class="merged-values-header">
                          <h3>Included Software</h3>
                        </div>
                        <div style="padding: 0.75rem 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;">
                          <For each={spec.includedSoftware}>
                            {(software: any) => (
                              <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                                <span style="font-weight: 600; color: var(--linear-text-primary); font-size: 0.9rem;">{software.displayName || 'Unknown'}</span>
                                <span style="color: var(--linear-text-secondary); font-family: monospace; font-size: 0.85rem;">
                                  v{software.version || 'N/A'}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    {/* Template - Fetch */}
                    <Show when={template.fetch && template.fetch.length > 0}>
                      <div class="merged-values-section" style="grid-column: 1 / -1;">
                        <div class="merged-values-header">
                          <h3>Fetch Configuration</h3>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 0.75rem; padding: 0.75rem 1rem;">
                        <For each={template.fetch}>
                          {(fetchConfig: any, index) => (
                            <div style="padding: 0.75rem; background: var(--linear-background-secondary, #f5f5f5); border-radius: 4px;">
                              <div style="font-weight: 600; color: var(--linear-text-primary); margin-bottom: 0.5rem; font-size: 0.9rem;">
                                Source #{index() + 1}
                              </div>
                              <Show when={fetchConfig.imgpkgBundle}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">imgpkg Bundle</span>
                                  </div>
                                  <div style="font-family: monospace; font-size: 0.9rem; color: var(--linear-text-primary); word-break: break-all;">
                                    {fetchConfig.imgpkgBundle.image}
                                  </div>
                                </div>
                              </Show>
                              <Show when={fetchConfig.git}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">Git</span>
                                  </div>
                                  <div class="info-grid">
                                    <div class="info-item">
                                      <span class="label">URL:</span>
                                      <span class="value" style="font-family: monospace; word-break: break-all;">
                                        {fetchConfig.git.url}
                                      </span>
                                    </div>
                                    <Show when={fetchConfig.git.ref}>
                                      <div class="info-item">
                                        <span class="label">Ref:</span>
                                        <span class="value" style="font-family: monospace;">
                                          {fetchConfig.git.ref}
                                        </span>
                                      </div>
                                    </Show>
                                    <Show when={fetchConfig.git.subPath}>
                                      <div class="info-item">
                                        <span class="label">Sub Path:</span>
                                        <span class="value" style="font-family: monospace;">
                                          {fetchConfig.git.subPath}
                                        </span>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                              <Show when={fetchConfig.http}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">HTTP</span>
                                  </div>
                                  <div style="font-family: monospace; font-size: 0.9rem; color: var(--linear-text-primary); word-break: break-all;">
                                    {fetchConfig.http.url}
                                  </div>
                                </div>
                              </Show>
                              <Show when={fetchConfig.helmChart}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">Helm Chart</span>
                                  </div>
                                  <div class="info-grid">
                                    <div class="info-item">
                                      <span class="label">Chart:</span>
                                      <span class="value" style="font-family: monospace;">
                                        {fetchConfig.helmChart.name}
                                      </span>
                                    </div>
                                    <div class="info-item">
                                      <span class="label">Version:</span>
                                      <span class="value" style="font-family: monospace;">
                                        {fetchConfig.helmChart.version}
                                      </span>
                                    </div>
                                    <Show when={fetchConfig.helmChart.repository?.url}>
                                      <div class="info-item full-width">
                                        <span class="label">Repository:</span>
                                        <span class="value" style="font-family: monospace; word-break: break-all;">
                                          {fetchConfig.helmChart.repository.url}
                                        </span>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                        </div>
                      </div>
                    </Show>

                    {/* Template - Template */}
                    <Show when={template.template && template.template.length > 0}>
                      <div class="merged-values-section" style="grid-column: 1 / -1;">
                        <div class="merged-values-header">
                          <h3>Template Configuration</h3>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 0.75rem; padding: 0.75rem 1rem;">
                        <For each={template.template}>
                          {(templateConfig: any, index) => (
                            <div style="padding: 0.75rem; background: var(--linear-background-secondary, #f5f5f5); border-radius: 4px;">
                              <div style="font-weight: 600; color: var(--linear-text-primary); margin-bottom: 0.5rem; font-size: 0.9rem;">
                                Template #{index() + 1}
                              </div>
                              <Show when={templateConfig.ytt}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">ytt</span>
                                  </div>
                                  <div class="info-grid">
                                    <Show when={templateConfig.ytt.paths}>
                                      <div class="info-item full-width">
                                        <span class="label">Paths:</span>
                                        <span class="value" style="font-family: monospace;">
                                          {templateConfig.ytt.paths.join(', ')}
                                        </span>
                                      </div>
                                    </Show>
                                    <Show when={templateConfig.ytt.ignoreUnknownComments !== undefined}>
                                      <div class="info-item">
                                        <span class="label">Ignore Unknown Comments:</span>
                                        <span class="value">{String(templateConfig.ytt.ignoreUnknownComments)}</span>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                              <Show when={templateConfig.kbld}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">kbld</span>
                                  </div>
                                  <Show when={templateConfig.kbld.paths}>
                                    <div class="info-item full-width">
                                      <span class="label">Paths:</span>
                                      <span class="value" style="font-family: monospace;">
                                        {templateConfig.kbld.paths.join(', ')}
                                      </span>
                                    </div>
                                  </Show>
                                </div>
                              </Show>
                              <Show when={templateConfig.helmTemplate}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">Helm Template</span>
                                  </div>
                                  <div class="info-grid">
                                    <Show when={templateConfig.helmTemplate.name}>
                                      <div class="info-item">
                                        <span class="label">Name:</span>
                                        <span class="value" style="font-family: monospace;">
                                          {templateConfig.helmTemplate.name}
                                        </span>
                                      </div>
                                    </Show>
                                    <Show when={templateConfig.helmTemplate.namespace}>
                                      <div class="info-item">
                                        <span class="label">Namespace:</span>
                                        <span class="value" style="font-family: monospace;">
                                          {templateConfig.helmTemplate.namespace}
                                        </span>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                        </div>
                      </div>
                    </Show>

                    {/* Template - Deploy */}
                    <Show when={template.deploy && template.deploy.length > 0}>
                      <div class="merged-values-section" style="grid-column: 1 / -1;">
                        <div class="merged-values-header">
                          <h3>Deploy Configuration</h3>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 0.75rem; padding: 0.75rem 1rem;">
                        <For each={template.deploy}>
                          {(deployConfig: any, index) => (
                            <div style="padding: 0.75rem; background: var(--linear-background-secondary, #f5f5f5); border-radius: 4px;">
                              <div style="font-weight: 600; color: var(--linear-text-primary); margin-bottom: 0.5rem; font-size: 0.9rem;">
                                Deploy #{index() + 1}
                              </div>
                              <Show when={deployConfig.kapp}>
                                <div>
                                  <div style="color: var(--linear-text-secondary); margin-bottom: 0.5rem;">
                                    Type: <span style="font-weight: 600;">kapp</span>
                                  </div>
                                  <div class="info-grid">
                                    <Show when={deployConfig.kapp.rawOptions && deployConfig.kapp.rawOptions.length > 0}>
                                      <div class="info-item full-width">
                                        <span class="label">Raw Options:</span>
                                        <div style="margin-top: 0.5rem;">
                                          <For each={deployConfig.kapp.rawOptions}>
                                            {(option: string) => (
                                              <div style="padding: 0.25rem 0; font-family: monospace; color: var(--linear-text-primary);">
                                                • {option}
                                              </div>
                                            )}
                                          </For>
                                        </div>
                                      </div>
                                    </Show>
                                    <Show when={deployConfig.kapp.intoNs}>
                                      <div class="info-item">
                                        <span class="label">Into Namespace:</span>
                                        <span class="value" style="font-family: monospace;">
                                          {deployConfig.kapp.intoNs}
                                        </span>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                        </div>
                      </div>
                    </Show>

                    {/* Values Schema */}
                    <Show when={spec.valuesSchema}>
                      <div class="merged-values-section" style="grid-column: 1 / -1;">
                        <div class="merged-values-header">
                          <h3>Values Schema</h3>
                        </div>
                        <div style="padding: 0.75rem 1rem;">
                          <OpenAPISchemaViewer schema={spec.valuesSchema} />
                        </div>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </Show>
          </div>
        </Show>

        {/* Values Tab - with overlay support */}
        <Show when={activeMainTab() === "values" && !!packageInstall()}>
          <CarvelValuesViewer
            namespace={packageInstall()!.metadata.namespace}
            name={packageInstall()!.metadata.name}
            kind="PackageInstall"
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
            initialSearch={packageInstall()?.metadata.name as string}
            autoDetectJson={false}
            defaultHideNonMatches={true}
            contentMaxHeightPx={250}
          />
        </Show>
      </div>
    </div>
  );
}
