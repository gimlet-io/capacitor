// deno-lint-ignore-file jsx-button-has-type
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import type { HelmRelease } from "../resourceList/HelmReleaseList.tsx";
import { stringify, parse as parseYAML } from "@std/yaml";
import { getWebSocketClient } from "../../k8sWebSocketClient.ts";
import { checkPermissionSSAR, type MinimalK8sResource } from "../../utils/permissions.ts";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { Tabs } from "../Tabs.tsx";
import {
  type DiffItem,
  type DiffHunk,
  type FileDiffSection,
  generateDiffHunks,
} from "../../utils/diffUtils.ts";

// Interface for diff sections
interface DiffSection {
  fileSections: FileDiffSection[];
}

export function HelmDrawer(props: {
  resource: HelmRelease;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "history" | "values" | "manifest";
}) {
  const [historyData, setHistoryData] = createSignal<any[]>([]);
  const [valuesData, setValuesData] = createSignal<any>(null);
  const [manifestData, setManifestData] = createSignal<string>("");
  const [activeTab, setActiveTab] = createSignal<
    "history" | "values" | "manifest"
  >(props.initialTab || "history");
  const [loading, setLoading] = createSignal<boolean>(true);
  const [showAllValues, setShowAllValues] = createSignal<boolean>(false);
  const [expandedDiffs, setExpandedDiffs] = createSignal<{ [key: string]: { expanded: boolean; diffType: "values" | "manifest" } }>({});
  const [diffData, setDiffData] = createSignal<{ [key: string]: any }>({});
  const [selectedRevisionIndex, setSelectedRevisionIndex] = createSignal<
    number
  >(-1);
  // State for file-based diff sections
  const [diffSections, setDiffSections] = createSignal<{ [key: string]: DiffSection }>({});

  let contentRef: HTMLDivElement | undefined;
  let tableRef: HTMLTableElement | undefined;
  let unsubscribeHistory: (() => void) | null = null;
  const apiResourceStore = useApiResourceStore();
  const [canRollback, setCanRollback] = createSignal<boolean | undefined>(undefined);

  createEffect(() => {
    const hr = props.resource as any;
    if (!hr) {
      setCanRollback(undefined);
      return;
    }
    const res: MinimalK8sResource = { apiVersion: hr.apiVersion, kind: hr.kind, metadata: { name: hr.metadata.name, namespace: hr.metadata.namespace } };
    (async () => {
      const ok = await checkPermissionSSAR(res, { verb: 'patch' }, apiResourceStore.apiResources as any);
      setCanRollback(ok);
    })();
  });

  // Watch for changes to initialTab prop
  createEffect(() => {
    if (props.initialTab) {
      setActiveTab(props.initialTab);
    }
  });

  // Setup WebSocket subscription for continuous updates
  const setupHistoryWatcher = () => {
    if (!props.resource || !props.isOpen || activeTab() !== "history") return;

    // Show loading state until we get data
    setLoading(true);

    // Clean up any existing subscription
    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
    }

    const name = props.resource.metadata.name;
    const namespace = props.resource.metadata.namespace || "";

    // Create a WebSocket path for this specific resource
    const wsPath = `/api/helm/history/${namespace}/${name}`;

    // Subscribe to updates for this resource
    const wsClient = getWebSocketClient();
    wsClient.watchResource(wsPath, (data) => {
      // When we receive updates, update the history data
      if (data && data.object && data.object.releases) {
        const sortedReleases = data.object.releases.sort((a: any, b: any) =>
          b.revision - a.revision
        );
        setHistoryData(sortedReleases);

        // If there's no selected revision yet and we have data, select the first one
        if (selectedRevisionIndex() === -1 && sortedReleases.length > 0) {
          setSelectedRevisionIndex(0);
        }

        // Data has loaded
        setLoading(false);

        // Focus the content after loading
        setTimeout(() => contentRef?.focus(), 50);
      }
    }).then((unsubscribe) => {
      unsubscribeHistory = unsubscribe;
    }).catch((error) => {
      console.error("Error setting up WebSocket for Helm history:", error);
      setLoading(false);
      setHistoryData([]);
    });
  };

  // Fetch the Helm release values when the drawer opens and tab is values
  const fetchReleaseValues = async () => {
    if (!props.resource) return;

    setLoading(true);
    try {
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";

      // Call the backend API for Helm release values data
      const url =
        `/api/helm/values/${namespace}/${name}?allValues=${showAllValues()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Helm release values: ${response.statusText}`,
        );
      }

      const data = await response.json();
      setValuesData(data.values || {});
    } catch (error) {
      console.error("Error fetching Helm release values:", error);
      setValuesData({});
    } finally {
      setLoading(false);
      // Focus the content after loading
      setTimeout(() => contentRef?.focus(), 50);
    }
  };

  // Fetch the diff between two releases
  const fetchReleaseValuesDiff = async (
    fromRevision: number,
    toRevision: number,
  ) => {
    if (!props.resource) return;

    const diffKey = `${toRevision}-${fromRevision}`;

    // Return cached diff data if available
    if (diffData()[diffKey]) {
      return diffData()[diffKey];
    }

    try {
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";

      // Get values for the first revision
      const url1 =
        `/api/helm/values/${namespace}/${name}?revision=${fromRevision}`;
      const response1 = await fetch(url1);

      if (!response1.ok) {
        throw new Error(
          `Failed to fetch values for revision ${fromRevision}: ${response1.statusText}`,
        );
      }

      // Get values for the second revision
      const url2 =
        `/api/helm/values/${namespace}/${name}?revision=${toRevision}`;
      const response2 = await fetch(url2);

      if (!response2.ok) {
        throw new Error(
          `Failed to fetch values for revision ${toRevision}: ${response2.statusText}`,
        );
      }

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Store the diff data
      const newDiffData = { ...diffData() };
      newDiffData[diffKey] = {
        fromValues: data1.values || {},
        toValues: data2.values || {},
      };
      setDiffData(newDiffData);

      return newDiffData[diffKey];
    } catch (error) {
      console.error(
        `Error fetching diff between revisions ${fromRevision} and ${toRevision}:`,
        error,
      );
      return null;
    }
  };

  // Toggle the expanded state of a diff section
  const toggleDiff = async (
    fromRevision: number,
    toRevision: number,
    diffType: "values" | "manifest" = "values",
  ) => {
    const diffKey = `${toRevision}-${fromRevision}`;
    const diffState = expandedDiffs()[diffKey];
    const isExpanded = diffState?.expanded || false;

    // Toggle the expanded state
    const newExpandedDiffs = { ...expandedDiffs() };
    if (!isExpanded) {
      // When expanding, set the diff type
      newExpandedDiffs[diffKey] = {
        expanded: true,
        diffType: diffType,
      };
    } else {
      // When collapsing, check if we're toggling the same type
      if (diffState.diffType === diffType) {
        // If same type, collapse
        delete newExpandedDiffs[diffKey];
      } else {
        // If different type, switch type
        newExpandedDiffs[diffKey] = {
          expanded: true,
          diffType: diffType,
        };
      }
    }
    setExpandedDiffs(newExpandedDiffs);

    // Only fetch the diff data when expanding or switching types
    if (!isExpanded || diffState?.diffType !== diffType) {
      if (diffType === "values") {
        await fetchReleaseValuesDiff(fromRevision, toRevision);
      } else if (diffType === "manifest") {
        await fetchReleaseManifestDiff(fromRevision, toRevision);
      }
    } else {
      console.log("debug: skipping diff fetch");
    }
  };

  // Fetch the diff between two releases' manifests
  const fetchReleaseManifestDiff = async (
    fromRevision: number,
    toRevision: number,
  ) => {
    if (!props.resource) return;

    const diffKey = `${toRevision}-${fromRevision}-manifest`;

    // Return cached diff data if available
    if (diffData()[diffKey]) {
      return diffData()[diffKey];
    }

    try {
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";

      // Get manifest for the first revision
      const url1 =
        `/api/helm/manifest/${namespace}/${name}?revision=${fromRevision}`;
      const response1 = await fetch(url1);

      if (!response1.ok) {
        throw new Error(
          `Failed to fetch manifest for revision ${fromRevision}: ${response1.statusText}`,
        );
      }

      // Get manifest for the second revision
      const url2 =
        `/api/helm/manifest/${namespace}/${name}?revision=${toRevision}`;
      const response2 = await fetch(url2);

      if (!response2.ok) {
        throw new Error(
          `Failed to fetch manifest for revision ${toRevision}: ${response2.statusText}`,
        );
      }

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Store the diff data
      const newDiffData = { ...diffData() };
      newDiffData[diffKey] = {
        fromManifest: data1.manifest || "",
        toManifest: data2.manifest || "",
      };
      setDiffData(newDiffData);

      return newDiffData[diffKey];
    } catch (error) {
      console.error(
        `Error fetching manifest diff between revisions ${fromRevision} and ${toRevision}:`,
        error,
      );
      return null;
    }
  };

  // Parse YAML content into separate Kubernetes resources
  const parseKubernetesResources = (yamlContent: string): { name: string; content: string }[] => {
    if (!yamlContent || yamlContent.trim() === '') return [];
    
    // Split on document separators
    const documents = yamlContent.split(/^---$/m)
      .map(doc => doc.trim())
      .filter(doc => doc.length > 0);
    
    const resources: { name: string; content: string }[] = [];
    
    documents.forEach((doc, index) => {
      try {
        // Try to parse as YAML to extract metadata
        const parsed = parseYAML(doc) as any;
        let resourceName = `Document ${index + 1}`;
        
        if (parsed && typeof parsed === 'object' && parsed.kind && parsed.metadata) {
          const kind = parsed.kind;
          const name = parsed.metadata.name || 'unnamed';
          const namespace = parsed.metadata.namespace;
          resourceName = namespace ? `${kind}/${namespace}/${name}` : `${kind}/${name}`;
        }
        
        resources.push({
          name: resourceName,
          content: doc
        });
      } catch (error) {
        // If parsing fails, still include the document
        resources.push({
          name: `Document ${index + 1}`,
          content: doc
        });
      }
    });
    
    return resources;
  };

  // Toggle file section expansion
  const toggleFileSection = (diffKey: string, fileIndex: number) => {
    setDiffSections(prev => {
      const updated = {...prev};
      const section = {...updated[diffKey]};
      const fileSections = [...section.fileSections];
      const fileSection = {...fileSections[fileIndex]};
      
      fileSection.isExpanded = !fileSection.isExpanded;
      fileSections[fileIndex] = fileSection;
      section.fileSections = fileSections;
      updated[diffKey] = section;
      return updated;
    });
  };

  // Expand context for a specific hunk (updated for file sections with merge detection)
  const expandContext = (diffKey: string, fileIndex: number, hunkIndex: number, direction: 'before' | 'after') => {
    setDiffSections(prev => {
      const updated = {...prev};
      const section = {...updated[diffKey]};
      const fileSections = [...section.fileSections];
      const fileSection = {...fileSections[fileIndex]};
      const hunks = [...fileSection.hunks];
      
      if (direction === 'before' && hunks[hunkIndex].canExpandBefore) {
        const hunk = {...hunks[hunkIndex]};
        const newStart = Math.max(0, hunk.visibleStartOld - 10);
        const newStartNew = Math.max(0, hunk.visibleStartNew - 10);
        
        // Check if expansion would overlap with previous hunk
        if (hunkIndex > 0) {
          const prevHunk = hunks[hunkIndex - 1];
          if (newStart <= prevHunk.visibleEndOld) {
            // Merge with previous hunk
            const mergedHunk = {
              startOldLine: prevHunk.startOldLine,
              startNewLine: prevHunk.startNewLine,
              changes: [...prevHunk.changes],
              visibleStartOld: prevHunk.visibleStartOld,
              visibleStartNew: prevHunk.visibleStartNew,
              visibleEndOld: hunk.visibleEndOld,
              visibleEndNew: hunk.visibleEndNew,
              canExpandBefore: prevHunk.canExpandBefore,
              canExpandAfter: hunk.canExpandAfter
            };
            
            // Add gap lines between previous hunk and current hunk
            for (let i = prevHunk.visibleEndOld; i < hunk.visibleStartOld; i++) {
              if (i >= 0 && i < fileSection.originalLines.length) {
                const newLineNum = prevHunk.visibleEndNew + (i - prevHunk.visibleEndOld);
                mergedHunk.changes.push({
                  type: 'match',
                  value: fileSection.originalLines[i],
                  oldLineNumber: i + 1,
                  newLineNumber: newLineNum + 1
                });
              }
            }
            
            // Add current hunk's changes
            mergedHunk.changes.push(...hunk.changes);
            
            // Remove both hunks and add merged one
            hunks.splice(hunkIndex - 1, 2, mergedHunk);
          } else {
            // Normal expansion
            hunk.visibleStartOld = newStart;
            hunk.visibleStartNew = newStartNew;
            hunk.canExpandBefore = newStart > 0;
            hunks[hunkIndex] = hunk;
          }
        } else {
          // Normal expansion for first hunk
          hunk.visibleStartOld = newStart;
          hunk.visibleStartNew = newStartNew;
          hunk.canExpandBefore = newStart > 0;
          hunks[hunkIndex] = hunk;
        }
      } else if (direction === 'after' && hunks[hunkIndex].canExpandAfter) {
        const hunk = {...hunks[hunkIndex]};
        const newEnd = Math.min(fileSection.originalLines.length, hunk.visibleEndOld + 10);
        const newEndNew = Math.min(fileSection.newLines.length, hunk.visibleEndNew + 10);
        
        // Check if expansion would overlap with next hunk
        if (hunkIndex < hunks.length - 1) {
          const nextHunk = hunks[hunkIndex + 1];
          if (newEnd >= nextHunk.visibleStartOld) {
            // Merge with next hunk
            const mergedHunk = {
              startOldLine: hunk.startOldLine,
              startNewLine: hunk.startNewLine,
              changes: [...hunk.changes],
              visibleStartOld: hunk.visibleStartOld,
              visibleStartNew: hunk.visibleStartNew,
              visibleEndOld: nextHunk.visibleEndOld,
              visibleEndNew: nextHunk.visibleEndNew,
              canExpandBefore: hunk.canExpandBefore,
              canExpandAfter: nextHunk.canExpandAfter
            };
            
            // Add gap lines between current hunk and next hunk
            for (let i = hunk.visibleEndOld; i < nextHunk.visibleStartOld; i++) {
              if (i >= 0 && i < fileSection.originalLines.length) {
                const newLineNum = hunk.visibleEndNew + (i - hunk.visibleEndOld);
                mergedHunk.changes.push({
                  type: 'match',
                  value: fileSection.originalLines[i],
                  oldLineNumber: i + 1,
                  newLineNumber: newLineNum + 1
                });
              }
            }
            
            // Add next hunk's changes
            mergedHunk.changes.push(...nextHunk.changes);
            
            // Remove both hunks and add merged one
            hunks.splice(hunkIndex, 2, mergedHunk);
          } else {
            // Normal expansion
            hunk.visibleEndOld = newEnd;
            hunk.visibleEndNew = newEndNew;
            hunk.canExpandAfter = newEnd < fileSection.originalLines.length;
            hunks[hunkIndex] = hunk;
          }
        } else {
          // Normal expansion for last hunk
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

  // Render a hunk with context (updated for file sections)
  const renderHunk = (hunk: DiffHunk, diffKey: string, fileIndex: number, hunkIndex: number, fileSection: FileDiffSection) => {
    const lines: JSX.Element[] = [];
    
    // Add expand before button if we can expand more
    if (hunk.canExpandBefore) {
      lines.push(
        <div class="diff-expand-line">
          <button 
            class="diff-expand-button"
            onClick={() => expandContext(diffKey, fileIndex, hunkIndex, 'before')}
          >
            ⋯ 10 more lines
          </button>
        </div>
      );
    }
    
    // Add extra context lines before the hunk if expanded
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
    
    // Add the original hunk changes
    let oldLineNum = hunk.startOldLine + 1;
    let newLineNum = hunk.startNewLine + 1;
    
    hunk.changes.forEach((change) => {
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
    
    // Add extra context lines after the hunk if expanded
    const originalHunkEnd = hunk.startOldLine + hunk.changes.filter(c => c.type !== 'add').length;
    const originalHunkEndNew = hunk.startNewLine + hunk.changes.filter(c => c.type !== 'remove').length;
    
    for (let i = originalHunkEnd; i < hunk.visibleEndOld; i++) {
      if (i >= 0 && i < fileSection.originalLines.length) {
        const newLineNum = originalHunkEndNew + (i - originalHunkEnd);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{newLineNum + 1}</span>
            <span class="line-content"> {fileSection.originalLines[i]}</span>
          </div>
        );
      }
    }
    
    // Add expand after button if we can expand more
    if (hunk.canExpandAfter) {
      lines.push(
        <div class="diff-expand-line">
          <button 
            class="diff-expand-button"
            onClick={() => expandContext(diffKey, fileIndex, hunkIndex, 'after')}
          >
            ⋯ 10 more lines
          </button>
        </div>
      );
    }
    
    return lines;
  };

  // Generate file-based diff view using the same approach as DiffDrawer
  const generateDiffView = (fromValues: any, toValues: any, diffKey: string) => {
    // Convert objects to YAML for comparison
    const fromYaml = stringify(fromValues);
    const toYaml = stringify(toValues);

    if (fromYaml === toYaml) {
      return <div class="no-diff">No differences found in values</div>;
    }

    // Generate file sections if not already cached
    if (!diffSections()[diffKey]) {
      // For values, we treat it as a single "values.yaml" file
      const fromLines = fromYaml.split("\n");
      const toLines = toYaml.split("\n");
      
      const hunks = generateDiffHunks(fromLines, toLines);
      const addedLines = hunks.reduce((sum, hunk) => 
        sum + hunk.changes.filter(change => change.type === 'add').length, 0);
      const removedLines = hunks.reduce((sum, hunk) => 
        sum + hunk.changes.filter(change => change.type === 'remove').length, 0);
      
      const fileSections: FileDiffSection[] = [{
        fileName: 'values.yaml',
        status: 'modified',
        hunks,
        isExpanded: addedLines > 0 || removedLines > 0, // Expand if there are changes
        addedLines,
        removedLines,
        originalLines: fromLines,
        newLines: toLines
      }];

      setDiffSections(prev => ({
        ...prev,
        [diffKey]: { fileSections }
      }));
    }

    const section = diffSections()[diffKey];
    if (!section) return <div class="no-diff">Loading diff...</div>;

    return (
      <div class="diff-content">
        <For each={section.fileSections}>
          {(fileSection, fileIndex) => (
            <div class="diff-file-section">
              <div 
                class="diff-file-header" 
                onClick={() => toggleFileSection(diffKey, fileIndex())}
              >
                <div class="diff-file-info">
                  <div class="diff-file-toggle">
                    {fileSection.isExpanded ? '▼' : '►'}
                  </div>
                  <span class="diff-file-name">{fileSection.fileName}</span>
                  {fileSection.status === 'created' ? (
                    <span class="diff-file-status status-created">Created</span>
                  ) : fileSection.status === 'deleted' ? (
                    <span class="diff-file-status status-deleted">Deleted</span>
                  ) : fileSection.addedLines === 0 && fileSection.removedLines === 0 ? (
                    <span class="diff-file-status status-unchanged">Unchanged</span>
                  ) : (
                    <span class="diff-file-status status-modified">
                      <span class="removed-count">-{fileSection.removedLines}</span>
                      <span class="added-count">+{fileSection.addedLines}</span>
                    </span>
                  )}
                </div>
              </div>
              
              <Show when={fileSection.isExpanded}>
                <div class="diff-file-content">
                  <div class="diff-hunks">
                    <For each={fileSection.hunks}>
                      {(hunk, hunkIndex) => (
                        <div class="diff-hunk">
                          {renderHunk(hunk, diffKey, fileIndex(), hunkIndex(), fileSection)}
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
    );
  };

  // Generate file-based manifest diff view
  const generateManifestDiffView = (
    fromManifest: string,
    toManifest: string,
    diffKey: string
  ) => {
    if (fromManifest === toManifest) {
      return <div class="no-diff">No differences found in manifests</div>;
    }

    // Generate file sections if not already cached
    if (!diffSections()[diffKey]) {
      // Parse both manifests into separate Kubernetes resources
      const fromResources = parseKubernetesResources(fromManifest);
      const toResources = parseKubernetesResources(toManifest);
      
      // Create a map for easier lookup
      const fromResourceMap = new Map(fromResources.map(r => [r.name, r.content]));
      const toResourceMap = new Map(toResources.map(r => [r.name, r.content]));
      
      // Get all unique resource names
      const allResourceNames = new Set([
        ...fromResources.map(r => r.name),
        ...toResources.map(r => r.name)
      ]);
      
      const fileSections: FileDiffSection[] = [];
      
      allResourceNames.forEach(resourceName => {
        const fromContent = fromResourceMap.get(resourceName) || '';
        const toContent = toResourceMap.get(resourceName) || '';
        
        const fromLines = fromContent.split("\n");
        const toLines = toContent.split("\n");
        
        // Determine status
        let status: 'created' | 'modified' | 'deleted';
        if (!fromContent && toContent) {
          status = 'created';
        } else if (fromContent && !toContent) {
          status = 'deleted';
        } else {
          status = 'modified';
        }
        
        const hunks = generateDiffHunks(fromLines, toLines);
        const addedLines = hunks.reduce((sum, hunk) => 
          sum + hunk.changes.filter(change => change.type === 'add').length, 0);
        const removedLines = hunks.reduce((sum, hunk) => 
          sum + hunk.changes.filter(change => change.type === 'remove').length, 0);
        
        // Only expand if there are actual changes
        const isExpanded = status === 'modified' && (addedLines > 0 || removedLines > 0);
        
        fileSections.push({
          fileName: resourceName,
          status,
          hunks,
          isExpanded,
          addedLines,
          removedLines,
          originalLines: fromLines,
          newLines: toLines
        });
      });

      setDiffSections(prev => ({
        ...prev,
        [diffKey]: { fileSections }
      }));
    }

    const section = diffSections()[diffKey];
    if (!section) return <div class="no-diff">Loading diff...</div>;

    return (
      <div class="diff-content">
        <For each={section.fileSections}>
          {(fileSection, fileIndex) => (
            <div class="diff-file-section">
              <div 
                class="diff-file-header" 
                onClick={() => toggleFileSection(diffKey, fileIndex())}
              >
                <div class="diff-file-info">
                  <div class="diff-file-toggle">
                    {fileSection.isExpanded ? '▼' : '►'}
                  </div>
                  <span class="diff-file-name">{fileSection.fileName}</span>
                  {fileSection.status === 'created' ? (
                    <span class="diff-file-status status-created">Created</span>
                  ) : fileSection.status === 'deleted' ? (
                    <span class="diff-file-status status-deleted">Deleted</span>
                  ) : fileSection.addedLines === 0 && fileSection.removedLines === 0 ? (
                    <span class="diff-file-status status-unchanged">Unchanged</span>
                  ) : (
                    <span class="diff-file-status status-modified">
                      <span class="removed-count">-{fileSection.removedLines}</span>
                      <span class="added-count">+{fileSection.addedLines}</span>
                    </span>
                  )}
                </div>
              </div>
              
              <Show when={fileSection.isExpanded}>
                <div class="diff-file-content">
                  <div class="diff-hunks">
                    <For each={fileSection.hunks}>
                      {(hunk, hunkIndex) => (
                        <div class="diff-hunk">
                          {renderHunk(hunk, diffKey, fileIndex(), hunkIndex(), fileSection)}
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
    );
  };

  // Rollback to the selected revision
  const rollbackToRevision = async () => {
    const index = selectedRevisionIndex();
    if (index === -1 || !props.resource) return;

    const selectedRevision = historyData()[index];
    if (!selectedRevision) return;

    const revisionNumber = selectedRevision.revision;
    const name = props.resource.metadata.name;
    const namespace = props.resource.metadata.namespace || "";

    // Confirm rollback
    if (canRollback() === false) {
      return;
    }
    if (!window.confirm(
      `Are you sure you want to rollback ${name} to revision ${revisionNumber}?`,
    )) {
      return;
    }

    try {
      // Call the backend API to rollback the release
      const url = `/api/helm/rollback/${namespace}/${name}/${revisionNumber}`;
      const response = await fetch(url, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Failed to rollback release: ${response.statusText}`);
      }

      // WebSocket will handle the updates automatically
    } catch (error) {
      console.error("Error rolling back release:", error);
      // Only show error messages, not success messages
      alert(
        `Failed to rollback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  // Helper function to refresh data based on the current tab
  const refreshTabData = () => {
    const currentTab = activeTab();
    if (currentTab === "history") {
      setupHistoryWatcher();
    } else if (currentTab === "values") {
      fetchReleaseValues();
    } else if (currentTab === "manifest") {
      fetchReleaseManifest();
    }
  };

  // Load data when the drawer opens or active tab changes
  createEffect(() => {
    if (props.isOpen) {
      if (activeTab() === "history") {
        setupHistoryWatcher();
      } else if (activeTab() === "values") {
        fetchReleaseValues();
      } else if (activeTab() === "manifest") {
        fetchReleaseManifest();
      }
    } else {
      // Clean up the subscription when drawer closes
      if (unsubscribeHistory) {
        unsubscribeHistory();
        unsubscribeHistory = null;
      }
    }
  });

  // Reload values when showAllValues changes
  createEffect(() => {
    if (props.isOpen && activeTab() === "values") {
      fetchReleaseValues();
    }
  });

  // Fetch manifest when selected revision changes
  createEffect(() => {
    if (
      props.isOpen && activeTab() === "manifest" &&
      selectedRevisionIndex() !== -1
    ) {
      fetchReleaseManifest();
    }
  });

  // Fetch the Helm release manifest for the selected revision
  const fetchReleaseManifest = async () => {
    if (!props.resource) return;

    setLoading(true);
    try {
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";

      // Get the revision number of the selected revision
      const index = selectedRevisionIndex();
      if (index === -1 || index >= historyData().length) {
        setManifestData("");
        return;
      }

      const revision = historyData()[index].revision;

      // Call the backend API for Helm release manifest
      const url =
        `/api/helm/manifest/${namespace}/${name}?revision=${revision}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Helm release manifest: ${response.statusText}`,
        );
      }

      const data = await response.json();
      setManifestData(data.manifest || "");
    } catch (error) {
      console.error("Error fetching Helm release manifest:", error);
      setManifestData(
        "Error fetching manifest: " +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setLoading(false);
      // Focus the content after loading
      setTimeout(() => contentRef?.focus(), 50);
    }
  };

  // Handle keyboard navigation in the history table
  const handleTableKeyDown = (e: KeyboardEvent) => {
    if (activeTab() !== "history" || historyData().length === 0) return;

    const currentIndex = selectedRevisionIndex();
    let newIndex = currentIndex;

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        newIndex = Math.max(0, currentIndex - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        newIndex = Math.min(historyData().length - 1, currentIndex + 1);
        break;
      case "Home":
        e.preventDefault();
        newIndex = 0;
        break;
      case "End":
        e.preventDefault();
        newIndex = historyData().length - 1;
        break;
      case "r":
        // Only handle Ctrl+R for rollback
        if (e.ctrlKey && currentIndex !== -1) {
          e.preventDefault();
          rollbackToRevision();
        }
        break;
    }

    if (newIndex !== currentIndex) {
      setSelectedRevisionIndex(newIndex);

      // Scroll the selected row into view
      setTimeout(() => {
        const rows = tableRef?.querySelectorAll("tbody tr");
        const targetRow = rows?.[newIndex * 2]; // Each revision has a data row and a diff row
        if (targetRow) {
          targetRow.scrollIntoView({ block: "nearest", behavior: "auto" });
        }
      }, 0);
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen) return;

    // Stop propagation to prevent ResourceList from handling these events
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }

    // Tab shortcuts
    if (e.key === "1" || e.key === "h") {
      e.preventDefault();
      setActiveTab("history");
    } else if (e.key === "2" || e.key === "v") {
      e.preventDefault();
      setActiveTab("values");
    } else if (e.key === "3" || e.key === "m") {
      e.preventDefault();
      setActiveTab("manifest");
    }

    // Handle table navigation
    if (activeTab() === "history") {
      handleTableKeyDown(e);
    }
  };

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    // Fetch data for the initial tab
    refreshTabData();
    
    // Prevent body scrolling when drawer is open
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
    }
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown, true);
    
    // Clean up history subscription if it exists
    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
    }
    
    // Restore body scrolling when drawer is closed or unmounted
    document.body.style.overflow = '';
  });

  // Watch for changes to the isOpen prop
  createEffect(() => {
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
      // Fetch data when the drawer opens
      refreshTabData();
    } else {
      document.body.style.overflow = '';
    }
  });

  // Function to get status color based on release status
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "deployed":
        return "var(--success-color)";
      case "failed":
        return "var(--error-color)";
      case "pending-install":
      case "pending-upgrade":
      case "pending-rollback":
        return "var(--warning-color)";
      case "superseded":
        return "var(--linear-text-tertiary)";
      default:
        return "var(--linear-text-secondary)";
    }
  };

  // Toggle function for showing all values
  const toggleShowAllValues = () => {
    setShowAllValues((prev) => !prev);
  };

  return (
    <Show when={props.isOpen}>
      <div class="resource-drawer-backdrop" onClick={props.onClose}>
        <div class="resource-drawer" onClick={(e) => e.stopPropagation()}>
          <div class="resource-drawer-header">
            <div class="drawer-title">
              Helm Release: {props.resource?.metadata.name}
            </div>
            <button class="drawer-close" onClick={props.onClose}>×</button>
          </div>

          <Tabs
            class="drawer-tabs"
            tabs={[
              { key: "history", label: "Release History" },
              { key: "values", label: "Values" },
              { key: "manifest", label: "Manifest" },
            ]}
            activeKey={activeTab()}
            onChange={(k) => setActiveTab(k as "history" | "values" | "manifest")}
            buttonClass="drawer-tab"
            activeClass="active"
          />

          <div
            class="drawer-content"
            ref={contentRef}
            tabIndex={0}
            style="outline: none;"
          >
            <Show when={loading()}>
              <div class="drawer-loading">Loading...</div>
            </Show>

            <Show when={!loading() && activeTab() === "history"}>
              <Show
                when={historyData().length > 0}
                fallback={
                  <div class="no-history">No release history found</div>
                }
              >
                <div
                  class="keyboard-shortcut-container"
                  style="display: flex; justify-content: flex-end; margin-bottom: 8px;"
                >
                  <div class="keyboard-shortcut">
                    <span class={`shortcut-key ${canRollback() === false ? 'disabled' : ''}`}>Ctrl+r</span>
                    <span class={`shortcut-description ${canRollback() === false ? 'disabled' : ''}`}>
                      Rollback to selected revision
                    </span>
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
                          <tr
                            class={selectedRevisionIndex() === index()
                              ? "selected-revision"
                              : ""}
                            onClick={() => setSelectedRevisionIndex(index())}
                          >
                            <td>{release.revision}</td>
                            <td>{release.updated}</td>
                            <td>
                              <span
                                style={{
                                  color: getStatusColor(release.status),
                                }}
                              >
                                {release.status}
                              </span>
                            </td>
                            <td>{release.chart}</td>
                            <td>{release.app_version}</td>
                            <td>{release.description}</td>
                          </tr>

                          {/* Add diff row between releases, except after the last one */}
                          <Show when={index() < historyData().length - 1}>
                            {(() => {
                              const nextRelease = historyData()[index() + 1];
                              const diffKey =
                                `${release.revision}-${nextRelease.revision}`;
                              const diffState = expandedDiffs()[diffKey] ||
                                { expanded: false, diffType: "values" };
                              const isExpanded = diffState.expanded;
                              const diffType = diffState.diffType;

                              return (
                                <>
                                  <tr class="diff-divider-row">
                                    <td colSpan={6} class="diff-divider-cell">
                                      <div class="diff-button-container">
                                        <div class="diff-button-group">
                                          <button
                                            class={`diff-button ${
                                              diffType === "values" &&
                                                isExpanded
                                                ? "active"
                                                : ""
                                            }`}
                                            onClick={() =>
                                              toggleDiff(
                                                nextRelease.revision,
                                                release.revision,
                                                "values",
                                              )}
                                            title={`${
                                              isExpanded &&
                                                diffType === "values"
                                                ? "Hide"
                                                : "Show"
                                            } values diff between revision ${release.revision} and ${nextRelease.revision}`}
                                          >
                                            Diff Values
                                          </button>
                                          <button
                                            class={`diff-button ${
                                              diffType === "manifest" &&
                                                isExpanded
                                                ? "active"
                                                : ""
                                            }`}
                                            onClick={() =>
                                              toggleDiff(
                                                nextRelease.revision,
                                                release.revision,
                                                "manifest",
                                              )}
                                            title={`${
                                              isExpanded &&
                                                diffType === "manifest"
                                                ? "Hide"
                                                : "Show"
                                            } manifest diff between revision ${release.revision} and ${nextRelease.revision}`}
                                          >
                                            Manifest
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>

                                  <Show when={isExpanded}>
                                    <tr class="diff-content-row">
                                      <td colSpan={6} class="diff-content-cell">
                                        <Show
                                          when={diffType === "values"
                                            ? diffData()[diffKey]
                                            : diffData()[`${diffKey}-manifest`]}
                                          fallback={
                                            <div class="drawer-loading">
                                              <div class="loading-spinner">
                                              </div>
                                              <div>
                                                Loading diff between revisions
                                                {" "}
                                                {nextRelease.revision} and{" "}
                                                {release.revision}...
                                              </div>
                                            </div>
                                          }
                                        >
                                          {(() => {
                                            if (diffType === "values") {
                                              const diff = diffData()[diffKey];
                                              return generateDiffView(
                                                diff.fromValues,
                                                diff.toValues,
                                                diffKey
                                              );
                                            } else {
                                              const diff =
                                                diffData()[
                                                  `${diffKey}-manifest`
                                                ];
                                              return generateManifestDiffView(
                                                diff.fromManifest,
                                                diff.toManifest,
                                                `${diffKey}-manifest`
                                              );
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

            <Show when={!loading() && activeTab() === "values"}>
              <div class="logs-controls">
                <div class="logs-options-row">
                  <div class="logs-follow-controls">
                    <label title="Show all values including defaults">
                      <input
                        type="checkbox"
                        checked={showAllValues()}
                        onChange={toggleShowAllValues}
                      />
                      Show all values (including defaults)
                    </label>
                  </div>
                </div>
              </div>
              <Show
                when={valuesData()}
                fallback={<div class="no-values">No values found</div>}
              >
                <pre class="yaml-content">{valuesData() ? stringify(valuesData()) : ""}</pre>
              </Show>
            </Show>

            <Show when={!loading() && activeTab() === "manifest"}>
              <Show
                when={manifestData()}
                fallback={<div class="no-manifest">No manifest found</div>}
              >
                <pre class="yaml-content">{manifestData()}</pre>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
