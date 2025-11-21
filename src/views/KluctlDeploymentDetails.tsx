// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useFilterStore } from "../store/filterStore.tsx";
import { watchResource } from "../watches.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { stringify as stringifyYAML } from "@std/yaml";

type KluctlDeploymentResult = any;

type KluctlSummary = {
  id?: string;
  command?: string;
  startTime?: string;
  endTime?: string;
  errors?: number;
  warnings?: number;
  changedObjects?: number;
  newObjects?: number;
  deletedObjects?: number;
  orphanObjects?: number;
  appliedObjects?: number;
  totalChanges?: number;
};

export function KluctlDeploymentDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const filterStore = useFilterStore();

  const [deployment, setDeployment] = createSignal<KluctlDeploymentResult | null>(null);
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  const [activeTab, setActiveTab] = createSignal<"history">("history");

  createEffect(() => {
    if (params.name && filterStore.k8sResources.length > 0) {
      // Allow empty namespace for cluster-wide pseudo deployments
      setupWatches(params.namespace || "", params.name);
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

  const formatStatusLine = (s: KluctlSummary | undefined): string => {
    if (!s) return "No deploy history available";
    const errors = s.errors || 0;
    const warnings = s.warnings || 0;
    const changed = s.changedObjects || 0;
    const total = s.totalChanges || 0;
    const parts: string[] = [];
    if (errors) parts.push(`${errors} errors`);
    if (warnings) parts.push(`${warnings} warnings`);
    if (changed || total) {
      const label = total || changed;
      parts.push(`${label} changes`);
    }
    return parts.length ? parts.join(", ") : "No changes";
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
                          const proj = dep.spec?.project;
                          const repoKey = proj?.RepoKey;
                          if (!repoKey) return "-";
                          if (typeof repoKey === "string") return repoKey;
                          if (repoKey?.url) return repoKey.url;
                          return String(repoKey);
                        })()}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="label">Target:</span>
                      <span class="value">
                        {dep.spec?.target?.name || dep.spec?.target?.targetName || "-"}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="label">Last Command:</span>
                      <span class="value">
                        {latest?.command || "None"}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="label">Last Run:</span>
                      <span class="value">
                        {latest?.startTime
                          ? useCalculateAge(latest.startTime)()
                          : "-"}
                      </span>
                    </div>
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 2;">
                      <span class="label">Status:</span>
                      <span class="value">
                        {formatStatusLine(latest)}
                      </span>
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
                    { key: "history", label: "Deploy History" },
                  ]}
                  activeKey={activeTab()}
                  onChange={(k) => setActiveTab(k as "history")}
                  style={{ "margin-top": "12px" }}
                />

                <Show when={activeTab() === "history"}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        {summaries.length === 0 ? (
                          <div class="message-cell">No deploy history available.</div>
                        ) : (
                          <table class="resource-table">
                            <thead>
                              <tr>
                                <th>AGE</th>
                                <th>COMMAND</th>
                                <th>CHANGES</th>
                                <th>ERRORS</th>
                                <th>WARNINGS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summaries.map((s) => (
                                <tr>
                                  <td>
                                    {s.startTime ? useCalculateAge(s.startTime)() : "-"}
                                  </td>
                                  <td>
                                    <code>{s.command}</code>
                                  </td>
                                  <td>
                                    {s.totalChanges ?? s.changedObjects ?? 0}
                                  </td>
                                  <td>{s.errors ?? 0}</td>
                                  <td>{s.warnings ?? 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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


