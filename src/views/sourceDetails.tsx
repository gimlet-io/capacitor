// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { Show, For, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type {
  GitRepository,
  HelmRepository,
  OCIRepository,
  Bucket,
  Event,
  ExtendedKustomization,
  Source,
} from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useCheckPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";
import { handleFluxReconcile, handleFluxSuspend } from "../utils/fluxUtils.tsx";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";
import { stringify as stringifyYAML } from "@std/yaml";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { Tabs } from "../components/Tabs.tsx";
import { EventList } from "../components/resourceList/EventList.tsx";
import { ConditionType } from "../utils/conditions.ts";

type FluxSourceKind = "GitRepository" | "HelmRepository" | "OCIRepository" | "Bucket";

type FluxSource =
  | (GitRepository & { events?: Event[] })
  | (HelmRepository & { events?: Event[] })
  | (OCIRepository & { events?: Event[] })
  | (Bucket & { events?: Event[] });

type ArtifactFile = {
  path: string;
  size: number;
  dir: boolean;
  // Optional inline content returned by the backend for regular files
  content?: string;
};

type ArtifactSection = {
  path: string;
  size: number;
  content: string;
  expanded: boolean;
};

// Helper to render revision similarly to KustomizationDetails, including clickable link for Git repositories
const renderSourceRevision = (source: Source | null | undefined): JSX.Element => {
  const revision = source?.status?.artifact?.revision;
  if (!revision) return <span class="value">None</span>;

  // For GitRepository, try to create a clickable commit link using the URL ref when possible
  const gitSpec = (source as unknown as GitRepository | undefined)?.spec as
    | GitRepository["spec"]
    | undefined;
  const url = gitSpec?.url;

  if (url && revision.includes("sha1:")) {
    const parts = revision.split("sha1:");
    if (parts.length > 1) {
      const reference = parts[0];
      const fullSha = parts[1].replace(/^[:@]/, "");
      const match = fullSha.match(/[0-9a-f]{7,40}/i);
      const sha = match ? match[0] : "";
      if (sha) {
        const shortSha = sha.substring(0, 9);
        const normalized = normalizeGitUrlToHttps(url);
        const commitUrl = normalized.includes("github.com")
          ? `${normalized}/commit/${sha}`
          : normalized.includes("gitlab.com")
          ? `${normalized}/-/commit/${sha}`
          : null;

        if (commitUrl) {
          return (
            <a
              href={commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="value"
              style={{ "text-decoration": "underline", "color": "var(--linear-blue)" }}
            >
              {`${reference}sha1:${shortSha}`}
            </a>
          );
        }
      }
    }
  }

  return <span class="value">{revision}</span>;
};

const normalizeGitUrlToHttps = (repoUrl: string): string => {
  const trimmed = (repoUrl || "").trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\.git\/?$/, "").replace(/\/$/, "");
  }

  const scpLike = trimmed.match(/^git@([^:\/]+):(.+)$/i);
  if (scpLike) {
    const host = scpLike[1];
    const path = scpLike[2].replace(/\.git\/?$/, "").replace(/\/$/, "");
    return `https://${host}/${path}`;
  }

  const sshLike = trimmed.match(/^(?:git\+)?ssh:\/\/(?:[^@]+@)?([^\/:]+)(?::\d+)?\/(.+)$/i);
  if (sshLike) {
    const host = sshLike[1];
    const path = sshLike[2].replace(/\.git\/?$/, "").replace(/\/$/, "");
    return `https://${host}/${path}`;
  }

  return trimmed.replace(/\.git\/?$/, "").replace(/\/$/, "");
};

export function SourceDetails() {
  const params = useParams<{ kind: string; namespace: string; name: string }>();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const checkPermission = useCheckPermissionSSAR();

  const [source, setSource] = createSignal<FluxSource | null>(null);
  const [canReconcile, setCanReconcile] = createSignal<boolean>(false);
  const [canPatch, setCanPatch] = createSignal<boolean>(false);

  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  const [activeTab, setActiveTab] = createSignal<"events" | "artifact">("artifact");

  const [artifactLoading, setArtifactLoading] = createSignal(false);
  const [artifactError, setArtifactError] = createSignal<string | null>(null);
  const [artifactFiles, setArtifactFiles] = createSignal<ArtifactFile[]>([]);
  const [artifactSections, setArtifactSections] = createSignal<ArtifactSection[]>([]);

  // Compute permissions
  createEffect(() => {
    const src = source();
    if (!src) return;

    const res: MinimalK8sResource = {
      apiVersion: src.apiVersion,
      kind: src.kind,
      metadata: { name: src.metadata.name, namespace: src.metadata.namespace },
    };

    (async () => {
      const allowed = await checkPermission(res, { verb: "patch" });
      setCanReconcile(allowed);
      setCanPatch(allowed);
    })();
  });

  // Set up watches when params and API resources loaded.
  // Extract all reactive reads here and pass plain values to setupWatches
  // to avoid any reactive tracking inside the setup function.
  createEffect(() => {
    const ns = params.namespace;
    const name = params.name;
    const kindParam = params.kind;
    const apiResources = apiResourceStore.apiResources;
    const currentContext = apiResourceStore.contextInfo?.current;

    if (ns && name && kindParam && apiResources) {
      const kind = kindParam as FluxSourceKind;
      // Pass all reactive values as plain parameters
      untrack(() => {
        setupWatches(ns, name, kind, apiResources, currentContext);
      });
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });
  });

  // All parameters are plain values - no reactive reads inside this function
  const setupWatches = (
    ns: string,
    name: string,
    kind: FluxSourceKind,
    apiResources: typeof apiResourceStore.apiResources,
    currentContext: string | undefined,
  ) => {
    // Abort existing watches without tracking this signal inside reactive effects
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setSource(null);

    const controllers: AbortController[] = [];

    const api = (apiResources || []).find(
      (r) => r.group === "source.toolkit.fluxcd.io" && r.kind === kind,
    );
    const baseApiPath = api?.apiPath || "/k8s/apis/source.toolkit.fluxcd.io/v1beta2";
    const pluralName =
      api?.name ||
      ((): string => {
        switch (kind) {
          case "GitRepository":
            return "gitrepositories";
          case "HelmRepository":
            return "helmrepositories";
          case "OCIRepository":
            return "ocirepositories";
          case "Bucket":
            return "buckets";
          default:
            return "";
        }
      })();

    if (!pluralName) {
      return;
    }

    // Watch the source resource itself
    {
      const controller = new AbortController();
      const path = `${baseApiPath}/namespaces/${ns}/${pluralName}?watch=true`;
      const callback = (event: { type: string; object: FluxSource }) => {
        if ((event.type === "ADDED" || event.type === "MODIFIED") && event.object.metadata.name === name) {
          setSource((prev) => {
            const events = prev?.events || [];
            return { ...event.object, events } as FluxSource;
          });
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, currentContext);
      controllers.push(controller);
    }

    // Watch Events in namespace and keep relevant ones
    {
      const controller = new AbortController();
      const ctxName = currentContext ? encodeURIComponent(currentContext) : "";
      const path =
        (ctxName ? `/k8s/${ctxName}` : "/k8s") + `/api/v1/namespaces/${ns}/events?watch=true`;
      const callback = (event: { type: string; object: Event }) => {
        const obj = event.object;
        setSource((prev) => {
          if (!prev) return prev;
          const relevant =
            obj.involvedObject.kind === kind &&
            obj.involvedObject.name === name &&
            obj.involvedObject.namespace === ns;
          if (!relevant) return prev;
          const list = (prev.events || []).filter((e) => e.metadata.name !== obj.metadata.name);
          return { ...prev, events: [obj, ...list].slice(0, 50) } as FluxSource;
        });
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, currentContext);
      controllers.push(controller);
    }

    setWatchControllers(controllers);
  };

  const handleBackClick = () => {
    navigate("/");
  };

  const loadArtifactFiles = async () => {
    const src = source();
    if (!src) return;
    setArtifactLoading(true);
    setArtifactError(null);
    setArtifactFiles([]);
    setArtifactSections([]);

    try {
      const ctxName = apiResourceStore.contextInfo?.current
        ? encodeURIComponent(apiResourceStore.contextInfo.current)
        : "";
      if (!ctxName) {
        setArtifactError("No Kubernetes context selected");
        setArtifactLoading(false);
        return;
      }

      const url = `/api/${ctxName}/flux/source-artifact/${encodeURIComponent(
        src.kind,
      )}/${encodeURIComponent(src.metadata.namespace)}/${encodeURIComponent(src.metadata.name)}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const msg = typeof data.error === "string" ? data.error : `HTTP ${resp.status}`;
        setArtifactError(msg);
        setArtifactLoading(false);
        return;
      }

      const data = await resp.json();
      const files = Array.isArray(data.files) ? (data.files as ArtifactFile[]) : [];
      // Sort by path for stable display
      files.sort((a, b) => a.path.localeCompare(b.path));
      setArtifactFiles(files);

      const yamlFiles = files.filter(
        (f) => !f.dir && (f.path.endsWith(".yaml") || f.path.endsWith(".yml")),
      );
      const sections: ArtifactSection[] = yamlFiles.map((f) => ({
        path: f.path,
        size: f.size,
        content: f.content ?? "",
        expanded: true,
      }));
      setArtifactSections(sections);
    } catch (err) {
      console.error("Failed to load source artifact:", err);
      setArtifactError("Failed to load source artifact");
    } finally {
      setArtifactLoading(false);
    }
  };

  // Lazy load artifact listing when artifact tab is opened
  createEffect(() => {
    if (activeTab() === "artifact" && source() && artifactFiles().length === 0 && !artifactLoading()) {
      loadArtifactFiles();
    }
  });

  const describeSourceType = (src: FluxSource): string => {
    switch (src.kind as FluxSourceKind) {
      case "GitRepository":
        return "Git repository";
      case "HelmRepository":
        return "Helm repository";
      case "OCIRepository":
        return "OCI repository";
      case "Bucket":
        return "Bucket";
      default:
        return src.kind;
    }
  };

  return (
    <div class="kustomization-details">
      <Show when={source()} fallback={<div class="loading">Loading...</div>}>
        {(s) => {
          const src = s();
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>
                      {src.metadata.namespace}/{src.metadata.name}
                    </h1>
                    <div class="kustomization-status">
                      {StatusBadges(src as unknown as ExtendedKustomization)}
                    </div>
                  </div>
                  <div class="header-actions">
                    <button
                      class="sync-button reconcile-button"
                      disabled={canReconcile() === false}
                      title={canReconcile() === false ? "Not permitted" : undefined}
                      onClick={() => handleFluxReconcile(src, apiResourceStore.contextInfo?.current)}
                    >
                      Reconcile
                    </button>
                    {src.spec.suspend ? (
                      <button
                        class="sync-button resume"
                        style={{ "background-color": "#188038", color: "white" }}
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(src, false, apiResourceStore.contextInfo?.current).catch((e) =>
                            console.error("Failed to resume source:", e),
                          );
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
                          handleFluxSuspend(src, true, apiResourceStore.contextInfo?.current).catch((e) =>
                            console.error("Failed to suspend source:", e),
                          );
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
                      <span class="label">Type:</span>
                      <span class="value">{describeSourceType(src)}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">URL:</span>
                      <span class="value">
                        {(src as GitRepository | HelmRepository | OCIRepository | Bucket).spec?.url || "—"}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="label">Interval:</span>
                      <span class="value">{src.spec.interval}</span>
                    </div>
                    <Show when={src.status}>
                      <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 2;">
                        <span class="label">Status:</span>
                        <span class="value">
                          {(() => {
                            const readyCondition = src.status?.conditions?.find(
                              (c) => c.type === ConditionType.Ready || c.type === "Ready",
                            );
                            return readyCondition?.message || "—";
                          })()}
                        </span>
                      </div>
                    </Show>
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 2 / 5;">
                      <span class="label">Events:</span>
                      <ul style="font-family: monospace; font-size: 12px;">
                        {(src.events || [])
                          .slice()
                          .sort(
                            (a, b) =>
                              new Date(b.lastTimestamp).getTime() -
                              new Date(a.lastTimestamp).getTime(),
                          )
                          .slice(0, 5)
                          .map((event) => (
                            <li>
                              <span title={event.lastTimestamp}>
                                {useCalculateAge(event.lastTimestamp)()}
                              </span>{" "}
                              {event.involvedObject.kind}/{event.involvedObject.namespace}/
                              {event.involvedObject.name}:{" "}
                              <span>
                                {(() => {
                                  const msg = (event.message || "").replace(/[\r\n]+/g, " ");
                                  const truncated = msg.length > 300;
                                  const shown = truncated ? msg.slice(0, 300) + "…" : msg;
                                  return (
                                    <>
                                      {shown}
                                      {truncated && (
                                        <button
                                          class="inline-open-events"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setActiveTab("events");
                                          }}
                                          style={{
                                            "margin-left": "6px",
                                            "font-size": "12px",
                                            padding: "0",
                                            border: "none",
                                            background: "transparent",
                                            "text-decoration": "underline",
                                            cursor: "pointer",
                                          }}
                                          title="Open events"
                                        >
                                          open events..
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>

                    {src.status && (
                      <div class="info-item full-width">
                        <div class="info-grid">
                          <div class="info-item" style={{ "grid-column": "1 / 3" }}>
                            <span class="label">Artifact Revision:</span>
                            {renderSourceRevision(src as unknown as Source)}
                          </div>
                          <div class="info-item">
                            <span class="label">Artifact URL:</span>
                            <span class="value">
                              {src.status?.artifact?.url || "None"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div class="info-item full-width">
                      <details>
                        <summary class="label">Conditions</summary>
                        <pre class="conditions-yaml">
                          {src.status?.conditions
                            ? stringifyYAML(src.status.conditions)
                            : "No conditions available"}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>

              <div style="padding: 0rem 1rem 1rem 1rem">
                <Tabs
                  tabs={[
                    {
                      key: "artifact",
                      label: "Source Artifact",
                    },
                    {
                      key: "events",
                      label: (
                        <span>
                          Events
                          {(() => {
                            const count = (src.events || []).length;
                            return count ? ` (${count})` : "";
                          })()}
                        </span>
                      ),
                    },
                  ]}
                  activeKey={activeTab()}
                  onChange={(k) => setActiveTab(k as "artifact" | "events")}
                  style={{ "margin-top": "12px" }}
                />

                <Show when={activeTab() === "artifact"}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        <Show
                          when={!artifactLoading()}
                          fallback={<div class="drawer-loading">Loading artifact...</div>}
                        >
                          <Show
                            when={!artifactError()}
                            fallback={
                              <pre class="conditions-yaml">
                                {artifactError()}
                              </pre>
                            }
                          >
                            <Show
                              when={artifactSections().length > 0}
                              fallback={
                                <pre class="conditions-yaml">
                                  No YAML files found in source artifact.
                                </pre>
                              }
                            >
                              <div class="diff-content">
                                <For each={artifactSections()}>
                                  {(section, index) => (
                                    <div class="diff-file-section">
                                      <div
                                        class="diff-file-header"
                                        onClick={() =>
                                          setArtifactSections((prev) => {
                                            const next = [...prev];
                                            next[index()] = {
                                              ...next[index()],
                                              expanded: !next[index()].expanded,
                                            };
                                            return next;
                                          })
                                        }
                                      >
                                        <div class="diff-file-info">
                                          <div class="diff-file-toggle">
                                            {section.expanded ? "▼" : "►"}
                                          </div>
                                          <span class="diff-file-name">{section.path}</span>
                                          <span class="diff-file-status status-modified">
                                            <span class="added-count">
                                              {section.size} bytes
                                            </span>
                                          </span>
                                        </div>
                                      </div>
                                      <Show when={section.expanded}>
                                        <div class="diff-file-content">
                                          <pre class="conditions-yaml">
                                            {section.content}
                                          </pre>
                                        </div>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </div>
                </Show>

                <Show when={activeTab() === "events"}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        <EventList events={(source()?.events || []) as Event[]} />
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


