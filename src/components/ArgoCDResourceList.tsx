import { For, createSignal, onMount } from "solid-js";
import type { ArgoCDApplication } from '../types/k8s.ts';
import { useNavigate } from "@solidjs/router";


export function ArgoCDResourceList(props: { 
  applications: ArgoCDApplication[]
}) {
  const navigate = useNavigate();
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        if (prev === -1) return 0; // Select the first row if none is selected
        return Math.min(prev + 1, props.applications.length - 1); // Move down
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        if (prev === -1) return 0; // Select the first row if none is selected
        return Math.max(prev - 1, 0); // Move up
      });
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  return (
    <div class="resource-list-container no-select">
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