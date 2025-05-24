import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js";
import type { HelmRelease } from "../resourceList/HelmReleaseList.tsx";

export function HelmDrawer(props: {
  resource: HelmRelease;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [historyData, setHistoryData] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal<boolean>(true);
  
  let historyContentRef: HTMLDivElement | undefined;

  // Fetch the Helm release history when the drawer opens
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
      // Focus the history content after loading
      setTimeout(() => historyContentRef?.focus(), 50);
    }
  };

  // Load data when the drawer opens
  createEffect(() => {
    if (props.isOpen) {
      fetchReleaseHistory();
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

  return (
    <Show when={props.isOpen}>
      <div class="resource-drawer-backdrop" onClick={props.onClose}>
        <div class="resource-drawer" onClick={(e) => e.stopPropagation()}>
          <div class="resource-drawer-header">
            <div class="drawer-title">
              Helm Release History: {props.resource?.metadata.name}
            </div>
            <button class="drawer-close" onClick={props.onClose}>×</button>
          </div>
          
          <div class="drawer-content" ref={historyContentRef} tabIndex={0} style="outline: none; padding: 16px;">
            <Show when={loading()}>
              <div class="drawer-loading">Loading release history...</div>
            </Show>
            
            <Show when={!loading()}>
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
          </div>
        </div>
      </div>
    </Show>
  );
} 