// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { parse as parseYAML, stringify as stringifyYAML } from "@std/yaml";
import { useFilterStore } from "../../store/filterStore.tsx";
import { generateDiffHunks, type DiffHunk, type FileDiffSection } from "../../utils/diffUtils.ts";

type MinimalRes = { apiVersion: string; kind: string; metadata: { name: string; namespace?: string } };
type K8sMetadata = {
  resourceVersion?: string;
  uid?: string;
  generation?: number;
  creationTimestamp?: string;
  managedFields?: unknown;
  selfLink?: string;
  finalizers?: unknown;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
};
type K8sNormalized = {
  metadata?: K8sMetadata;
  status?: unknown;
  spec?: Record<string, unknown>;
  kind?: string;
};

export function HelmManifestDiff(props: { namespace?: string; name: string; revision?: number }) {
  const filterStore = useFilterStore();

  const [loading, setLoading] = createSignal<boolean>(false);
  const [error, setError] = createSignal<string>("");
  const [sections, setSections] = createSignal<FileDiffSection[]>([]);
  const [normalizeResources, setNormalizeResources] = createSignal<boolean>(true);

  const fetchLatestRevision = async (namespace: string, name: string): Promise<number | null> => {
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const hist = await fetch(`${apiPrefix}/helm/history/${namespace}/${name}`);
      if (!hist.ok) return null;
      const data = await hist.json();
      const releases: Array<{ revision: number }> = Array.isArray(data?.releases) ? data.releases : [];
      if (releases.length === 0) return null;
      const latest = releases.sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
      return latest.revision;
    } catch (_) {
      return null;
    }
  };

  const parseManifestDocs = (yamlContent: string): Array<{ raw: string; meta: MinimalRes }> => {
    if (!yamlContent || yamlContent.trim() === "") return [];
    const docs = yamlContent.split(/^---$/m).map(d => d.trim()).filter(Boolean);
    const out: Array<{ raw: string; meta: MinimalRes }> = [];
    for (const raw of docs) {
      try {
        const parsed = parseYAML(raw) as unknown as { apiVersion?: string; kind?: string; metadata?: { name?: string; namespace?: string } };
        const apiVersion = String(parsed?.apiVersion || "v1");
        const kind = String(parsed?.kind || "");
        const name = String(parsed?.metadata?.name || "");
        const ns = parsed?.metadata?.namespace;
        if (!kind || !name) continue;
        out.push({ raw, meta: { apiVersion, kind, metadata: { name, namespace: ns } } });
      } catch (_) {
        // ignore invalid docs
      }
    }
    return out;
  };

  const resourceTypeIdFor = (apiVersion: string, kind: string): string => {
    const group = apiVersion.includes("/") ? apiVersion.split("/")[0] : "core";
    return `${group}/${kind}`;
  };

  const fetchLiveObject = async (res: MinimalRes, fallbackNs: string): Promise<Record<string, unknown> | null> => {
    const resourceTypeId = resourceTypeIdFor(res.apiVersion, res.kind);
    const k8sResource = filterStore.k8sResources?.find(r => r.id === resourceTypeId);
    if (!k8sResource) return null;
    const ns = res.metadata.namespace || fallbackNs;
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const baseApiPath = k8sResource.apiPath.startsWith('/k8s') ? k8sResource.apiPath : `${k8sPrefix}${k8sResource.apiPath}`;
      let url = `${baseApiPath}/${k8sResource.name}/${res.metadata.name}`;
      if (k8sResource.namespaced) {
        url = `${baseApiPath}/namespaces/${ns}/${k8sResource.name}/${res.metadata.name}`;
      }
      const resp = await fetch(url);
      if (resp.status === 404) return null;
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) {
      return null;
    }
  };

  const _normalizeK8sResources = (yamlString: string): string => {
    if (!yamlString) return yamlString;
    try {
      const documents = parseYAMLDocuments(yamlString);
      if (!documents || documents.length === 0) return yamlString;
      const normalizedDocs = documents.map(doc => normalizeResource(doc));
      return serializeYAMLDocuments(normalizedDocs);
    } catch (_) {
      return yamlString;
    }
  };

  const parseYAMLDocuments = (yamlString: string): unknown[] => {
    const documents: unknown[] = [];
    const docStrings = yamlString.split(/^---$/m).filter(doc => doc.trim());
    for (const docString of docStrings) {
      try {
        const doc = parseYAML(docString);
        documents.push(doc);
      } catch (_) {
        documents.push(docString);
      }
    }
    return documents;
  };

  const serializeYAMLDocuments = (documents: unknown[]): string => {
    return documents.map(doc => {
      if (typeof doc === "string") return doc;
      try {
        return stringifyYAML(doc);
      } catch (_) {
        return JSON.stringify(doc, null, 2);
      }
    }).join("\n---\n");
  };

  const normalizeResource = (resource: unknown): unknown => {
    if (typeof resource !== 'object' || resource === null || typeof resource === 'string') {
      return resource;
    }
    try {
      const normalized = JSON.parse(JSON.stringify(resource)) as K8sNormalized;
      if (normalized.metadata) {
        delete normalized.metadata.resourceVersion;
        delete normalized.metadata.uid;
        delete normalized.metadata.generation;
        delete normalized.metadata.creationTimestamp;
        delete normalized.metadata.managedFields;
        delete normalized.metadata.selfLink;
        delete normalized.metadata.finalizers;
        delete (normalized.metadata as Record<string, unknown>).ownerReferences;
        const annotations = normalized.metadata.annotations;
        if (annotations) {
          delete annotations["kubectl.kubernetes.io/last-applied-configuration"];
          delete annotations["kustomize.toolkit.fluxcd.io/checksum"];
          delete annotations["kustomize.toolkit.fluxcd.io/reconcile"];
          delete annotations["deployment.kubernetes.io/revision"];
          delete annotations["control-plane.alpha.kubernetes.io/leader"];
          // Remove generic noisy annotations by prefix
          Object.keys(annotations).forEach((k) => {
            if (
              k.startsWith("kubectl.kubernetes.io/") ||
              k.startsWith("kustomize.toolkit.fluxcd.io/") ||
              k.startsWith("reconcile.fluxcd.io/") ||
              k.startsWith("meta.helm.sh/") ||
              k.includes("checksum/") ||
              k.startsWith("fluxcd.io/")
            ) {
              delete annotations[k];
            }
          });
          if (Object.keys(annotations).length === 0) {
            delete normalized.metadata.annotations;
          }
        }
        const labels = normalized.metadata.labels;
        if (labels) {
          delete labels["pod-template-hash"];
          delete labels["controller-revision-hash"];
          delete labels["kustomize.toolkit.fluxcd.io/name"];
          delete labels["kustomize.toolkit.fluxcd.io/namespace"];
          delete labels["meta.helm.sh/release-name"];
          delete labels["meta.helm.sh/release-namespace"];
          delete labels["helm.sh/chart"];
          // Remove label prefixes that are commonly controller/helm managed
          Object.keys(labels).forEach((k) => {
            if (
              k.startsWith("meta.helm.sh/") ||
              k.startsWith("pod-template-hash") ||
              k.includes("controller-revision-hash") ||
              k.startsWith("kustomize.toolkit.fluxcd.io/") ||
              k === "app.kubernetes.io/managed-by"
            ) {
              delete labels[k];
            }
          });
          if (Object.keys(labels).length === 0) {
            delete normalized.metadata.labels;
          }
        }
      }
      // Remove creationTimestamp keys nested anywhere (e.g., spec.template.metadata.creationTimestamp)
      const deepRemoveKey = (obj: unknown, key: string) => {
        if (Array.isArray(obj)) {
          obj.forEach((v) => deepRemoveKey(v, key));
        } else if (obj && typeof obj === 'object') {
          const rec = obj as Record<string, unknown>;
          if (key in rec) delete rec[key];
          Object.values(rec).forEach((v) => deepRemoveKey(v, key));
        }
      };
      deepRemoveKey(normalized, 'creationTimestamp');

      if (normalized.status) delete normalized.status;
      if (normalized.spec) {
        const spec = normalized.spec as Record<string, unknown>;
        if (normalized.kind === "Service") {
          delete spec["clusterIP"];
          delete spec["clusterIPs"];
          delete spec["ipFamilies"];
          delete spec["ipFamilyPolicy"];
          delete spec["internalTrafficPolicy"];
          delete spec["healthCheckNodePort"];
          delete spec["sessionAffinity"];
          delete spec["sessionAffinityConfig"];
          // Remove dynamically allocated nodePort values
          if (Array.isArray(spec["ports"])) {
            (spec["ports"] as Array<Record<string, unknown>>).forEach((p) => {
              delete p["nodePort"];
            });
          }
        }
        if (normalized.kind === "PersistentVolumeClaim") {
          delete spec["volumeName"];
        }
        if (normalized.kind === "Deployment") {
          // Remove defaulted values for cleaner diffs
          if (spec["revisionHistoryLimit"] === 10) delete spec["revisionHistoryLimit"];
          if (spec["progressDeadlineSeconds"] === 600) delete spec["progressDeadlineSeconds"];
          const strategy = spec["strategy"] as Record<string, unknown> | undefined;
          if (strategy) {
            const rolling = strategy["rollingUpdate"] as Record<string, unknown> | undefined;
            if (rolling) {
              const maxSurge = rolling["maxSurge"] as unknown;
              if (maxSurge === '25%' || maxSurge === 25 || maxSurge === '25') delete rolling["maxSurge"];
              const maxUnavailable = rolling["maxUnavailable"] as unknown;
              if (maxUnavailable === '25%' || maxUnavailable === 25 || maxUnavailable === '25') delete rolling["maxUnavailable"];
              if (Object.keys(rolling).length === 0) delete strategy["rollingUpdate"];
            }
            if (Object.keys(strategy).length === 0) delete spec["strategy"];
          }
        }
      }
      return normalized as unknown;
    } catch (_) {
      return resource;
    }
  };

  const deepSortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((v) => deepSortKeys(v));
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const sorted: Record<string, unknown> = {};
      for (const k of keys) {
        sorted[k] = deepSortKeys(obj[k]);
      }
      return sorted;
    }
    return value;
  };

  const canonicalizeResource = (resource: unknown, hideAutoFields: boolean): unknown => {
    const cloned = JSON.parse(JSON.stringify(resource)) as unknown;
    const normalized = hideAutoFields ? normalizeResource(cloned) : cloned;
    return deepSortKeys(normalized);
  };

  const toStableYaml = (obj: unknown): string => {
    try {
      return stringifyYAML(obj);
    } catch (_) {
      try {
        return JSON.stringify(obj, null, 2);
      } catch (_) {
        return String(obj ?? "");
      }
    }
  };

  const buildSections = async () => {
    if (!props.name) return;
    setLoading(true);
    setError("");
    try {
      const namespace = props.namespace || "";
      let revision = props.revision;
      if (!revision) {
        revision = await fetchLatestRevision(namespace, props.name) || undefined;
      }
      if (!revision) {
        setSections([]);
        return;
      }
      const url = `/api/helm/manifest/${namespace}/${props.name}?revision=${revision}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch Helm release manifest: ${response.statusText}`);
      const data = await response.json();
      const manifest: string = data.manifest || "";

      const docs = parseManifestDocs(manifest);

      const fileSections: FileDiffSection[] = [];
      for (const { raw, meta } of docs) {
        const live = await fetchLiveObject(meta, namespace);
        const manifestObj = (() => { try { return parseYAML(raw) as unknown; } catch (_) { return raw; } })();
        let fromYAML = "";
        let toYAML = "";
        if (live) {
          const liveCanon = canonicalizeResource(live, normalizeResources());
          const manCanon = canonicalizeResource(manifestObj, normalizeResources());
          // Compare manifest (from) vs live (to)
          fromYAML = toStableYaml(manCanon);
          toYAML = toStableYaml(liveCanon);
        } else {
          const manCanon = canonicalizeResource(manifestObj, normalizeResources());
          // No live object: compare manifest vs empty
          fromYAML = toStableYaml(manCanon);
          toYAML = "";
        }
        const fromLines = fromYAML.split("\n");
        const toLines = toYAML.split("\n");
        const hunks = generateDiffHunks(fromLines, toLines);
        const addedLines = hunks.reduce((sum, hunk) => sum + hunk.changes.filter(c => c.type === 'add').length, 0);
        const removedLines = hunks.reduce((sum, hunk) => sum + hunk.changes.filter(c => c.type === 'remove').length, 0);
        const fileName = `${resourceTypeIdFor(meta.apiVersion, meta.kind)} ${meta.metadata.namespace || namespace}/${meta.metadata.name}`;
        // With manifest (from) vs live (to): missing live means 'deleted' from manifest perspective?
        // UX: show as 'created' to indicate it will be created in cluster.
        const status: 'created' | 'modified' | 'deleted' = !live ? 'created' : 'modified';
        const isExpanded = status === 'modified' && (addedLines > 0 || removedLines > 0);
        fileSections.push({
          fileName,
          status,
          hunks,
          isExpanded,
          addedLines,
          removedLines,
          originalLines: fromLines,
          newLines: toLines,
        });
      }
      setSections(fileSections);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // dependencies: name, namespace, revision, normalize toggle
    const _ns = props.namespace || "";
    const _name = props.name;
    const _rev = props.revision;
    normalizeResources();
    if (_name && filterStore.k8sResources) buildSections();
  });

  const toggleNormalization = () => setNormalizeResources(prev => !prev);

  const [localSections, setLocalSections] = createSignal<FileDiffSection[]>([]);
  createEffect(() => {
    // Sync from computed sections to local editable sections for expand/collapse
    setLocalSections(sections());
  });

  const expandContext = (sectionIndex: number, hunkIndex: number, direction: 'before' | 'after') => {
    setLocalSections(prev => {
      const updated = [...prev];
      const section = { ...updated[sectionIndex] };
      const hunks = [...section.hunks];

      if (direction === 'before' && hunks[hunkIndex].canExpandBefore) {
        const hunk = { ...hunks[hunkIndex] };
        const newStart = Math.max(0, hunk.visibleStartOld - 10);
        const newStartNew = Math.max(0, hunk.visibleStartNew - 10);
        hunk.visibleStartOld = newStart;
        hunk.visibleStartNew = newStartNew;
        hunk.canExpandBefore = newStart > 0;
        hunks[hunkIndex] = hunk;
      } else if (direction === 'after' && hunks[hunkIndex].canExpandAfter) {
        const hunk = { ...hunks[hunkIndex] };
        const newEnd = Math.min(section.originalLines.length, hunk.visibleEndOld + 10);
        const newEndNew = Math.min(section.newLines.length, hunk.visibleEndNew + 10);
        hunk.visibleEndOld = newEnd;
        hunk.visibleEndNew = newEndNew;
        hunk.canExpandAfter = newEnd < section.originalLines.length;
        hunks[hunkIndex] = hunk;
      }

      section.hunks = hunks;
      updated[sectionIndex] = section;
      return updated;
    });
  };

  const toggleSection = (index: number) => {
    setLocalSections(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isExpanded: !updated[index].isExpanded };
      return updated;
    });
  };

  const renderHunk = (hunk: DiffHunk, sectionIndex: number, hunkIndex: number, section: FileDiffSection) => {
    const lines: JSX.Element[] = [];
    if (hunk.canExpandBefore) {
      lines.push(
        <div class="diff-expand-line">
          <button type="button" class="diff-expand-button" onClick={() => expandContext(sectionIndex, hunkIndex, 'before')}>
            ⋯ 10 more lines
          </button>
        </div>
      );
    }
    for (let i = hunk.visibleStartOld; i < hunk.startOldLine; i++) {
      if (i >= 0 && i < section.originalLines.length) {
        const newLineNum = hunk.visibleStartNew + (i - hunk.visibleStartOld);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{newLineNum + 1}</span>
            <span class="line-content"> {section.originalLines[i]}</span>
          </div>
        );
      }
    }
    let oldLineNum = hunk.startOldLine + 1;
    let newLineNum = hunk.startNewLine + 1;
    hunk.changes.forEach(change => {
      let className = '';
      let lineContent = '';
      let oldNum = '';
      let newNum = '';
      if (change.type === 'add') {
        className = 'diff-line-added';
        lineContent = `+${change.value}`;
        newNum = String(newLineNum++);
      } else if (change.type === 'remove') {
        className = 'diff-line-removed';
        lineContent = `-${change.value}`;
        oldNum = String(oldLineNum++);
      } else {
        className = 'diff-line-context';
        lineContent = ` ${change.value}`;
        oldNum = String(oldLineNum++);
        newNum = String(newLineNum++);
      }
      lines.push(
        <div class={className}>
          <span class="line-number old">{oldNum}</span>
          <span class="line-number new">{newNum}</span>
          <span class="line-content">{lineContent}</span>
        </div>
      );
    });
    const originalHunkEnd = hunk.startOldLine + hunk.changes.filter(c => c.type !== 'add').length;
    const originalHunkEndNew = hunk.startNewLine + hunk.changes.filter(c => c.type !== 'remove').length;
    for (let i = originalHunkEnd; i < hunk.visibleEndOld; i++) {
      if (i >= 0 && i < section.originalLines.length) {
        const newLineNum = originalHunkEndNew + (i - originalHunkEnd);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{newLineNum + 1}</span>
            <span class="line-content"> {section.originalLines[i]}</span>
          </div>
        );
      }
    }
    if (hunk.canExpandAfter) {
      lines.push(
        <div class="diff-expand-line">
          <button type="button" class="diff-expand-button" onClick={() => expandContext(sectionIndex, hunkIndex, 'after')}>
            ⋯ 10 more lines
          </button>
        </div>
      );
    }
    return lines;
  };

  return (
    <div>
      <div class="logs-controls">
        <div class="logs-options-row">
          <div class="logs-follow-controls">
            <label title="Normalize Kubernetes resources to hide fields that are expected to differ">
              <input type="checkbox" checked={normalizeResources()} onChange={toggleNormalization} />
              Hide auto-generated fields
            </label>
          </div>
        </div>
      </div>

      <Show when={!loading()} fallback={<div class="drawer-loading">Loading...</div>}>
        <Show when={!error()} fallback={<div class="no-data">{error()}</div>}>
          <Show when={localSections().length > 0} fallback={<div class="no-data">No differences found</div>}>
            <div class="diff-content">
              <For each={localSections()}>
                {(section, sectionIndex) => (
                  <div class="diff-file-section">
                    <div class="diff-file-header" onClick={() => toggleSection(sectionIndex())}>
                      <div class="diff-file-info">
                        <div class="diff-file-toggle">{section.isExpanded ? '▼' : '►'}</div>
                        <span class="diff-file-name">{section.fileName}</span>
                        {section.status === 'created' ? (
                          <span class="diff-file-status status-created">Created</span>
                        ) : section.status === 'deleted' ? (
                          <span class="diff-file-status status-deleted">Deleted</span>
                        ) : section.addedLines === 0 && section.removedLines === 0 ? (
                          <span class="diff-file-status status-unchanged">Unchanged</span>
                        ) : (
                          <span class="diff-file-status status-modified">
                            <span class="removed-count">-{section.removedLines}</span>
                            <span class="added-count">+{section.addedLines}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <Show when={section.isExpanded}>
                      <div class="diff-file-content">
                        <div class="diff-hunks">
                          <For each={section.hunks}>
                            {(hunk, hunkIndex) => (
                              <div class="diff-hunk">
                                {renderHunk(hunk, sectionIndex(), hunkIndex(), section)}
                              </div>
                            )}
                          </For>
                        </div>
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
  );
}


