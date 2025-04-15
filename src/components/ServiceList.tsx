import { For, createSignal, onMount } from "solid-js";
import type { Service } from '../types/k8s.ts';

export function ServiceList(props: { 
  services: Service[]
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        if (prev === -1) return 0;
        return Math.min(prev + 1, props.services.length - 1);
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
            <th style="width: 15%">TYPE</th>
            <th style="width: 15%">CLUSTER-IP</th>
            <th style="width: 15%">EXTERNAL-IP</th>
            <th style="width: 15%">PORT(S)</th>
            <th style="width: 10%">AGE</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.services}>
            {(service, index) => (
              <tr class={selectedIndex() === index() ? 'selected' : ''}>
                <td title={service.metadata.name}>
                  {service.metadata.name}
                </td>
                <td>{service.spec.type}</td>
                <td>{service.spec.clusterIP}</td>
                <td>{service.spec.externalIPs?.join(', ') || 'None'}</td>
                <td>{service.spec.ports.map(port => `${port.port}:${port.targetPort}/${port.protocol}`).join(', ')}</td>
                <td>
                  {(() => {
                    if (!service.metadata.creationTimestamp) return 'N/A';
                    const startTime = new Date(service.metadata.creationTimestamp);
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
