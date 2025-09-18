// deno-lint-ignore-file jsx-button-has-type
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { getWebSocketClient } from "../../k8sWebSocketClient.ts";
import { checkPermissionSSAR, type MinimalK8sResource } from "../../utils/permissions.ts";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { stringify, parse as parseYAML } from "@std/yaml";
import { type DiffHunk, type FileDiffSection, generateDiffHunks } from "../../utils/diffUtils.ts";

export function HelmHistory(props: {
  namespace: string;
  name: string;
  apiVersion: string;
  kind: string;
  onSelectedRevisionChange?: (revision?: number) => void;
}) {
  const [historyData, setHistoryData] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal<boolean>(true);
  const [selectedRevisionIndex, setSelectedRevisionIndex] = createSignal<number>(-1);
  const [canRollback, setCanRollback] = createSignal<boolean | undefined>(undefined);

  const [expandedDiffs, setExpandedDiffs] = createSignal<{ [key: string]: { expanded: boolean; diffType: "values" | "manifest" } }>({});
  const [diffData, setDiffData] = createSignal<{ [key: string]: any }>({});
  const [diffSections, setDiffSections] = createSignal<{ [key: string]: { fileSections: FileDiffSection[] } }>({});

  const apiResourceStore = useApiResourceStore();
  let tableRef: HTMLTableElement | undefined;
  let unsubscribeHistory: (() => void) | null = null;

  // Permission check
  createEffect(() => {
    const res: MinimalK8sResource = { apiVersion: props.apiVersion, kind: props.kind, metadata: { name: props.name, namespace: props.namespace } };
    (async () => {
      const ok = await checkPermissionSSAR(res, { verb: 'patch' }, apiResourceStore.apiResources as any);
      setCanRollback(ok);
    })();
  });

  // Watch history via websocket
  const setupHistoryWatcher = () => {
    setLoading(true);
    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
    }
    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
    // Context is conveyed by the WS connection URL; the subscribe path must be context-agnostic
    const wsPath = `/api/helm/history/${props.namespace}/${props.name}`;
    const wsClient = getWebSocketClient(ctxName);
    wsClient.watchResource(wsPath, (data) => {
      if (data && data.object && data.object.releases) {
        const sortedReleases = data.object.releases.sort((a: any, b: any) => b.revision - a.revision);
        setHistoryData(sortedReleases);
        if (selectedRevisionIndex() === -1 && sortedReleases.length > 0) setSelectedRevisionIndex(0);
        setLoading(false);
      }
    }).then((unsubscribe) => {
      unsubscribeHistory = unsubscribe;
    }).catch((_error) => {
      setLoading(false);
      setHistoryData([]);
    });
  };

  onMount(() => {
    setupHistoryWatcher();
  });
  onCleanup(() => {
    if (unsubscribeHistory) unsubscribeHistory();
  });

  // Emit selected revision upwards
  createEffect(() => {
    const idx = selectedRevisionIndex();
    const list = historyData();
    const rev = idx >= 0 && idx < list.length ? list[idx].revision : undefined;
    props.onSelectedRevisionChange?.(rev);
  });

  // Rollback
  const rollbackToRevision = async () => {
    const index = selectedRevisionIndex();
    if (index === -1) return;
    const selectedRevision = historyData()[index];
    if (!selectedRevision) return;
    const revisionNumber = selectedRevision.revision;
    if (canRollback() === false) return;
    if (!window.confirm(`Are you sure you want to rollback ${props.name} to revision ${revisionNumber}?`)) return;
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const url = (ctxName ? `/api/${ctxName}` : '/api') + `/helm/rollback/${props.namespace}/${props.name}/${revisionNumber}`;
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) throw new Error(`Failed to rollback release: ${response.statusText}`);
    } catch (error) {
      console.error("Error rolling back release:", error);
      alert(`Failed to rollback: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Diff helpers (copied from HelmDrawer)
  const fetchReleaseValuesDiff = async (fromRevision: number, toRevision: number) => {
    const diffKey = `${toRevision}-${fromRevision}`;
    if (diffData()[diffKey]) return diffData()[diffKey];
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const url1 = `${apiPrefix}/helm/values/${props.namespace}/${props.name}?revision=${fromRevision}`;
      const url2 = `${apiPrefix}/helm/values/${props.namespace}/${props.name}?revision=${toRevision}`;
      const [r1, r2] = await Promise.all([fetch(url1), fetch(url2)]);
      if (!r1.ok) throw new Error(`Failed to fetch values for revision ${fromRevision}: ${r1.statusText}`);
      if (!r2.ok) throw new Error(`Failed to fetch values for revision ${toRevision}: ${r2.statusText}`);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const newDiffData = { ...diffData() };
      newDiffData[diffKey] = { fromValues: d1.values || {}, toValues: d2.values || {} };
      setDiffData(newDiffData);
      return newDiffData[diffKey];
    } catch (error) {
      console.error(`Error fetching diff between revisions ${fromRevision} and ${toRevision}:`, error);
      return null;
    }
  };

  const fetchReleaseManifestDiff = async (fromRevision: number, toRevision: number) => {
    const diffKey = `${toRevision}-${fromRevision}-manifest`;
    if (diffData()[diffKey]) return diffData()[diffKey];
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const url1 = `${apiPrefix}/helm/manifest/${props.namespace}/${props.name}?revision=${fromRevision}`;
      const url2 = `${apiPrefix}/helm/manifest/${props.namespace}/${props.name}?revision=${toRevision}`;
      const [r1, r2] = await Promise.all([fetch(url1), fetch(url2)]);
      if (!r1.ok) throw new Error(`Failed to fetch manifest for revision ${fromRevision}: ${r1.statusText}`);
      if (!r2.ok) throw new Error(`Failed to fetch manifest for revision ${toRevision}: ${r2.statusText}`);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const newDiffData = { ...diffData() };
      newDiffData[diffKey] = { fromManifest: d1.manifest || "", toManifest: d2.manifest || "" };
      setDiffData(newDiffData);
      return newDiffData[diffKey];
    } catch (error) {
      console.error(`Error fetching manifest diff between revisions ${fromRevision} and ${toRevision}:`, error);
      return null;
    }
  };

  const toggleDiff = async (fromRevision: number, toRevision: number, diffType: "values" | "manifest" = "values") => {
    const diffKey = `${toRevision}-${fromRevision}`;
    const state = expandedDiffs()[diffKey];
    const isExpanded = state?.expanded || false;
    const next = { ...expandedDiffs() };
    if (!isExpanded) next[diffKey] = { expanded: true, diffType };
    else if (state.diffType === diffType) delete next[diffKey];
    else next[diffKey] = { expanded: true, diffType };
    setExpandedDiffs(next);
    if (!isExpanded || state?.diffType !== diffType) {
      if (diffType === "values") await fetchReleaseValuesDiff(fromRevision, toRevision);
      else await fetchReleaseManifestDiff(fromRevision, toRevision);
    }
  };

  const parseKubernetesResources = (yamlContent: string): { name: string; content: string }[] => {
    if (!yamlContent || yamlContent.trim() === '') return [];
    const documents = yamlContent.split(/^---$/m).map(doc => doc.trim()).filter(doc => doc.length > 0);
    const resources: { name: string; content: string }[] = [];
    documents.forEach((doc, index) => {
      try {
        const parsed = parseYAML(doc) as any;
        let resourceName = `Document ${index + 1}`;
        if (parsed && typeof parsed === 'object' && parsed.kind && parsed.metadata) {
          const kind = parsed.kind;
          const name = parsed.metadata.name || 'unnamed';
          const namespace = parsed.metadata.namespace;
          resourceName = namespace ? `${kind}/${namespace}/${name}` : `${kind}/${name}`;
        }
        resources.push({ name: resourceName, content: doc });
      } catch (_) {
        resources.push({ name: `Document ${index + 1}`, content: doc });
      }
    });
    return resources;
  };

  const [diffSectionsState, setDiffSectionsState] = [diffSections, setDiffSections];

  const toggleFileSection = (diffKey: string, fileIndex: number) => {
    setDiffSections(prev => {
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

  const expandContext = (diffKey: string, fileIndex: number, hunkIndex: number, direction: 'before' | 'after') => {
    setDiffSections(prev => {
      const updated = { ...prev };
      const section = { ...updated[diffKey] };
      const fileSections = [...section.fileSections];
      const fileSection = { ...fileSections[fileIndex] };
      const hunks = [...fileSection.hunks];
      if (direction === 'before' && hunks[hunkIndex].canExpandBefore) {
        const hunk = { ...hunks[hunkIndex] };
        const newStart = Math.max(0, hunk.visibleStartOld - 10);
        const newStartNew = Math.max(0, hunk.visibleStartNew - 10);
        if (hunkIndex > 0) {
          const prevHunk = hunks[hunkIndex - 1];
          if (newStart <= prevHunk.visibleEndOld) {
            const mergedHunk = { startOldLine: prevHunk.startOldLine, startNewLine: prevHunk.startNewLine, changes: [...prevHunk.changes], visibleStartOld: prevHunk.visibleStartOld, visibleStartNew: prevHunk.visibleStartNew, visibleEndOld: hunk.visibleEndOld, visibleEndNew: hunk.visibleEndNew, canExpandBefore: prevHunk.canExpandBefore, canExpandAfter: hunk.canExpandAfter } as DiffHunk;
            for (let i = prevHunk.visibleEndOld; i < hunk.visibleStartOld; i++) {
              if (i >= 0 && i < fileSection.originalLines.length) {
                const newLineNum = prevHunk.visibleEndNew + (i - prevHunk.visibleEndOld);
                mergedHunk.changes.push({ type: 'match', value: fileSection.originalLines[i], oldLineNumber: i + 1, newLineNumber: newLineNum + 1 });
              }
            }
            mergedHunk.changes.push(...hunk.changes);
            hunks.splice(hunkIndex - 1, 2, mergedHunk);
          } else {
            hunk.visibleStartOld = newStart; hunk.visibleStartNew = newStartNew; hunk.canExpandBefore = newStart > 0; hunks[hunkIndex] = hunk;
          }
        } else {
          hunk.visibleStartOld = newStart; hunk.visibleStartNew = newStartNew; hunk.canExpandBefore = newStart > 0; hunks[hunkIndex] = hunk;
        }
      } else if (direction === 'after' && hunks[hunkIndex].canExpandAfter) {
        const hunk = { ...hunks[hunkIndex] };
        const newEnd = Math.min(fileSection.originalLines.length, hunk.visibleEndOld + 10);
        const newEndNew = Math.min(fileSection.newLines.length, hunk.visibleEndNew + 10);
        if (hunkIndex < hunks.length - 1) {
          const nextHunk = hunks[hunkIndex + 1];
          if (newEnd >= nextHunk.visibleStartOld) {
            const mergedHunk = { startOldLine: hunk.startOldLine, startNewLine: hunk.startNewLine, changes: [...hunk.changes], visibleStartOld: hunk.visibleStartOld, visibleStartNew: hunk.visibleStartNew, visibleEndOld: nextHunk.visibleEndOld, visibleEndNew: nextHunk.visibleEndNew, canExpandBefore: hunk.canExpandBefore, canExpandAfter: nextHunk.canExpandAfter } as DiffHunk;
            for (let i = hunk.visibleEndOld; i < nextHunk.visibleStartOld; i++) {
              if (i >= 0 && i < fileSection.originalLines.length) {
                const newLineNum = hunk.visibleEndNew + (i - hunk.visibleEndOld);
                mergedHunk.changes.push({ type: 'match', value: fileSection.originalLines[i], oldLineNumber: i + 1, newLineNumber: newLineNum + 1 });
              }
            }
            mergedHunk.changes.push(...nextHunk.changes);
            hunks.splice(hunkIndex, 2, mergedHunk);
          } else {
            hunk.visibleEndOld = newEnd; hunk.visibleEndNew = newEndNew; hunk.canExpandAfter = newEnd < fileSection.originalLines.length; hunks[hunkIndex] = hunk;
          }
        } else {
          hunk.visibleEndOld = newEnd; hunk.visibleEndNew = newEndNew; hunk.canExpandAfter = newEnd < fileSection.originalLines.length; hunks[hunkIndex] = hunk;
        }
      }
      fileSection.hunks = hunks; fileSections[fileIndex] = fileSection; section.fileSections = fileSections; updated[diffKey] = section; return updated;
    });
  };

  const renderHunk = (hunk: DiffHunk, diffKey: string, fileIndex: number, hunkIndex: number, fileSection: FileDiffSection) => {
    const lines: any[] = [];
    if (hunk.canExpandBefore) {
      lines.push(
        <div class="diff-expand-line">
          <button class="diff-expand-button" onClick={() => expandContext(diffKey, fileIndex, hunkIndex, 'before')}>⋯ 10 more lines</button>
        </div>
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
          </div>
        );
      }
    }
    let oldLineNum = hunk.startOldLine + 1;
    let newLineNum = hunk.startNewLine + 1;
    hunk.changes.forEach((change) => {
      let className = ''; let lineContent = ''; let oldNum = ''; let newNum = '';
      if (change.type === 'add') { className = 'diff-line-added'; lineContent = `+${change.value}`; newNum = String(newLineNum++); }
      else if (change.type === 'remove') { className = 'diff-line-removed'; lineContent = `-${change.value}`; oldNum = String(oldLineNum++); }
      else { className = 'diff-line-context'; lineContent = ` ${change.value}`; oldNum = String(oldLineNum++); newNum = String(newLineNum++); }
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
      if (i >= 0 && i < fileSection.originalLines.length) {
        const n = originalHunkEndNew + (i - originalHunkEnd);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{n + 1}</span>
            <span class="line-content"> {fileSection.originalLines[i]}</span>
          </div>
        );
      }
    }
    if (hunk.canExpandAfter) {
      lines.push(
        <div class="diff-expand-line">
          <button class="diff-expand-button" onClick={() => expandContext(diffKey, fileIndex, hunkIndex, 'after')}>⋯ 10 more lines</button>
        </div>
      );
    }
    return lines;
  };

  const generateDiffView = (fromValues: any, toValues: any, diffKey: string) => {
    const fromYaml = stringify(fromValues);
    const toYaml = stringify(toValues);
    if (fromYaml === toYaml) return <div class="no-diff">No differences found in values</div>;
    if (!diffSections()[diffKey]) {
      const fromLines = fromYaml.split("\n");
      const toLines = toYaml.split("\n");
      const hunks = generateDiffHunks(fromLines, toLines);
      const addedLines = hunks.reduce((s, h) => s + h.changes.filter(c => c.type === 'add').length, 0);
      const removedLines = hunks.reduce((s, h) => s + h.changes.filter(c => c.type === 'remove').length, 0);
      const fileSections: FileDiffSection[] = [{ fileName: 'values.yaml', status: 'modified', hunks, isExpanded: addedLines > 0 || removedLines > 0, addedLines, removedLines, originalLines: fromLines, newLines: toLines }];
      setDiffSections(prev => ({ ...prev, [diffKey]: { fileSections } }));
    }
    const section = diffSections()[diffKey];
    if (!section) return <div class="no-diff">Loading diff...</div>;
    return (
      <div class="diff-content">
        <For each={section.fileSections}>
          {(fileSection, fileIndex) => (
            <div class="diff-file-section">
              <div class="diff-file-header" onClick={() => toggleFileSection(diffKey, fileIndex())}>
                <div class="diff-file-info">
                  <div class="diff-file-toggle">{fileSection.isExpanded ? '▼' : '►'}</div>
                  <span class="diff-file-name">{fileSection.fileName}</span>
                  {fileSection.addedLines === 0 && fileSection.removedLines === 0 ? (
                    <span class="diff-file-status status-unchanged">Unchanged</span>
                  ) : (
                    <span class="diff-file-status status-modified"><span class="removed-count">-{fileSection.removedLines}</span><span class="added-count">+{fileSection.addedLines}</span></span>
                  )}
                </div>
              </div>
              <Show when={fileSection.isExpanded}>
                <div class="diff-file-content">
                  <div class="diff-hunks">
                    <For each={fileSection.hunks}>
                      {(hunk, hunkIndex) => (
                        <div class="diff-hunk">{renderHunk(hunk, diffKey, fileIndex(), hunkIndex(), fileSection)}</div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    );
  };

  const generateManifestDiffView = (fromManifest: string, toManifest: string, diffKey: string) => {
    if (fromManifest === toManifest) return <div class="no-diff">No differences found in manifests</div>;
    if (!diffSections()[diffKey]) {
      const fromResources = parseKubernetesResources(fromManifest);
      const toResources = parseKubernetesResources(toManifest);
      const fromMap = new Map(fromResources.map(r => [r.name, r.content]));
      const toMap = new Map(toResources.map(r => [r.name, r.content]));
      const allNames = new Set<string>([...fromResources.map(r => r.name), ...toResources.map(r => r.name)]);
      const fileSections: FileDiffSection[] = [];
      allNames.forEach(resourceName => {
        const fromContent = fromMap.get(resourceName) || '';
        const toContent = toMap.get(resourceName) || '';
        const fromLines = fromContent.split("\n");
        const toLines = toContent.split("\n");
        let status: 'created' | 'modified' | 'deleted';
        if (!fromContent && toContent) status = 'created'; else if (fromContent && !toContent) status = 'deleted'; else status = 'modified';
        const hunks = generateDiffHunks(fromLines, toLines);
        const addedLines = hunks.reduce((s, h) => s + h.changes.filter(c => c.type === 'add').length, 0);
        const removedLines = hunks.reduce((s, h) => s + h.changes.filter(c => c.type === 'remove').length, 0);
        const isExpanded = status === 'modified' && (addedLines > 0 || removedLines > 0);
        fileSections.push({ fileName: resourceName, status, hunks, isExpanded, addedLines, removedLines, originalLines: fromLines, newLines: toLines });
      });
      setDiffSections(prev => ({ ...prev, [diffKey]: { fileSections } }));
    }
    const section = diffSections()[diffKey];
    if (!section) return <div class="no-diff">Loading diff...</div>;
    return (
      <div class="diff-content">
        <For each={section.fileSections}>
          {(fileSection, fileIndex) => (
            <div class="diff-file-section">
              <div class="diff-file-header" onClick={() => toggleFileSection(diffKey, fileIndex())}>
                <div class="diff-file-info">
                  <div class="diff-file-toggle">{fileSection.isExpanded ? '▼' : '►'}</div>
                  <span class="diff-file-name">{fileSection.fileName}</span>
                  {fileSection.status === 'created' ? (
                    <span class="diff-file-status status-created">Created</span>
                  ) : fileSection.status === 'deleted' ? (
                    <span class="diff-file-status status-deleted">Deleted</span>
                  ) : fileSection.addedLines === 0 && fileSection.removedLines === 0 ? (
                    <span class="diff-file-status status-unchanged">Unchanged</span>
                  ) : (
                    <span class="diff-file-status status-modified"><span class="removed-count">-{fileSection.removedLines}</span><span class="added-count">+{fileSection.addedLines}</span></span>
                  )}
                </div>
              </div>
              <Show when={fileSection.isExpanded}>
                <div class="diff-file-content">
                  <div class="diff-hunks">
                    <For each={fileSection.hunks}>
                      {(hunk, hunkIndex) => (
                        <div class="diff-hunk">{renderHunk(hunk, diffKey, fileIndex(), hunkIndex(), fileSection)}</div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    );
  };

  // Keyboard: navigate rows and rollback
  const handleKeyDown = (e: KeyboardEvent) => {
    const currentIndex = selectedRevisionIndex();
    let newIndex = currentIndex;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); newIndex = Math.max(0, currentIndex - 1); break;
      case "ArrowDown": e.preventDefault(); newIndex = Math.min(historyData().length - 1, currentIndex + 1); break;
      case "Home": e.preventDefault(); newIndex = 0; break;
      case "End": e.preventDefault(); newIndex = historyData().length - 1; break;
      case "r": if (e.ctrlKey && currentIndex !== -1) { e.preventDefault(); rollbackToRevision(); } break;
    }
    if (newIndex !== currentIndex) {
      setSelectedRevisionIndex(newIndex);
      setTimeout(() => {
        const rows = tableRef?.querySelectorAll("tbody tr");
        const targetRow = rows?.[newIndex * 2];
        if (targetRow) targetRow.scrollIntoView({ block: "nearest", behavior: "auto" });
      }, 0);
    }
  };
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown, true);
  });
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown, true);
  });

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "deployed": return "var(--success-color)";
      case "failed": return "var(--error-color)";
      case "pending-install":
      case "pending-upgrade":
      case "pending-rollback": return "var(--warning-color)";
      case "superseded": return "var(--linear-text-tertiary)";
      default: return "var(--linear-text-secondary)";
    }
  };

  return (
    <Show when={!loading()} fallback={<div class="drawer-loading">Loading...</div>}>
      <Show when={historyData().length > 0} fallback={<div class="no-history">No release history found</div>}>
        <div class="keyboard-shortcut-container" style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
          <div class="keyboard-shortcut">
            <span class={`shortcut-key ${canRollback() === false ? 'disabled' : ''}`}>Mod+r</span>
            <span class={`shortcut-description ${canRollback() === false ? 'disabled' : ''}`}>Rollback to selected revision</span>
          </div>
        </div>
        <table class="helm-history-table" ref={tableRef}>
          <thead>
            <tr>
              <th>Revision</th>
              <th>Updated</th>
              <th>Status</th>
              <th>Chart</th>
              <th>App Version</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <For each={historyData()}>
              {(release, index) => (
                <>
                  <tr class={selectedRevisionIndex() === index() ? "selected-revision" : ""} onClick={() => setSelectedRevisionIndex(index())}>
                    <td>{release.revision}</td>
                    <td>{release.updated}</td>
                    <td><span style={{ color: getStatusColor(release.status) }}>{release.status}</span></td>
                    <td>{release.chart}</td>
                    <td>{release.app_version}</td>
                    <td>{release.description}</td>
                  </tr>
                  <Show when={index() < historyData().length - 1}>
                    {(() => {
                      const nextRelease = historyData()[index() + 1];
                      const diffKey = `${release.revision}-${nextRelease.revision}`;
                      const diffState = expandedDiffs()[diffKey] || { expanded: false, diffType: "values" };
                      const isExpanded = diffState.expanded; const diffType = diffState.diffType;
                      return (
                        <>
                          <tr class="diff-divider-row">
                            <td colSpan={6} class="diff-divider-cell">
                              <div class="diff-button-container">
                                <div class="diff-button-group">
                                  <button class={`diff-button ${diffType === "values" && isExpanded ? "active" : ""}`} onClick={() => toggleDiff(nextRelease.revision, release.revision, "values")} title={`${isExpanded && diffType === "values" ? "Hide" : "Show"} values diff between revision ${release.revision} and ${nextRelease.revision}`}>Diff Values</button>
                                  <button class={`diff-button ${diffType === "manifest" && isExpanded ? "active" : ""}`} onClick={() => toggleDiff(nextRelease.revision, release.revision, "manifest")} title={`${isExpanded && diffType === "manifest" ? "Hide" : "Show"} manifest diff between revision ${release.revision} and ${nextRelease.revision}`}>Manifest</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                          <Show when={isExpanded}>
                            <tr class="diff-content-row">
                              <td colSpan={6} class="diff-content-cell">
                                <Show when={diffType === "values" ? diffData()[diffKey] : diffData()[`${diffKey}-manifest`]} fallback={<div class="drawer-loading"><div class="loading-spinner"></div><div>Loading diff between revisions {nextRelease.revision} and {release.revision}...</div></div>}>
                                  {(() => {
                                    if (diffType === "values") {
                                      const diff = diffData()[diffKey];
                                      return generateDiffView(diff.fromValues, diff.toValues, diffKey);
                                    } else {
                                      const diff = diffData()[`${diffKey}-manifest`];
                                      return generateManifestDiffView(diff.fromManifest, diff.toManifest, `${diffKey}-manifest`);
                                    }
                                  })()}
                                </Show>
                              </td>
                            </tr>
                          </Show>
                        </>
                      );
                    })()}
                  </Show>
                </>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </Show>
  );
}


