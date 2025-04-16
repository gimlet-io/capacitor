import { For, createSignal, onMount, onCleanup, createEffect } from "solid-js";
import type { DeploymentWithResources } from '../types/k8s.ts';

export function DeploymentList(props: { 
  deployments: DeploymentWithResources[]
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.deployments.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, props.deployments.length - 1);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 1, 0);
        return newIndex;
      });
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
      
      const rows = container.querySelectorAll('tbody tr');
      if (index >= 0 && index < rows.length) {
        const selectedRow = rows[index];
        
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

  const getPodColor = (status: string) => {
    switch (status) {
      case 'Running':
        return 'var(--linear-green)';
      case 'Pending':
        return 'var(--linear-yellow)';
      case 'Failed':
        return 'var(--linear-red)';
      default:
        return 'var(--linear-gray)';
    }
  };

  return (
    <div class="resource-list-container" ref={setListContainer}>
      <table class="resource-table">
        <thead>
          <tr>
            <th style="width: 30%">NAME</th>
            <th style="width: 10%">READY</th>
            <th style="width: 10%">PODS</th>
            <th style="width: 10%">UP-TO-DATE</th>
            <th style="width: 10%">AVAILABLE</th>
            <th style="width: 10%">AGE</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.deployments}>
            {(deployment, index) => (
              <tr class={selectedIndex() === index() ? 'selected' : ''}>
                <td title={deployment.metadata.name}>
                  {deployment.metadata.name}
                </td>
                <td>
                  {deployment.status.readyReplicas || 0}/
                  {deployment.spec.replicas}
                </td>
                <td>
                  <For each={deployment.pods}>
                    {(pod) => (
                      <span 
                        title={pod.metadata.name} 
                        style={{
                          "display": 'inline-block',
                          "width": '10px',
                          "height": '10px',
                          "border-radius": '5%',
                          "background-color": getPodColor(pod.status.phase),
                          "margin": '0 2px'
                        } as any} 
                      >
                      </span>
                    )}
                  </For>
                </td>
                <td>{deployment.status.updatedReplicas || 0}</td>
                <td>{deployment.status.availableReplicas || 0}</td>
                <td>
                  {(() => {
                    if (!deployment.metadata.creationTimestamp) return 'N/A';
                    const startTime = new Date(deployment.metadata.creationTimestamp);
                    const now = new Date();
                    const diff = now.getTime() - startTime.getTime();
                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    return days > 0 ? `${days}d${hours}h` : `${hours}h`;
                  })()}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
