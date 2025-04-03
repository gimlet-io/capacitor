import { For } from "solid-js/web";
import type { Deployment } from '../types/k8s.ts';

export function DeploymentList(props: { deployments: Deployment[] }) {
  return (
    <div class="resource-list">
      <For each={props.deployments}>
        {(deployment) => (
          <div class="resource-item deployment-item">
            <h3>{deployment.metadata.namespace}/{deployment.metadata.name}</h3>
            <p>Replicas: {deployment.status.readyReplicas || 0}/{deployment.spec.replicas || 0}</p>
            <details>
              <summary>Labels</summary>
              <pre>{JSON.stringify(deployment.spec.selector.matchLabels, null, 2)}</pre>
            </details>
          </div>
        )}
      </For>
    </div>
  );
}
