import { For } from "solid-js/web";
import type { Pod } from '../types/k8s.ts';

export function PodList(props: { 
  pods: Pod[]
}) {
  return (
    <div class="resource-list">
      <For each={props.pods}>
        {(pod) => (
          <div class="resource-item pod-item">
            <h2>Pod: {pod.metadata.namespace}/{pod.metadata.name}</h2>
            <p>Status: {pod.status.phase}</p>
            <p>Node: {pod.spec.nodeName}</p>
            
            <details>
              <summary>Pod Labels</summary>
              <div class="selectors">
                <For each={Object.entries(pod.metadata.labels || {})}>
                  {([key, value]) => (
                    <div>{key}: {value}</div>
                  )}
                </For>
              </div>
            </details>

            <details>
              <summary>Containers</summary>
              <For each={pod.spec.containers}>
                {(container) => (
                  <div>
                    <p>Name: {container.name}</p>
                    <p>Image: {container.image}</p>
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
