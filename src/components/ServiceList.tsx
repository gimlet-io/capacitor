import { For } from "solid-js/web";
import type { Service, Pod, Deployment } from '../types/k8s.ts';

export function ServiceList(props: { 
  services: Service[],
  pods: Pod[],
  deployments: Deployment[]
}) {
  return (
    <div class="resource-list">
      <For each={props.services}>
        {(service) => {
          // Find pods that match the service's selectors
          const matchingPods = props.pods.filter(pod => {
            if (!service.spec.selector) return false;
            return Object.entries(service.spec.selector).every(([key, value]) => 
              pod.metadata.labels?.[key] === value
            );
          });

          // Find deployments that match the service's selectors
          const matchingDeployments = props.deployments.filter(deployment => {
            if (!service.spec.selector) return false;
            return Object.entries(service.spec.selector).every(([key, value]) => 
              deployment.spec.template.metadata.labels?.[key] === value
            );
          });
          
          console.log('Service:', service.metadata.name, {
            pods: props.pods,
            deployments: props.deployments,
          });

          return (
            <div class="resource-item service-item">
              <h3>{service.metadata.namespace}/{service.metadata.name}</h3>
              <p>Type: {service.spec.type || 'ClusterIP'}</p>
              <p>Cluster IP: {service.spec.clusterIP || 'None'}</p>
              
              <details>
                <summary>Service Selectors</summary>
                <div class="selectors">
                  {service.spec.selector ? (
                    <For each={Object.entries(service.spec.selector)}>
                      {([key, value]) => (
                        <div>{key}: {value}</div>
                      )}
                    </For>
                  ) : (
                    <div>No selectors defined</div>
                  )}
                </div>
              </details>

              <details>
                <summary>Ports</summary>
                <For each={service.spec.ports}>
                  {(port) => (
                    <div>
                      {port.name && <strong>{port.name}: </strong>}
                      {port.port}{port.targetPort ? ` → ${port.targetPort}` : ''}
                      {port.nodePort ? ` (NodePort: ${port.nodePort})` : ''}
                    </div>
                  )}
                </For>
              </details>

              <details>
                <summary>Matching Pods ({matchingPods.length})</summary>
                <For each={matchingPods}>
                  {(pod) => (
                    <div class="pod-item">
                      <p>Name: {pod.metadata.name}</p>
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
              </details>

              <details>
                <summary>Matching Deployments ({matchingDeployments.length})</summary>
                <For each={matchingDeployments}>
                  {(deployment) => (
                    <div class="deployment-item">
                      <p>Name: {deployment.metadata.name}</p>
                      <p>Replicas: {deployment.spec.replicas}</p>
                      <p>Available: {deployment.status.availableReplicas}</p>
                      <details>
                        <summary>Deployment Template Labels</summary>
                        <div class="selectors">
                          <For each={Object.entries(deployment.spec.template.metadata.labels || {})}>
                            {([key, value]) => (
                              <div>{key}: {value}</div>
                            )}
                          </For>
                        </div>
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
