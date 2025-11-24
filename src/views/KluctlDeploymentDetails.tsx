// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, Show, createMemo, For } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { watchResource } from "../watches.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { stringify as stringifyYAML } from "@std/yaml";
import * as graphlib from "graphlib";
import { ResourceTree, createNodeWithCardRenderer } from "../components/ResourceTree.tsx";
import { getDeploymentMatchingPods } from "../utils/k8s.ts";
import type { DiffHunk, FileDiffSection } from "../utils/diffUtils.ts";
import { generateDiffHunks } from "../utils/diffUtils.ts";

type KluctlDeploymentResult = any;

type DeploymentIssue = {
  message?: string;
};

type KluctlCommandInfo = {
  startTime?: string;
  endTime?: string;
  command?: string;
};

type KluctlSummary = {
  id?: string;
  commandInfo?: KluctlCommandInfo;
  renderedObjects?: number;
  appliedObjects?: number;
  changedObjects?: number;
  newObjects?: number;
  deletedObjects?: number;
  orphanObjects?: number;
  errors?: number | DeploymentIssue[];
  warnings?: number | DeploymentIssue[];
  totalChanges?: number;
  // Decoded JSON payloads attached per result by the server
  reducedResult?: string;
  compactedObjects?: string;
};

type KluctlRenderedObject = {
  // Full object shape (when available)
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    [key: string]: unknown;
  };
  // ObjectRef shape coming from renderedObjects
  group?: string;
  version?: string;
  name?: string;
  namespace?: string;
  [key: string]: unknown;
};

type KluctlReducedDeployment = {
  path?: string;
  renderedObjects?: KluctlRenderedObject[];
};

type KluctlReducedResult = {
  deployment?: {
    deployments?: KluctlReducedDeployment[];
  };
};

const getRenderedObjectsFromLatestResult = (d: KluctlDeploymentResult | null): KluctlRenderedObject[] => {
  const txt = (d?.status?.latestReducedResult as string | undefined) || "";
  if (!txt) return [];
  try {
    const parsed = JSON.parse(txt) as KluctlReducedResult;
    const deployments = parsed.deployment?.deployments;
    if (!Array.isArray(deployments)) return [];
    const out: KluctlRenderedObject[] = [];
    deployments.forEach((entry) => {
      if (Array.isArray(entry.renderedObjects)) {
        entry.renderedObjects.forEach((obj) => {
          out.push(obj);
        });
      }
    });
    return out;
  } catch {
    return [];
  }
};

const buildKluctlResourceGraph = (
  d: KluctlDeploymentResult | null,
  deploymentsList: any[],
  podsList: any[],
): graphlib.Graph => {
  const g = new graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: 100,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  if (!d) return g;

  const namespace = d.metadata?.namespace ?? "";
  const name = d.metadata?.name ?? "deployment";
  const rootDisplayName = namespace ? `${namespace}/${name}` : name;

  const rootResource: KluctlRenderedObject = {
    apiVersion: "kluctl.io/v1",
    kind: "DeploymentResult",
    metadata: {
      name: rootDisplayName,
      namespace,
    },
  };

  const rootId = createNodeWithCardRenderer(
    g,
    "kluctl-root",
    rootResource,
    "kluctl.io/DeploymentResult",
    {
      fill: "#f3f4f4",
      stroke: "#dee2e6",
      strokeWidth: "1",
    },
  );

  const renderedRefs = getRenderedObjectsFromLatestResult(d);
  if (renderedRefs.length === 0) {
    return g;
  }

  const deploymentMap = new Map<string, any>();
  deploymentsList.forEach((dep) => {
    const depName = dep?.metadata?.name;
    if (!depName) return;
    const depNs = dep?.metadata?.namespace || "";
    deploymentMap.set(`${depNs}/${depName}`, dep);
  });

  const podMap = new Map<string, any>();
  podsList.forEach((pod) => {
    const podName = pod?.metadata?.name;
    if (!podName) return;
    const podNs = pod?.metadata?.namespace || "";
    podMap.set(`${podNs}/${podName}`, pod);
  });

  const addedKeys = new Set<string>();

  renderedRefs.forEach((ref, idx) => {
    const kind = ref.kind;
    const refName = ref.metadata?.name || ref.name;
    const refNs = ref.metadata?.namespace || ref.namespace || namespace;
    if (!kind || !refName) return;

    const refApiVersion =
      ref.apiVersion ||
      (ref.group ? `${ref.group}/${ref.version || "v1"}` : "v1");

    if (kind === "Deployment") {
      const key = `${refNs}/${refName}`;
      const depObj = deploymentMap.get(key);

      const resource =
        depObj ??
        ({
          apiVersion: refApiVersion || "apps/v1",
          kind: "Deployment",
          metadata: { name: refName, namespace: refNs },
        } as any);

      const nodeKey = `Deployment:${key}`;
      if (addedKeys.has(nodeKey)) return;
      addedKeys.add(nodeKey);

      const depNodeId = createNodeWithCardRenderer(
        g,
        `dep-${refName}-${idx}`,
        resource,
        "apps/Deployment",
        {
          fill: "#e6f4ea",
          stroke: "#137333",
          strokeWidth: "1",
        },
      );
      g.setEdge(rootId, depNodeId);

      if (depObj) {
        const podsForDep = getDeploymentMatchingPods(depObj, podsList);
        podsForDep.forEach((p: any, pi: number) => {
          const podName = p?.metadata?.name;
          if (!podName) return;
          const podNs = p?.metadata?.namespace || "";
          const podKey = `${podNs}/${podName}`;
          const podNodeKey = `Pod:${podKey}`;
          if (addedKeys.has(podNodeKey)) return;
          addedKeys.add(podNodeKey);

          const podNodeId = createNodeWithCardRenderer(
            g,
            `pod-${podName}-${pi}`,
            p,
            "core/Pod",
            {
              fill: "#f0f4ff",
              stroke: "#335eea",
              strokeWidth: "1",
            },
          );
          g.setEdge(depNodeId, podNodeId);
        });
      }

      return;
    }

    if (kind === "Pod") {
      const key = `${refNs}/${refName}`;
      const podObj = podMap.get(key);
      const resource =
        podObj ??
        ({
          apiVersion: refApiVersion || "v1",
          kind: "Pod",
          metadata: { name: refName, namespace: refNs },
        } as any);

      const nodeKey = `Pod:${key}`;
      if (addedKeys.has(nodeKey)) return;
      addedKeys.add(nodeKey);

      const podNodeId = createNodeWithCardRenderer(
        g,
        `pod-${refName}-${idx}`,
        resource,
        "core/Pod",
        {
          fill: "#f0f4ff",
          stroke: "#335eea",
          strokeWidth: "1",
        },
      );
      g.setEdge(rootId, podNodeId);
      return;
    }

    const apiVersion = refApiVersion;
    const resourceType =
      apiVersion === "v1"
        ? `core/${kind}`
        : `${apiVersion.split("/")[0]}/${kind}`;

    const stubResource: KluctlRenderedObject = {
      apiVersion,
      kind,
      metadata: {
        name: refName,
        namespace: refNs,
      },
    };

    const nodeKey = `${resourceType}:${refNs}/${refName}`;
    if (addedKeys.has(nodeKey)) return;
    addedKeys.add(nodeKey);

    const nodeId = createNodeWithCardRenderer(
      g,
      `obj-${idx}-${kind}-${refName}`,
      stubResource,
      resourceType,
      {
        fill: "#e6f4ea",
        stroke: "#137333",
        strokeWidth: "1",
      },
    );
    g.setEdge(rootId, nodeId);
  });

  return g;
};

const countIssues = (value: KluctlSummary["errors"] | KluctlSummary["warnings"]): number => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value;
  return 0;
};

const getIssueMessages = (value: KluctlSummary["errors"] | KluctlSummary["warnings"]): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => {
      if (!it) return "";
      const msg = (it as DeploymentIssue).message;
      if (typeof msg === "string" && msg.trim().length > 0) return msg.trim();
      try {
        return JSON.stringify(it);
      } catch {
        return "";
      }
    })
    .filter((m) => m.length > 0);
};

export function KluctlDeploymentDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const filterStore = useFilterStore();

  const [deployment, setDeployment] = createSignal<KluctlDeploymentResult | null>(null);
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  const [clusterDeployments, setClusterDeployments] = createSignal<any[]>([]);
  const [clusterPods, setClusterPods] = createSignal<any[]>([]);
  const [inventoryWatchesStarted, setInventoryWatchesStarted] = createSignal(false);

  const [activeTab, setActiveTab] = createSignal<"resources" | "history">("resources");
  const [selectedSummaryIndex, setSelectedSummaryIndex] = createSignal<number>(-1);

  // Deploy history diff state (between compactedObjects manifests of adjacent results)
  const [expandedDiffs, setExpandedDiffs] = createSignal<{ [key: string]: boolean }>({});
  const [diffSections, setDiffSections] = createSignal<{ [key: string]: { fileSections: FileDiffSection[] } }>({});

  const graph = createMemo(() =>
    buildKluctlResourceGraph(deployment(), clusterDeployments(), clusterPods()),
  );

  createEffect(() => {
    console.log(deployment());
  });

  createEffect(() => {
    if (params.name && filterStore.k8sResources.length > 0) {
      // Allow empty namespace for cluster-wide pseudo deployments
      setupWatches(params.namespace || "", params.name);
    }
  });

  createEffect(() => {
    const dep = deployment();
    if (!dep) return;
    if (inventoryWatchesStarted()) return;
    if (filterStore.k8sResources.length === 0) return;
    setupInventoryWatches(dep);
    setInventoryWatchesStarted(true);
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });
    setInventoryWatchesStarted(false);
  });

  const setupWatches = (ns: string, name: string) => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setDeployment(null);

    const controllers: AbortController[] = [];

    const kluctlRes = filterStore.k8sResources.find(res => res.id === "kluctl.io/Deployment");
    if (kluctlRes) {
      const controller = new AbortController();
      let path = `${kluctlRes.apiPath}/${kluctlRes.name}?watch=true`;
      if (kluctlRes.namespaced && ns && ns !== "all-namespaces") {
        path = `${kluctlRes.apiPath}/namespaces/${ns}/${kluctlRes.name}?watch=true`;
      }
      watchResource(
        path,
        (event: { type: string; object: KluctlDeploymentResult }) => {
          if ((event.type === "ADDED" || event.type === "MODIFIED") &&
              event.object?.metadata?.name === name &&
              (ns === "" || event.object?.metadata?.namespace === ns)) {
            setDeployment(event.object);
            console.log("deployment set", event.object);
          }
        },
        controller,
        () => {},
        undefined,
        apiResourceStore.contextInfo?.current
      );
      controllers.push(controller);
    }

    setWatchControllers(controllers);
  };

  const updateListFromEvent = (list: any[], event: { type: string; object: any }): any[] => {
    const obj = event.object;
    const objName = obj?.metadata?.name;
    if (!objName) return list;
    const objNs = obj?.metadata?.namespace || "";
    const key = `${objNs}/${objName}`;
    const next = [...list];
    const idx = next.findIndex(
      (it) =>
        (it?.metadata?.namespace || "") === objNs &&
        (it?.metadata?.name || "") === objName,
    );
    if (event.type === "DELETED") {
      if (idx >= 0) {
        next.splice(idx, 1);
      }
    } else {
      if (idx >= 0) {
        next[idx] = obj;
      } else {
        next.push(obj);
      }
    }
    return next;
  };

  const setupInventoryWatches = (dep: KluctlDeploymentResult) => {
    const rendered = getRenderedObjectsFromLatestResult(dep);
    if (rendered.length === 0) return;

    const nsSet = new Set<string>();
    rendered.forEach((ref) => {
      const refNs = ref.metadata?.namespace || ref.namespace || dep.metadata?.namespace || "";
      nsSet.add(refNs);
    });

    const deploymentRes = filterStore.k8sResources.find((r) => r.id === "apps/Deployment");
    const podRes = filterStore.k8sResources.find((r) => r.id === "core/Pod");

    const controllers: AbortController[] = [];

    nsSet.forEach((ns) => {
      if (deploymentRes) {
        const controller = new AbortController();
        let path = `${deploymentRes.apiPath}/${deploymentRes.name}?watch=true`;
        if (deploymentRes.namespaced && ns && ns !== "all-namespaces") {
          path = `${deploymentRes.apiPath}/namespaces/${ns}/${deploymentRes.name}?watch=true`;
        }
        watchResource(
          path,
          (event: { type: string; object: any }) => {
            if (event.type === "ERROR" || !event.object) return;
            setClusterDeployments((prev) => updateListFromEvent(prev, event));
          },
          controller,
          () => {},
          undefined,
          apiResourceStore.contextInfo?.current,
        );
        controllers.push(controller);
      }

      if (podRes) {
        const controller = new AbortController();
        let path = `${podRes.apiPath}/${podRes.name}?watch=true`;
        if (podRes.namespaced && ns && ns !== "all-namespaces") {
          path = `${podRes.apiPath}/namespaces/${ns}/${podRes.name}?watch=true`;
        }
        watchResource(
          path,
          (event: { type: string; object: any }) => {
            if (event.type === "ERROR" || !event.object) return;
            setClusterPods((prev) => updateListFromEvent(prev, event));
          },
          controller,
          () => {},
          undefined,
          apiResourceStore.contextInfo?.current,
        );
        controllers.push(controller);
      }
    });

    if (controllers.length > 0) {
      setWatchControllers((prev) => [...prev, ...controllers]);
    }
  };

  const handleBackClick = () => {
    navigate("/");
  };

  const getSummaries = (d: KluctlDeploymentResult | null): KluctlSummary[] => {
    const raw = d?.status?.commandSummaries;
    if (!Array.isArray(raw)) return [];
    return raw as KluctlSummary[];
  };

  const getLatestSummary = (d: KluctlDeploymentResult | null): KluctlSummary | undefined => {
    const list = getSummaries(d);
    if (list.length === 0) return undefined;
    return list[0];
  };

  const getRecentSummaries = (d: KluctlDeploymentResult | null, limit = 5): KluctlSummary[] => {
    const list = getSummaries(d);
    if (list.length === 0) return [];
    return [...list]
      .sort((a, b) => {
        const sa = new Date(a.commandInfo?.startTime || "").getTime();
        const sb = new Date(b.commandInfo?.startTime || "").getTime();
        return sb - sa;
      })
      .slice(0, limit);
  };

  const formatSummaryStatus = (s: KluctlSummary | undefined) => {
    if (!s) return "No changes";

    const errorMessages = getIssueMessages(s.errors);
    const warningMessages = getIssueMessages(s.warnings);

    const parts: any[] = [];

    const addPart = (node: any) => {
      if (parts.length > 0) {
        parts.push(" | ");
      }
      parts.push(node);
    };

    const rendered = typeof s.renderedObjects === "number" ? s.renderedObjects : 0;
    if (rendered) addPart(`${rendered} rendered`);

    const applied = typeof s.appliedObjects === "number" ? s.appliedObjects : 0;
    if (applied) addPart(`${applied} applied`);

    const changed = typeof s.changedObjects === "number" ? s.changedObjects : 0;
    const deleted = typeof s.deletedObjects === "number" ? s.deletedObjects : 0;
    const newly = typeof s.newObjects === "number" ? s.newObjects : 0;

    let changedNames: string[] = [];
    let newNames: string[] = [];
    let deletedNames: string[] = [];
    if (s.compactedObjects) {
      const entries = parseCompactedEntries(s.compactedObjects);
      if (entries.length > 0) {
        changedNames = entries.filter((e) => e.changed).map((e) => e.displayName);
        newNames = entries.filter((e) => e.newObject).map((e) => e.displayName);
        deletedNames = entries.filter((e) => e.deletedObject).map((e) => e.displayName);
      }
    }

    const formatNamesWithLimit = (names: string[]): string | undefined => {
      if (!names.length) return undefined;
      const maxToShow = 10;
      const shown = names.slice(0, maxToShow);
      const remaining = names.length - shown.length;
      if (remaining > 0) {
        return `${shown.join(", ")} (+${remaining} more)`;
      }
      return shown.join(", ");
    };

    if (changed) {
      const changedLabel = formatNamesWithLimit(changedNames);
      addPart(
        <span class="status-badge kluctl-status-badge kluctl-changed">
          {changed} changed
          {changedLabel ? ` (${changedLabel})` : ""}
        </span>,
      );
    }

    if (deleted) {
      const deletedLabel = formatNamesWithLimit(deletedNames);
      addPart(
        <span class="status-badge kluctl-status-badge kluctl-deleted">
          {deleted} deleted
          {deletedLabel ? ` (${deletedLabel})` : ""}
        </span>,
      );
    }

    if (newly) {
      const newLabel = formatNamesWithLimit(newNames);
      addPart(
        <span class="status-badge kluctl-status-badge kluctl-new">
          {newly} new
          {newLabel ? ` (${newLabel})` : ""}
        </span>,
      );
    }

    const orphan = typeof s.orphanObjects === "number" ? s.orphanObjects : 0;
    if (orphan) addPart(`${orphan} orphan`);

    const errorCount = countIssues(s.errors);
    if (errorCount) {
      const tooltip = errorMessages.length ? errorMessages.join(" | ") : "";
      const errorLabel = formatNamesWithLimit(errorMessages);
      addPart(
        <span class="status-badge kluctl-status-badge kluctl-errors" title={tooltip || undefined}>
          {errorCount} errors
          {errorLabel ? ` (${errorLabel})` : ""}
        </span>,
      );
    }

    const warningCount = countIssues(s.warnings);
    if (warningCount) {
      const tooltip = warningMessages.length ? warningMessages.join(" | ") : "";
      const warningLabel = formatNamesWithLimit(warningMessages);
      addPart(
        <span class="status-badge kluctl-status-badge kluctl-warnings" title={tooltip || undefined}>
          {warningCount} warnings
          {warningLabel ? ` (${warningLabel})` : ""}
        </span>,
      );
    }

    if (parts.length === 0) return "No changes";

    return <>{parts}</>;
  };

  const formatStatusLine = (s: KluctlSummary | undefined) => {
    if (!s) return "No deploy history available";
    return formatSummaryStatus(s);
  };

  // Initialize selected summary index (for row highlight) similarly to Helm history
  createEffect(() => {
    const dep = deployment();
    if (!dep) return;
    const list = getSummaries(dep);
    if (selectedSummaryIndex() === -1 && list.length > 0) {
      setSelectedSummaryIndex(0);
    }
  });

  const buildPairKey = (newer: KluctlSummary, older: KluctlSummary): string => {
    const a = newer.id || "";
    const b = older.id || "";
    return `${a}-${b}`;
  };

  type CompactedEntry = {
    key: string;
    displayName: string;
    rendered?: string;
    applied?: string;
    newObject?: boolean;
    changed?: boolean;
    deletedObject?: boolean;
  };

  const parseCompactedEntries = (raw?: string): CompactedEntry[] => {
    if (!raw || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      let list: any[] = [];
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && Array.isArray((parsed as any).compactedObjects)) {
        list = (parsed as any).compactedObjects;
      } else if (parsed && Array.isArray((parsed as any).objects)) {
        list = (parsed as any).objects;
      }
      const out: CompactedEntry[] = [];
      list.forEach((item) => {
        if (!item) return;
        const ref = item.ref || {};
        const group = typeof ref.group === "string" ? ref.group : "";
        const kind = typeof ref.kind === "string" ? ref.kind : "";
        const name = typeof ref.name === "string" ? ref.name : "";
        const namespace = typeof ref.namespace === "string" ? ref.namespace : "";
        if (!kind || !name) return;
        const groupPart = group || "core";
        const resourceType = `${groupPart}/${kind}`;
        const displayName = namespace ? `${resourceType}/${namespace}/${name}` : `${resourceType}/${name}`;
        const key = `${resourceType}::${namespace}/${name}`;
        const newObject = item.new === true;
        const changed = Array.isArray(item.changes) && item.changes.length > 0;
        const deletedObject = item.deleted === true;
        out.push({
          key,
          displayName,
          rendered: typeof item.rendered === "string" ? item.rendered : undefined,
          applied: typeof item.applied === "string" ? item.applied : undefined,
          newObject,
          changed,
          deletedObject,
        });
      });
      return out;
    } catch {
      return [];
    }
  };

  const prettyPrintJsonOrText = (txt: string): string => {
    const trimmed = txt.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      return stringifyYAML(parsed) as string;
    } catch {
      return txt;
    }
  };

  const extractContent = (entry: CompactedEntry | undefined): string => {
    if (!entry) return "";
    const raw = entry.rendered;
    if (!raw) return "";
    if (raw.startsWith("full: ")) {
      return prettyPrintJsonOrText(raw.slice(6));
    }
    if (raw.startsWith("delta: ")) {
      // Delta-encoded payload; without diff-match-patch we can't reconstruct the full JSON,
      // so expose the raw delta string.
      return raw;
    }
    return prettyPrintJsonOrText(raw);
  };

  const ensureDiffSections = (pairKey: string, newer: KluctlSummary, older: KluctlSummary): string => {
    const key = `${pairKey}-rendered`;
    if (diffSections()[key]) return key;

    const newerEntries = parseCompactedEntries(newer.compactedObjects);
    const olderEntries = parseCompactedEntries(older.compactedObjects);

    const newerMap = new Map<string, CompactedEntry>();
    newerEntries.forEach((e) => newerMap.set(e.key, e));
    const olderMap = new Map<string, CompactedEntry>();
    olderEntries.forEach((e) => olderMap.set(e.key, e));

    const allKeys = new Set<string>();
    newerMap.forEach((_v, k) => allKeys.add(k));
    olderMap.forEach((_v, k) => allKeys.add(k));

    const fileSections: FileDiffSection[] = [];

    allKeys.forEach((k) => {
      const newerEntry = newerMap.get(k);
      const olderEntry = olderMap.get(k);

      const fromText = extractContent(olderEntry);
      const toText = extractContent(newerEntry);

      const fromLines = fromText.split("\n");
      const toLines = toText.split("\n");
      const hunks = generateDiffHunks(fromLines, toLines);
      const addedLines = hunks.reduce((s, h) => s + h.changes.filter((c) => c.type === "add").length, 0);
      const removedLines = hunks.reduce((s, h) => s + h.changes.filter((c) => c.type === "remove").length, 0);

      let status: "created" | "modified" | "deleted";
      if (!olderEntry && newerEntry) status = "created";
      else if (olderEntry && !newerEntry) status = "deleted";
      else status = "modified";

      const isExpanded = addedLines > 0 || removedLines > 0;
      fileSections.push({
        fileName: (newerEntry || olderEntry)?.displayName || k,
        status,
        hunks,
        isExpanded,
        addedLines,
        removedLines,
        originalLines: fromLines,
        newLines: toLines,
      });
    });

    setDiffSections((prev) => ({ ...prev, [key]: { fileSections } }));
    return key;
  };

  const toggleHistoryDiff = (newer: KluctlSummary, older: KluctlSummary) => {
    const pairKey = buildPairKey(newer, older);
    const isExpanded = expandedDiffs()[pairKey] || false;
    const next = { ...expandedDiffs() };

    if (!isExpanded) {
      next[pairKey] = true;
    } else {
      delete next[pairKey];
    }

    setExpandedDiffs(next);

    if (next[pairKey]) {
      ensureDiffSections(pairKey, newer, older);
    }
  };

  const toggleFileSection = (diffKey: string, fileIndex: number) => {
    setDiffSections((prev) => {
      const updated = { ...prev };
      const section = { ...updated[diffKey] };
      const fileSections = [...section.fileSections];
      const fileSection = { ...fileSections[fileIndex] };
      fileSection.isExpanded = !fileSection.isExpanded;
      fileSections[fileIndex] = fileSection;
      section.fileSections = fileSections;
      updated[diffKey] = section;
      return updated;
    });
  };

  const expandContext = (diffKey: string, fileIndex: number, hunkIndex: number, direction: "before" | "after") => {
    setDiffSections((prev) => {
      const updated = { ...prev };
      const section = { ...updated[diffKey] };
      const fileSections = [...section.fileSections];
      const fileSection = { ...fileSections[fileIndex] };
      const hunks = [...fileSection.hunks];
      if (direction === "before" && hunks[hunkIndex].canExpandBefore) {
        const hunk = { ...hunks[hunkIndex] };
        const newStart = Math.max(0, hunk.visibleStartOld - 10);
        const newStartNew = Math.max(0, hunk.visibleStartNew - 10);
        if (hunkIndex > 0) {
          const prevHunk = hunks[hunkIndex - 1];
          if (newStart <= prevHunk.visibleEndOld) {
            const mergedHunk: DiffHunk = {
              startOldLine: prevHunk.startOldLine,
              startNewLine: prevHunk.startNewLine,
              changes: [...prevHunk.changes],
              visibleStartOld: prevHunk.visibleStartOld,
              visibleStartNew: prevHunk.visibleStartNew,
              visibleEndOld: hunk.visibleEndOld,
              visibleEndNew: hunk.visibleEndNew,
              canExpandBefore: prevHunk.canExpandBefore,
              canExpandAfter: hunk.canExpandAfter,
            };
            for (let i = prevHunk.visibleEndOld; i < hunk.visibleStartOld; i++) {
              if (i >= 0 && i < fileSection.originalLines.length) {
                const newLineNum = prevHunk.visibleEndNew + (i - prevHunk.visibleEndOld);
                mergedHunk.changes.push({
                  type: "match",
                  value: fileSection.originalLines[i],
                  oldLineNumber: i + 1,
                  newLineNumber: newLineNum + 1,
                });
              }
            }
            mergedHunk.changes.push(...hunk.changes);
            hunks.splice(hunkIndex - 1, 2, mergedHunk);
          } else {
            hunk.visibleStartOld = newStart;
            hunk.visibleStartNew = newStartNew;
            hunk.canExpandBefore = newStart > 0;
            hunks[hunkIndex] = hunk;
          }
        } else {
          hunk.visibleStartOld = newStart;
          hunk.visibleStartNew = newStartNew;
          hunk.canExpandBefore = newStart > 0;
          hunks[hunkIndex] = hunk;
        }
      } else if (direction === "after" && hunks[hunkIndex].canExpandAfter) {
        const hunk = { ...hunks[hunkIndex] };
        const newEnd = Math.min(fileSection.originalLines.length, hunk.visibleEndOld + 10);
        const newEndNew = Math.min(fileSection.newLines.length, hunk.visibleEndNew + 10);
        if (hunkIndex < hunks.length - 1) {
          const nextHunk = hunks[hunkIndex + 1];
          if (newEnd >= nextHunk.visibleStartOld) {
            const mergedHunk: DiffHunk = {
              startOldLine: hunk.startOldLine,
              startNewLine: hunk.startNewLine,
              changes: [...hunk.changes],
              visibleStartOld: hunk.visibleStartOld,
              visibleStartNew: hunk.visibleStartNew,
              visibleEndOld: nextHunk.visibleEndOld,
              visibleEndNew: nextHunk.visibleEndNew,
              canExpandBefore: hunk.canExpandBefore,
              canExpandAfter: nextHunk.canExpandAfter,
            };
            for (let i = hunk.visibleEndOld; i < nextHunk.visibleStartOld; i++) {
              if (i >= 0 && i < fileSection.originalLines.length) {
                const newLineNum = hunk.visibleEndNew + (i - hunk.visibleEndOld);
                mergedHunk.changes.push({
                  type: "match",
                  value: fileSection.originalLines[i],
                  oldLineNumber: i + 1,
                  newLineNumber: newLineNum + 1,
                });
              }
            }
            mergedHunk.changes.push(...nextHunk.changes);
            hunks.splice(hunkIndex, 2, mergedHunk);
          } else {
            hunk.visibleEndOld = newEnd;
            hunk.visibleEndNew = newEndNew;
            hunk.canExpandAfter = newEnd < fileSection.originalLines.length;
            hunks[hunkIndex] = hunk;
          }
        } else {
          hunk.visibleEndOld = newEnd;
          hunk.visibleEndNew = newEndNew;
          hunk.canExpandAfter = newEnd < fileSection.originalLines.length;
          hunks[hunkIndex] = hunk;
        }
      }
      fileSection.hunks = hunks;
      fileSections[fileIndex] = fileSection;
      section.fileSections = fileSections;
      updated[diffKey] = section;
      return updated;
    });
  };

  const renderHunk = (hunk: DiffHunk, diffKey: string, fileIndex: number, hunkIndex: number, fileSection: FileDiffSection) => {
    const lines: any[] = [];
    if (hunk.canExpandBefore) {
      lines.push(
        <div class="diff-expand-line">
          <button class="diff-expand-button" onClick={() => expandContext(diffKey, fileIndex, hunkIndex, "before")}>
            ⋯ 10 more lines
          </button>
        </div>,
      );
    }
    for (let i = hunk.visibleStartOld; i < hunk.startOldLine; i++) {
      if (i >= 0 && i < fileSection.originalLines.length) {
        const newLineNum = hunk.visibleStartNew + (i - hunk.visibleStartOld);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{newLineNum + 1}</span>
            <span class="line-content"> {fileSection.originalLines[i]}</span>
          </div>,
        );
      }
    }
    let oldLineNum = hunk.startOldLine + 1;
    let newLineNum = hunk.startNewLine + 1;
    hunk.changes.forEach((change) => {
      let className = "";
      let lineContent = "";
      let oldNum = "";
      let newNum = "";
      if (change.type === "add") {
        className = "diff-line-added";
        lineContent = `+${change.value}`;
        newNum = String(newLineNum++);
      } else if (change.type === "remove") {
        className = "diff-line-removed";
        lineContent = `-${change.value}`;
        oldNum = String(oldLineNum++);
      } else {
        className = "diff-line-context";
        lineContent = ` ${change.value}`;
        oldNum = String(oldLineNum++);
        newNum = String(newLineNum++);
      }
      lines.push(
        <div class={className}>
          <span class="line-number old">{oldNum}</span>
          <span class="line-number new">{newNum}</span>
          <span class="line-content">{lineContent}</span>
        </div>,
      );
    });
    const originalHunkEnd = hunk.startOldLine + hunk.changes.filter((c) => c.type !== "add").length;
    const originalHunkEndNew = hunk.startNewLine + hunk.changes.filter((c) => c.type !== "remove").length;
    for (let i = originalHunkEnd; i < hunk.visibleEndOld; i++) {
      if (i >= 0 && i < fileSection.originalLines.length) {
        const n = originalHunkEndNew + (i - originalHunkEnd);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{n + 1}</span>
            <span class="line-content"> {fileSection.originalLines[i]}</span>
          </div>,
        );
      }
    }
    if (hunk.canExpandAfter) {
      lines.push(
        <div class="diff-expand-line">
          <button class="diff-expand-button" onClick={() => expandContext(diffKey, fileIndex, hunkIndex, "after")}>
            ⋯ 10 more lines
          </button>
        </div>,
      );
    }
    return lines;
  };

  return (
    <div class="kustomization-details">
      <Show when={deployment()} fallback={<div class="loading">Loading...</div>}>
        {(d) => {
          const dep = d();
          const latest = getLatestSummary(dep);
          const summaries = getSummaries(dep);
          const sortedSummaries = [...summaries].sort((a, b) => {
            const sa = new Date(a.commandInfo?.startTime || "").getTime();
            const sb = new Date(b.commandInfo?.startTime || "").getTime();
            return sb - sa;
          });
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{dep.metadata.namespace}/{dep.metadata.name}</h1>
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Project:</span>
                      <span class="value">
                        {(() => {
                          const proj = dep.spec?.project as
                            | { repoKey?: string | { url?: string }; subDir?: string }
                            | undefined;
                          if (!proj) return "-";
                          const repoKey = proj.repoKey;
                          const repoPart =
                            typeof repoKey === "string"
                              ? repoKey
                              : repoKey?.url || "-";
                          const subDir = proj.subDir || "-";
                          return `${repoPart}/${subDir}`;
                        })()}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="label">Target:</span>
                      <span class="value">
                        {dep.spec?.target?.targetName || dep.spec?.target?.name || "-"}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="label">Last Command:</span>
                      <span class="value">
                        {latest?.commandInfo?.command || "None"} {latest?.commandInfo?.startTime ? useCalculateAge(latest.commandInfo.startTime)() : "-"} ago
                        </span>
                    </div>
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 2;">
                      <span class="label">Status:</span>
                      <span class="value">
                        {formatStatusLine(latest)}
                      </span>
                    </div>
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 2 / 5;">
                      <div>
                        <ul>
                          {getRecentSummaries(dep).map((s) => (
                            <li class="value">
                              <span title={s.commandInfo?.startTime}>
                                {s.commandInfo?.startTime
                                  ? useCalculateAge(s.commandInfo.startTime)()
                                  : "-"}
                              </span>{" "}
                              <strong>{s.commandInfo?.command}: </strong>{" "}
                              {formatSummaryStatus(s)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div class="info-item full-width">
                      <details>
                        <summary class="label">Raw Status</summary>
                        <pre class="conditions-yaml">
                          {dep.status ? stringifyYAML(dep.status) : "No status available"}
                        </pre>
                      </details>
                      <details>
                        <summary class="label">Latest reducedResult JSON</summary>
                        <pre class="conditions-yaml">
                          {(() => {
                            const txt =
                              (dep.status?.latestReducedResult as string | undefined) || "";
                            if (!txt) return "No reducedResult payload available";
                            try {
                              const parsed = JSON.parse(txt);
                              return JSON.stringify(parsed, null, 2);
                            } catch {
                              return txt;
                            }
                          })()}
                        </pre>
                      </details>
                      <details>
                        <summary class="label">Latest compactedObjects JSON</summary>
                        <pre class="conditions-yaml">
                          {(() => {
                            const txt =
                              (dep.status?.latestCompactedObjects as string | undefined) || "";
                            if (!txt) return "No compactedObjects payload available";
                            try {
                              const parsed = JSON.parse(txt);
                              return JSON.stringify(parsed, null, 2);
                            } catch {
                              return txt;
                            }
                          })()}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>

              <div style="padding: 0rem 1rem 1rem 1rem">
                <Tabs
                  tabs={[
                    { key: "resources", label: "Resource Tree" },
                    { key: "history", label: "Deploy History" },
                  ]}
                  activeKey={activeTab()}
                  onChange={(k) => setActiveTab(k as "resources" | "history")}
                  style={{ "margin-top": "12px" }}
                />

                <Show when={activeTab() === "resources"}>
                  <div class="resource-tree-wrapper">
                    <ResourceTree
                      g={graph}
                      resourceTypeVisibilityDropdown={<div></div>}
                    />
                  </div>
                </Show>

                <Show when={activeTab() === "history"}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        {sortedSummaries.length === 0 ? (
                          <div class="message-cell">No deploy history available.</div>
                        ) : (
                          <>
                            <table class="helm-history-table">
                              <thead>
                                <tr>
                                  <th>Command</th>
                                  <th>Started</th>
                                  <th>Summary</th>
                                </tr>
                              </thead>
                              <tbody>
                                <For each={sortedSummaries}>
                                  {(s, index) => (
                                    <>
                                      <tr
                                        class={selectedSummaryIndex() === index() ? "selected-revision" : ""}
                                        onClick={() => setSelectedSummaryIndex(index())}
                                      >
                                        <td>{s.commandInfo?.command || "-"}</td>
                                        <td title={s.commandInfo?.startTime}>
                                          {s.commandInfo?.startTime
                                            ? useCalculateAge(s.commandInfo.startTime)()
                                            : "-"}
                                        </td>
                                        <td>{formatSummaryStatus(s)}</td>
                                      </tr>
                                      {index() < sortedSummaries.length - 1 &&
                                        (() => {
                                          const newer = s;
                                          const older = sortedSummaries[index() + 1];
                                          const pairKey = buildPairKey(newer, older);
                                          const expanded = expandedDiffs()[pairKey] || false;
                                          const sectionKey = `${pairKey}-rendered`;
                                          const section = diffSections()[sectionKey];
                                          return (
                                            <>
                                              <tr class="diff-divider-row">
                                                <td colSpan={3} class="diff-divider-cell">
                                                  <div class="diff-button-container">
                                                    <div class="diff-button-group">
                                                      <button
                                                        class={`diff-button ${expanded ? "active" : ""}`}
                                                        onClick={() => toggleHistoryDiff(newer, older)}
                                                        title={
                                                          expanded
                                                            ? `Hide rendered diff between ${newer.commandInfo?.command} and ${older.commandInfo?.command}`
                                                            : `Show rendered diff between ${newer.commandInfo?.command} and ${older.commandInfo?.command}`
                                                        }
                                                      >
                                                        Rendered Yaml Diff
                                                      </button>
                                                    </div>
                                                  </div>
                                                </td>
                                              </tr>
                                              {expanded && (
                                                <tr class="diff-content-row">
                                                  <td colSpan={3} class="diff-content-cell">
                                                    {section ? (
                                                      <div class="diff-content">
                                                        <For each={section.fileSections}>
                                                          {(fileSection, fileIndex) => (
                                                            <div class="diff-file-section">
                                                              <div
                                                                class="diff-file-header"
                                                                onClick={() =>
                                                                  toggleFileSection(sectionKey, fileIndex())
                                                                }
                                                              >
                                                                <div class="diff-file-info">
                                                                  <div class="diff-file-toggle">
                                                                    {fileSection.isExpanded ? "▼" : "►"}
                                                                  </div>
                                                                  <span class="diff-file-name">
                                                                    {fileSection.fileName}
                                                                  </span>
                                                                  {fileSection.addedLines === 0 &&
                                                                  fileSection.removedLines === 0 ? (
                                                                    <span class="diff-file-status status-unchanged">
                                                                      Unchanged
                                                                    </span>
                                                                  ) : (
                                                                    <span class="diff-file-status status-modified">
                                                                      <span class="removed-count">
                                                                        -{fileSection.removedLines}
                                                                      </span>
                                                                      <span class="added-count">
                                                                        +{fileSection.addedLines}
                                                                      </span>
                                                                    </span>
                                                                  )}
                                                                </div>
                                                              </div>
                                                              {fileSection.isExpanded && (
                                                                <div class="diff-file-content">
                                                                  <div class="diff-hunks">
                                                                    <For each={fileSection.hunks}>
                                                                      {(hunk, hunkIndex) => (
                                                                        <div class="diff-hunk">
                                                                          {renderHunk(
                                                                            hunk,
                                                                            sectionKey,
                                                                            fileIndex(),
                                                                            hunkIndex(),
                                                                            fileSection,
                                                                          )}
                                                                        </div>
                                                                      )}
                                                                    </For>
                                                                  </div>
                                                                </div>
                                                              )}
                                                            </div>
                                                          )}
                                                        </For>
                                                      </div>
                                                    ) : (
                                                      <div class="drawer-loading">
                                                        <div class="loading-spinner"></div>
                                                        <div>
                                                          Preparing diff between{" "}
                                                          {newer.commandInfo?.command || "-"} and{" "}
                                                          {older.commandInfo?.command || "-"}...
                                                        </div>
                                                      </div>
                                                    )}
                                                  </td>
                                                </tr>
                                              )}
                                            </>
                                          );
                                        })()}
                                    </>
                                  )}
                                </For>
                              </tbody>
                            </table>

                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}


