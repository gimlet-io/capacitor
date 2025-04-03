import { For } from "solid-js/web";
import type { Deployment, Pod, Container } from '../types/k8s.ts';
import { getDeploymentMatchingPods } from '../utils/k8s.ts';

export function DeploymentList(props: { 
  deployments: Deployment[],
  pods: Pod[]
}) {
  return (
    <div class="resource-list">
      <For each={props.deployments}>
        {(deployment: Deployment) => {
          const matchingPods = getDeploymentMatchingPods(deployment, props.pods);
          return (
            <div class="resource-item deployment-item">
              <h2>Deployment: {deployment.metadata.namespace}/{deployment.metadata.name}</h2>
              <p>Replicas: {deployment.spec.replicas}</p>
              <p>Available: {deployment.status.availableReplicas}</p>
              
              <details>
                <summary>Deployment Labels</summary>
                <div class="selectors">
                  <For each={Object.entries(deployment.metadata.labels || {})}>
                    {([key, value]: [string, string]) => (
                      <div>{key}: {value}</div>
                    )}
                  </For>
                </div>
              </details>

              <details>
                <summary>Template Labels</summary>
                <div class="selectors">
                  <For each={Object.entries(deployment.spec.template.metadata.labels || {})}>
                    {([key, value]: [string, string]) => (
                      <div>{key}: {value}</div>
                    )}
                  </For>
                </div>
              </details>

              <details>
                <summary>Matching Pods ({matchingPods.length})</summary>
                <For each={matchingPods}>
                  {(pod: Pod) => (
                    <div class="pod-item">
                      <p>Name: {pod.metadata.name}</p>
                      <p>Status: {pod.status.phase}</p>
                      <p>Node: {pod.spec.nodeName}</p>
                      <details>
                        <summary>Pod Labels</summary>
                        <div class="selectors">
                          <For each={Object.entries(pod.metadata.labels || {})}>
                            {([key, value]: [string, string]) => (
                              <div>{key}: {value}</div>
                            )}
                          </For>
                        </div>
                      </details>
                      <details>
                        <summary>Containers</summary>
                        <For each={pod.spec.containers}>
                          {(container: Container) => (
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
              </details>
            </div>
          );
        }}
      </For>
    </div>
  );
}
