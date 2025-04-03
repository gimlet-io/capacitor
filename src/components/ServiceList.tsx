import { For } from "solid-js/web";
import type { Service } from '../types/k8s.ts';

export function ServiceList(props: { services: Service[] }) {
  return (
    <div class="resource-list">
      <For each={props.services}>
        {(service) => (
          <div class="resource-item service-item">
            <h3>{service.metadata.namespace}/{service.metadata.name}</h3>
            <p>Type: {service.spec.type || 'ClusterIP'}</p>
            <p>Cluster IP: {service.spec.clusterIP || 'None'}</p>
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
          </div>
        )}
      </For>
    </div>
  );
}
