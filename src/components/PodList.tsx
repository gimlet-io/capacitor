import { For } from "solid-js/web";
import type { Pod } from '../types/k8s.ts';

export function PodList(props: { pods: Pod[] }) {
  return (
    <div class="resource-list">
      <For each={props.pods}>
        {(pod) => (
          <div class="resource-item pod-item">
            <h3>{pod.metadata.namespace}/{pod.metadata.name}</h3>
            <p class={`status-${pod.status.phase}`}>Status: {pod.status.phase}</p>
            <p>Node: {pod.spec.nodeName || 'Not assigned'}</p>
            <p>Pod IP: {pod.status.podIP || 'No IP'}</p>
            <details>
              <summary>Containers ({pod.spec.containers.length})</summary>
              <For each={pod.spec.containers}>
                {(container) => (
                  <div>
                    <strong>{container.name}</strong>: {container.image}
                  </div>
                )}
              </For>
            </details>
          </div>
        )}
      </For>
    </div>
  );
}
