import { For, createSignal, onMount, onCleanup, createEffect } from "solid-js";
import type { Pod } from '../types/k8s.ts';

export function PodList(props: { 
  pods: Pod[]
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.pods.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, props.pods.length - 1);
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

  return (
    <div class="resource-list-container" ref={setListContainer}>
      <table class="resource-table">
        <thead>
          <tr>
            <th style="width: 30%">NAME</th>
            <th style="width: 10%">READY</th>
            <th style="width: 10%">STATUS</th>
            <th style="width: 10%">RESTARTS</th>
            <th style="width: 10%">AGE</th>
            <th style="width: 15%">IP</th>
            <th style="width: 15%">NODE</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.pods}>
            {(pod, index) => (
              <tr class={selectedIndex() === index() ? 'selected' : ''}>
                <td title={pod.metadata.namespace + '/' + pod.metadata.name}>
                  {pod.metadata.namespace}/{pod.metadata.name}
                </td>
                <td>
                  {pod.status.containerStatuses?.filter(cs => cs.ready).length || 0}/
                  {pod.spec.containers.length}
                </td>
                <td>{pod.status.phase}</td>
                <td>
                  {pod.status.containerStatuses?.reduce((acc, cs) => acc + (cs.restartCount || 0), 0) || 0}
                </td>
                <td>
                  {(() => {
                    if (!pod.status.startTime) return 'N/A';
                    const startTime = new Date(pod.status.startTime);
                    const now = new Date();
                    const diff = now.getTime() - startTime.getTime();
                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    
                    if (days > 0) {
                      return `${days}d${hours}h`;
                    } else if (hours > 0) {
                      return `${hours}h${minutes}m`;
                    } else {
                      return `${minutes}m`;
                    }
                  })()}
                </td>
                <td>{pod.status.podIP}</td>
                <td>{pod.spec.nodeName}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
