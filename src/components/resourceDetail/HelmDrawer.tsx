import { createSignal, createEffect, Show, onMount, onCleanup, For } from "solid-js";
import type { HelmRelease } from "../resourceList/HelmReleaseList.tsx";
import { stringify } from "@std/yaml";

interface DiffState {
  [key: string]: boolean; // Maps revision pairs (e.g., "2-1") to expanded state
}

export function HelmDrawer(props: {
  resource: HelmRelease;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "history" | "values";
}) {
  const [historyData, setHistoryData] = createSignal<any[]>([]);
  const [valuesData, setValuesData] = createSignal<any>(null);
  const [activeTab, setActiveTab] = createSignal<"history" | "values">(props.initialTab || "history");
  const [loading, setLoading] = createSignal<boolean>(true);
  const [showAllValues, setShowAllValues] = createSignal<boolean>(false);
  const [expandedDiffs, setExpandedDiffs] = createSignal<DiffState>({});
  const [diffData, setDiffData] = createSignal<{[key: string]: any}>({});
  
  let contentRef: HTMLDivElement | undefined;

  // Watch for changes to initialTab prop
  createEffect(() => {
    if (props.initialTab) {
      setActiveTab(props.initialTab);
    }
  });

  // Fetch the Helm release history when the drawer opens and tab is history
  const fetchReleaseHistory = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";
      
      // Call the backend API for Helm release history data
      const url = `/api/helm/history/${namespace}/${name}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Helm release history: ${response.statusText}`);
      }
      
      const data = await response.json();
      // Sort releases by revision number in descending order (newest first)
      const sortedReleases = (data.releases || []).sort((a: any, b: any) => b.revision - a.revision);
      setHistoryData(sortedReleases);
    } catch (error) {
      console.error("Error fetching Helm release history:", error);
      setHistoryData([]);
    } finally {
      setLoading(false);
      // Focus the content after loading
      setTimeout(() => contentRef?.focus(), 50);
    }
  };

  // Fetch the Helm release values when the drawer opens and tab is values
  const fetchReleaseValues = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";
      
      // Call the backend API for Helm release values data
      const url = `/api/helm/values/${namespace}/${name}?allValues=${showAllValues()}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Helm release values: ${response.statusText}`);
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
  const fetchReleaseValuesDiff = async (fromRevision: number, toRevision: number) => {
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
      const url1 = `/api/helm/values/${namespace}/${name}?revision=${fromRevision}`;
      const response1 = await fetch(url1);
      
      if (!response1.ok) {
        throw new Error(`Failed to fetch values for revision ${fromRevision}: ${response1.statusText}`);
      }
      
      // Get values for the second revision
      const url2 = `/api/helm/values/${namespace}/${name}?revision=${toRevision}`;
      const response2 = await fetch(url2);
      
      if (!response2.ok) {
        throw new Error(`Failed to fetch values for revision ${toRevision}: ${response2.statusText}`);
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
      console.error(`Error fetching diff between revisions ${fromRevision} and ${toRevision}:`, error);
      return null;
    }
  };

  // Toggle the expanded state of a diff section
  const toggleDiff = async (fromRevision: number, toRevision: number) => {
    const diffKey = `${toRevision}-${fromRevision}`;
    const isExpanded = !!expandedDiffs()[diffKey];
    
    // Toggle the expanded state
    const newExpandedDiffs = { ...expandedDiffs() };
    newExpandedDiffs[diffKey] = !isExpanded;
    setExpandedDiffs(newExpandedDiffs);
    
    // Only fetch the diff data when expanding
    if (!isExpanded && !diffData()[diffKey]) {
      await fetchReleaseValuesDiff(fromRevision, toRevision);
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
    const fromLines = fromYaml.split('\n');
    const toLines = toYaml.split('\n');
    
    // Simple line-by-line diff algorithm
    const diff = generatePatchDiff(fromLines, toLines);
    
    return (
      <div class="diff-content patch-diff">
        <pre class="diff-patch">
          {diff.map(line => {
            let className = '';
            if (line.startsWith('+')) {
              className = 'diff-line-added';
            } else if (line.startsWith('-')) {
              className = 'diff-line-removed';
            } else if (line.startsWith('@')) {
              className = 'diff-line-info';
            }
            return <div class={className}>{line}</div>;
          })}
        </pre>
      </div>
    );
  };
  
  // Generate a patch-style diff between two arrays of lines
  const generatePatchDiff = (oldLines: string[], newLines: string[]): string[] => {
    const result: string[] = [];
    
    // Add a header
    result.push('--- Previous Values');
    result.push('+++ Current Values');
    
    let oldIndex = 0;
    let newIndex = 0;
    
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      // Find a sequence of matching lines
      let matchStart = -1;
      let matchLength = 0;
      let bestMatchLength = 0;
      let bestMatchOldIndex = -1;
      let bestMatchNewIndex = -1;
      
      // Look for the longest matching sequence
      for (let i = oldIndex; i < oldLines.length; i++) {
        for (let j = newIndex; j < newLines.length; j++) {
          // Count matching lines
          matchLength = 0;
          while (i + matchLength < oldLines.length && 
                 j + matchLength < newLines.length && 
                 oldLines[i + matchLength] === newLines[j + matchLength]) {
            matchLength++;
          }
          
          // If this is a better match than what we've found so far
          if (matchLength > bestMatchLength) {
            bestMatchLength = matchLength;
            bestMatchOldIndex = i;
            bestMatchNewIndex = j;
          }
        }
      }
      
      // If we found a matching sequence
      if (bestMatchLength > 0) {
        // Output unmatched lines from both old and new
        if (oldIndex < bestMatchOldIndex) {
          // Add hunk header
          result.push(`@@ -${oldIndex + 1},${bestMatchOldIndex - oldIndex} +${newIndex + 1},${bestMatchNewIndex - newIndex} @@`);
          
          // Output removed lines
          for (let i = oldIndex; i < bestMatchOldIndex; i++) {
            result.push(`-${oldLines[i]}`);
          }
          
          // Output added lines
          for (let j = newIndex; j < bestMatchNewIndex; j++) {
            result.push(`+${newLines[j]}`);
          }
        }
        
        // Output the context (matching lines)
        const contextStart = Math.max(0, bestMatchOldIndex);
        const contextEnd = Math.min(oldLines.length, bestMatchOldIndex + bestMatchLength);
        
        // Only show context if there's actually a difference
        if (oldIndex < bestMatchOldIndex || newIndex < bestMatchNewIndex) {
          result.push(`@@ -${contextStart + 1},${contextEnd - contextStart} +${bestMatchNewIndex + 1},${bestMatchLength} @@`);
          
          // Add a few lines of context (up to 3)
          const contextLinesToShow = Math.min(3, bestMatchLength);
          for (let i = 0; i < contextLinesToShow; i++) {
            result.push(` ${oldLines[bestMatchOldIndex + i]}`);
          }
          
          // If there are more context lines, add an ellipsis
          if (bestMatchLength > contextLinesToShow) {
            result.push(' ...');
          }
        }
        
        // Move indices past this match
        oldIndex = bestMatchOldIndex + bestMatchLength;
        newIndex = bestMatchNewIndex + bestMatchLength;
      } else {
        // No more matches, output remaining lines
        if (oldIndex < oldLines.length || newIndex < newLines.length) {
          result.push(`@@ -${oldIndex + 1},${oldLines.length - oldIndex} +${newIndex + 1},${newLines.length - newIndex} @@`);
          
          // Output remaining removed lines
          for (let i = oldIndex; i < oldLines.length; i++) {
            result.push(`-${oldLines[i]}`);
          }
          
          // Output remaining added lines
          for (let j = newIndex; j < newLines.length; j++) {
            result.push(`+${newLines[j]}`);
          }
        }
        
        // Break out of the loop
        break;
      }
    }
    
    return result;
  };

  // Load data when the drawer opens or active tab changes
  createEffect(() => {
    if (props.isOpen) {
      if (activeTab() === "history") {
        fetchReleaseHistory();
      } else if (activeTab() === "values") {
        fetchReleaseValues();
      }
    }
  });
  
  // Reload values when showAllValues changes
  createEffect(() => {
    if (props.isOpen && activeTab() === "values") {
      fetchReleaseValues();
    }
  });

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
    }
  };

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown, true);
  });

  // Clean up event listener
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown, true);
  });

  // Function to get status color based on release status
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'deployed':
        return 'var(--success-color)';
      case 'failed':
        return 'var(--error-color)';
      case 'pending-install':
      case 'pending-upgrade':
      case 'pending-rollback':
        return 'var(--warning-color)';
      case 'superseded':
        return 'var(--linear-text-tertiary)';
      default:
        return 'var(--linear-text-secondary)';
    }
  };

  // Toggle function for showing all values
  const toggleShowAllValues = () => {
    setShowAllValues(prev => !prev);
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
          </div>
          
          <div class="drawer-content" ref={contentRef} tabIndex={0} style="outline: none;">
            <Show when={loading()}>
              <div class="drawer-loading">Loading...</div>
            </Show>
            
            <Show when={!loading() && activeTab() === "history"}>
              <Show when={historyData().length > 0} fallback={<div class="no-history">No release history found</div>}>
                <table class="helm-history-table">
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
                          <tr>
                            <td>{release.revision}</td>
                            <td>{release.updated}</td>
                            <td>
                              <span style={{ color: getStatusColor(release.status) }}>
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
                              const diffKey = `${release.revision}-${nextRelease.revision}`;
                              const isExpanded = !!expandedDiffs()[diffKey];
                              
                              return (
                                <>
                                  <tr class="diff-divider-row">
                                    <td colSpan={6} class="diff-divider-cell">
                                      <div class="diff-button-container">
                                        <button 
                                          class="diff-button"
                                          onClick={() => toggleDiff(nextRelease.revision, release.revision)}
                                          title={`${isExpanded ? "Hide" : "Show"} diff between revision ${release.revision} and ${nextRelease.revision}`}
                                        >
                                          {isExpanded ? "Hide Diff" : "Diff"}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  
                                  <Show when={isExpanded}>
                                    <tr class="diff-content-row">
                                      <td colSpan={6} class="diff-content-cell">
                                        <Show 
                                          when={diffData()[diffKey]}
                                          fallback={
                                            <div class="drawer-loading">
                                              <div class="loading-spinner"></div>
                                              <div>Loading diff between revisions {nextRelease.revision} and {release.revision}...</div>
                                            </div>
                                          }
                                        >
                                          {(() => {
                                            const diff = diffData()[diffKey];
                                            return generateDiffView(diff.fromValues, diff.toValues);
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
              <Show when={valuesData()} fallback={<div class="no-values">No values found</div>}>
                <pre class="yaml-content">{valuesData() ? stringify(valuesData()) : ""}</pre>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
} 