import { For, createSignal, onMount, onCleanup, createEffect } from "solid-js";
import type { ArgoCDApplication } from '../types/k8s.ts';
import { useNavigate } from "@solidjs/router";


export function ArgoCDResourceList(props: { 
  applications: ArgoCDApplication[]
}) {
  const navigate = useNavigate();
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.applications.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, props.applications.length - 1);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 1, 0);
        return newIndex;
      });
    } else if (e.key === 'Enter') {
      const index = selectedIndex();
      if (index !== -1 && index < props.applications.length) {
        const application = props.applications[index];
        navigate(`/application/${application.metadata.namespace}/${application.metadata.name}`);
      }
    }
  };

  // Scroll selected item into view whenever selectedIndex changes
  createEffect(() => {
    const index = selectedIndex();
    if (index === -1) return;
    
    // Use requestAnimationFrame to ensure the DOM is updated before scrolling
    requestAnimationFrame(() => {
      const container = listContainer();
      if (!container) return;
      
      // Each application has 2 rows, so we need to find the first row of the current item
      const mainRows = container.querySelectorAll('tbody tr:nth-child(2n+1)');
      if (index >= 0 && index < mainRows.length) {
        const selectedRow = mainRows[index];
        
        // Calculate if element is in view
        const containerRect = container.getBoundingClientRect();
        const rowRect = selectedRow.getBoundingClientRect();
        
        // Check if the element is not fully visible
        if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
          // Use scrollIntoView with block: 'nearest' for smoother scrolling
          selectedRow.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      }
    });
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class="resource-list-container no-select" ref={setListContainer}>
      <table class="resource-table">
        <thead>
          <tr>
            <th style="width: 30%">NAME</th>
            <th style="width: 20%">STATUS</th>
            <th style="width: 20%">HEALTH</th>
            <th style="width: 10%">AGE</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.applications}>
            {(application, index) => {
              const syncStatus = application.status?.sync?.status || 'Unknown';
              const healthStatus = application.status?.health?.status || 'Unknown';

              return (
              <>
                <tr 
                  class={selectedIndex() === index() ? 'selected' : ''} 
                  onClick={() => navigate(`/application/${application.metadata.namespace}/${application.metadata.name}`)}
                >
                  <td title={application.metadata.name}>
                    {application.metadata.name}
                  </td>
                  <td>
                    <span class={`status-badge sync-${syncStatus.toLowerCase()}`}>
                      {syncStatus}
                    </span>
                  </td>
                  <td>
                    <span class={`status-badge health-${healthStatus.toLowerCase()}`}>
                      {healthStatus}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      if (!application.metadata.creationTimestamp) return 'N/A';
                      const startTime = new Date(application.metadata.creationTimestamp);
                      const now = new Date();
                      const diff = now.getTime() - startTime.getTime();
                      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                      return days > 0 ? `${days}d${hours}h` : `${hours}h`;
                    })()}
                  </td>
                </tr>
                <tr class={selectedIndex() === index() ? 'selected' : ''}>
                  <td colSpan={4}>
                    <div class="second-row">
                      <strong>Source:</strong> {application.spec.source.repoURL} <br />
                      <strong>Path:</strong> {application.spec.source.path} <br />
                      <strong>Revision:</strong> {application.status?.sync.revision}
                    </div>
                  </td>
                </tr>
              </>
            )}}
          </For>
        </tbody>
      </table>
    </div>
  );
} 