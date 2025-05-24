import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js";
import type { HelmRelease } from "../resourceList/HelmReleaseList.tsx";
import { stringify } from "@std/yaml";

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
      setHistoryData(data.releases || []);
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
                    {historyData().map((release) => (
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
                    ))}
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