// deno-lint-ignore-file jsx-button-has-type
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { HelmRelease } from "../resourceList/HelmReleaseList.tsx";
import { stringify } from "@std/yaml";
import { getWebSocketClient } from "../../k8sWebSocketClient.ts";

interface RevisionPair {
  expanded: boolean;
  diffType: "values" | "manifest";
}

interface DiffState {
  [key: string]: RevisionPair; // Maps revision pairs (e.g., "2-1") to their expansion state and diff type
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
  const [expandedDiffs, setExpandedDiffs] = createSignal<DiffState>({});
  const [diffData, setDiffData] = createSignal<{ [key: string]: any }>({});
  const [selectedRevisionIndex, setSelectedRevisionIndex] = createSignal<
    number
  >(-1);

  let contentRef: HTMLDivElement | undefined;
  let tableRef: HTMLTableElement | undefined;
  let unsubscribeHistory: (() => void) | null = null;

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

  // Generate a patch-style diff view between two objects
  const generateDiffView = (fromValues: any, toValues: any) => {
    // Convert objects to YAML for comparison
    const fromYaml = stringify(fromValues);
    const toYaml = stringify(toValues);

    if (fromYaml === toYaml) {
      return <div class="no-diff">No differences found in values</div>;
    }

    // Convert YAML to lines
    const fromLines = fromYaml.split("\n");
    const toLines = toYaml.split("\n");

    // Create a state variable to track which sections are expanded
    const [expandedSections, setExpandedSections] = createSignal<Record<string, boolean>>({});
    // Create a state for the diff content
    const [diffContent, setDiffContent] = createSignal<string[]>([]);

    // Generate initial diff
    createEffect(() => {
      // Regenerate diff whenever expandedSections changes
      const expanded = expandedSections();
      setDiffContent(generatePatchDiff(fromLines, toLines, expanded));
    });

    // Handler for expand button clicks
    const handleExpandClick = (e: MouseEvent, sectionId: string) => {
      e.preventDefault();
      // Update expanded sections state, which will trigger diff regeneration
      setExpandedSections(prev => ({...prev, [sectionId]: true}));
    };

    return (
      <div class="diff-content patch-diff">
        <pre class="diff-patch">
          {diffContent().map((line: string) => {
            let className = '';
            if (line.startsWith('+')) {
              className = 'diff-line-added';
            } else if (line.startsWith('-')) {
              className = 'diff-line-removed';
            } else if (line.startsWith('@')) {
              className = 'diff-line-info';
            }
            
            // Check if this line has an expand button
            const expandButtonMatch = line.match(/ \.\.\. <button class="expand-context" data-id="([^"]+)" data-section="([^"]+)" data-direction="([^"]+)">([^<]+)<\/button>/);
            
            if (expandButtonMatch) {
              const [_, buttonId, sectionId, direction, buttonText] = expandButtonMatch;
              const expanded = expandedSections()[sectionId];
              
              return (
                <div class={className}>
                  <button
                    class="expand-context" 
                    disabled={expanded}
                    onClick={(e) => handleExpandClick(e, sectionId)}
                  >
                    {expanded ? "Expanded" : "..."}
                  </button>
                </div>
              );
            }
            
            return <div class={className}>{line}</div>;
          })}
        </pre>
      </div>
    );
  };

  // Generate a patch-style diff between two strings (for manifests)
  const generateManifestDiffView = (
    fromManifest: string,
    toManifest: string,
  ) => {
    if (fromManifest === toManifest) {
      return <div class="no-diff">No differences found in manifests</div>;
    }

    // Convert manifests to lines
    const fromLines = fromManifest.split("\n");
    const toLines = toManifest.split("\n");

    // Create a state variable to track which sections are expanded
    const [expandedSections, setExpandedSections] = createSignal<Record<string, boolean>>({});
    // Create a state for the diff content
    const [diffContent, setDiffContent] = createSignal<string[]>([]);

    // Generate initial diff
    createEffect(() => {
      // Regenerate diff whenever expandedSections changes
      const expanded = expandedSections();
      setDiffContent(generatePatchDiff(fromLines, toLines, expanded));
    });

    // Handler for expand button clicks
    const handleExpandClick = (e: MouseEvent, sectionId: string) => {
      e.preventDefault();
      // Update expanded sections state, which will trigger diff regeneration
      setExpandedSections(prev => ({...prev, [sectionId]: true}));
    };

    return (
      <div class="diff-content patch-diff">
        <pre class="diff-patch">
          {diffContent().map((line: string) => {
            let className = '';
            if (line.startsWith('+')) {
              className = 'diff-line-added';
            } else if (line.startsWith('-')) {
              className = 'diff-line-removed';
            } else if (line.startsWith('@')) {
              className = 'diff-line-info';
            }
            
            // Check if this line has an expand button
            const expandButtonMatch = line.match(/ \.\.\. <button class="expand-context" data-id="([^"]+)" data-section="([^"]+)" data-direction="([^"]+)">([^<]+)<\/button>/);
            
            if (expandButtonMatch) {
              const [_, buttonId, sectionId, direction, buttonText] = expandButtonMatch;
              const expanded = expandedSections()[sectionId];
              
              return (
                <div class={className}>
                  ... <button 
                    class="expand-context" 
                    disabled={expanded}
                    onClick={(e) => handleExpandClick(e, sectionId)}
                  >
                    {expanded ? "Expanded" : "Show 10 more lines"}
                  </button>
                </div>
              );
            }
            
            return <div class={className}>{line}</div>;
          })}
        </pre>
      </div>
    );
  };

  // Modify the generatePatchDiff function to accept expanded sections
  const generatePatchDiff = (
    oldLines: string[],
    newLines: string[],
    expandedSections: Record<string, boolean> = {},
  ): string[] => {
    const result: string[] = [];
    
    let oldIndex = 0;
    let newIndex = 0;
    
    // Helper function to add context lines
    const addContextLines = (startOld: number, startNew: number, count: number, showExpander: boolean, sectionId: string) => {
      // Determine how many lines to show based on whether this section is expanded
      const isExpanded = expandedSections[sectionId];
      const baseContextLines = Math.min(count, 3); // Default is 3 lines
      const contextLines = isExpanded ? Math.min(count, 13) : baseContextLines; // Show up to 13 if expanded
      
      const hasMoreContext = (startOld + contextLines < oldLines.length) && showExpander && !isExpanded;
      
      // For "before" context, add the expander button first
      if (hasMoreContext && sectionId.startsWith('before')) {
        const expanderId = `expand-${sectionId}`;
        result.push(` ... <button class="expand-context" data-id="${expanderId}" data-section="${sectionId}" data-direction="before">Show 10 more lines</button>`);
      }
      
      // Add the context lines
      for (let i = 0; i < contextLines && (startOld + i < oldLines.length); i++) {
        if (startNew + i < newLines.length) {
          result.push(` ${oldLines[startOld + i]}`);
        }
      }
      
      // For "after" context, add the expander button after
      if (hasMoreContext && !sectionId.startsWith('before')) {
        const expanderId = `expand-${sectionId}`;
        result.push(` ... <button class="expand-context" data-id="${expanderId}" data-section="${sectionId}" data-direction="after">Show 10 more lines</button>`);
      }
    };
    
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      // Find how many lines match from current positions
      let matchLength = 0;
      while (
        oldIndex + matchLength < oldLines.length &&
        newIndex + matchLength < newLines.length &&
        oldLines[oldIndex + matchLength] === newLines[newIndex + matchLength]
      ) {
        matchLength++;
      }
      
      if (matchLength > 0) {
        // Skip common sections, but keep track of where we are
        oldIndex += matchLength;
        newIndex += matchLength;
      } else {
        // No match at current position - find next match
        let nextOldMatch = oldIndex;
        let nextNewMatch = newIndex;
        let found = false;
        
        // Look ahead for the next matching line
        outer: for (let i = oldIndex; i < oldLines.length; i++) {
          for (let j = newIndex; j < newLines.length; j++) {
            if (oldLines[i] === newLines[j]) {
              // Check if this is the start of a sequence of at least 3 matching lines
              let seqLength = 1;
              while (
                i + seqLength < oldLines.length &&
                j + seqLength < newLines.length &&
                oldLines[i + seqLength] === newLines[j + seqLength] &&
                seqLength < 3
              ) {
                seqLength++;
              }
              
              // Only consider it a match if we have at least 3 consecutive matching lines
              // or if we're at the end of one of the files
              if (seqLength >= 3 || i + seqLength >= oldLines.length || j + seqLength >= newLines.length) {
                nextOldMatch = i;
                nextNewMatch = j;
                found = true;
                break outer;
              }
            }
          }
        }
        
        // If no next match found, include all remaining lines
        if (!found) {
          nextOldMatch = oldLines.length;
          nextNewMatch = newLines.length;
        }
        
        // Only output a diff hunk if there are changes
        if (nextOldMatch > oldIndex || nextNewMatch > newIndex) {
          // Generate a unique ID for this diff section
          const diffId = `diff-${oldIndex}-${newIndex}`;
          
          // Get context before the change (up to 3 lines by default, more if expanded)
          const beforeId = `before-${diffId}`;
          const isBeforeExpanded = expandedSections[beforeId];
          const contextBefore = Math.min(isBeforeExpanded ? 13 : 3, oldIndex);
          const oldStart = Math.max(0, oldIndex - contextBefore);
          const newStart = Math.max(0, newIndex - contextBefore);
          
          // Calculate context after (for header line)
          const afterId = `after-${diffId}`;
          const isAfterExpanded = expandedSections[afterId];
          const contextAfter = Math.min(isAfterExpanded ? 13 : 3, oldLines.length - nextOldMatch);
          
          // Output hunk header with proper line counts
          result.push(`@@ -${oldStart + 1},${nextOldMatch - oldStart + contextAfter} +${newStart + 1},${nextNewMatch - newStart + contextAfter} @@`);
          
          // Add context before with expander
          if (contextBefore > 0) {
            addContextLines(oldIndex - contextBefore, newIndex - contextBefore, contextBefore, oldStart > 0, beforeId);
          }
          
          // Output removed lines
          for (let i = oldIndex; i < nextOldMatch; i++) {
            result.push(`-${oldLines[i]}`);
          }
          
          // Output added lines
          for (let j = newIndex; j < nextNewMatch; j++) {
            result.push(`+${newLines[j]}`);
          }
          
          // Add context after with expander
          addContextLines(nextOldMatch, nextNewMatch, contextAfter, nextOldMatch < oldLines.length, afterId);
          
          // Move to the next match positions
          oldIndex = nextOldMatch;
          newIndex = nextNewMatch;
        }
      }
    }
    
    return result;
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
    if (
      !window.confirm(
        `Are you sure you want to rollback ${name} to revision ${revisionNumber}?`,
      )
    ) {
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
    window.addEventListener("keydown", handleKeyDown, true);
  });

  // Clean up event listener and subscriptions
  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown, true);

    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
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

          <div class="drawer-tabs">
            <button
              class={`drawer-tab ${activeTab() === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              Release History
            </button>
            <button
              class={`drawer-tab ${activeTab() === "values" ? "active" : ""}`}
              onClick={() => setActiveTab("values")}
            >
              Values
            </button>
            <button
              class={`drawer-tab ${activeTab() === "manifest" ? "active" : ""}`}
              onClick={() => setActiveTab("manifest")}
            >
              Manifest
            </button>
          </div>

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
                    <span class="shortcut-key">Ctrl+r</span>
                    <span class="shortcut-description">
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
                                              );
                                            } else {
                                              const diff =
                                                diffData()[
                                                  `${diffKey}-manifest`
                                                ];
                                              return generateManifestDiffView(
                                                diff.fromManifest,
                                                diff.toManifest,
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
