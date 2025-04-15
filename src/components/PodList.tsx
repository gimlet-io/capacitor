import { For, createSignal, onMount } from "solid-js";
import type { Pod } from '../types/k8s.ts';

export function PodList(props: { 
  pods: Pod[]
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        if (prev === -1) return 0;
        return Math.min(prev + 1, props.pods.length - 1);
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        if (prev === -1) return 0;
        return Math.max(prev - 1, 0);
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
    <div class="resource-list-container">
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
