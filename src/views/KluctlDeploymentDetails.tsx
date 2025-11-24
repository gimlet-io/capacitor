// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, Show, createMemo } from "solid-js";
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

  const formatSummaryStatus = (s: KluctlSummary | undefined): string => {
    if (!s) return "No changes";

    const errorMessages = getIssueMessages(s.errors);
    const warningMessages = getIssueMessages(s.warnings);

    const parts: string[] = [];

    const rendered = typeof s.renderedObjects === "number" ? s.renderedObjects : 0;
    if (rendered) parts.push(`${rendered} rendered`);

    const applied = typeof s.appliedObjects === "number" ? s.appliedObjects : 0;
    if (applied) parts.push(`${applied} applied`);

    const changed = typeof s.changedObjects === "number" ? s.changedObjects : 0;
    if (changed) parts.push(`${changed} changed`);

    const deleted = typeof s.deletedObjects === "number" ? s.deletedObjects : 0;
    if (deleted) parts.push(`${deleted} deleted`);

    const newly = typeof s.newObjects === "number" ? s.newObjects : 0;
    if (newly) parts.push(`${newly} new`);

    const orphan = typeof s.orphanObjects === "number" ? s.orphanObjects : 0;
    if (orphan) parts.push(`${orphan} orphan`);

    const errorCount = countIssues(s.errors);
    if (errorCount) {
      const suffix = errorMessages.length ? `: ${errorMessages.join(" | ")}` : "";
      parts.push(`${errorCount} errors${suffix}`);
    }

    const warningCount = countIssues(s.warnings);
    if (warningCount) {
      const suffix = warningMessages.length ? `: ${warningMessages.join(" | ")}` : "";
      parts.push(`${warningCount} warnings${suffix}`);
    }

    return parts.length ? parts.join(" | ") : "No changes";
  };

  const formatStatusLine = (s: KluctlSummary | undefined): string => {
    if (!s) return "No deploy history available";
    return formatSummaryStatus(s);
  };

  return (
    <div class="kustomization-details">
      <Show when={deployment()} fallback={<div class="loading">Loading...</div>}>
        {(d) => {
          const dep = d();
          const latest = getLatestSummary(dep);
          const summaries = getSummaries(dep);
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
                              <li>
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
                        {summaries.length === 0 ? (
                          <div class="message-cell">No deploy history available.</div>
                        ) : (
                          <>
                            <div class="message-cell">
                              <ul>
                                {summaries.map((s) => (
                                  <li>
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

                            <details style="margin-top: 12px;">
                              <summary class="label">Latest reducedResult JSON</summary>
                              <pre class="conditions-yaml">
{(() => {
  const txt = (dep.status?.latestReducedResult as string | undefined) || "";
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

                            <details style="margin-top: 12px;">
                              <summary class="label">Latest compactedObjects JSON</summary>
                              <pre class="conditions-yaml">
{(() => {
  const txt = (dep.status?.latestCompactedObjects as string | undefined) || "";
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


