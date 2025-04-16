import { For, createSignal, onMount, onCleanup, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Kustomization, Source } from '../types/k8s.ts';
import { ConditionType, ConditionStatus } from '../utils/conditions.ts';

export function FluxResourceList(props: { 
  kustomizations: Kustomization[],
  sources: Source[]
}) {
  const navigate = useNavigate();
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.kustomizations.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, props.kustomizations.length - 1);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 1, 0);
        return newIndex;
      });
    } else if (e.key === 'Enter') {
      const index = selectedIndex();
      if (index !== -1 && index < props.kustomizations.length) {
        const kustomization = props.kustomizations[index];
        navigate(`/kustomization/${kustomization.metadata.namespace}/${kustomization.metadata.name}`);
      }
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
      
      // Each kustomization has 2 rows, so we need to find the first row of the current item
      const mainRows = container.querySelectorAll('tbody tr:nth-child(2n+1)');
      if (index >= 0 && index < mainRows.length) {
        const selectedRow = mainRows[index];
        
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
    <div class="resource-list-container no-select" ref={setListContainer}>
      <table class="resource-table">
        <thead>
          <tr>
            <th style="width: 30%">NAME</th>
            <th style="width: 5%">AGE</th>
            <th style="width: 20%">READY</th>
            <th style="width: 55%">STATUS</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.kustomizations}>
            {(kustomization, index) => {
              const readyCondition = kustomization.status?.conditions?.find(c => c.type === ConditionType.Ready);
              const reconcilingCondition = kustomization.status?.conditions?.find(c => c.type === ConditionType.Reconciling);
              const creationTime = kustomization.metadata.creationTimestamp;
              return (
                <>
                  <tr 
                    class={selectedIndex() === index() ? 'selected' : ''} 
                    onClick={() => navigate(`/kustomization/${kustomization.metadata.namespace}/${kustomization.metadata.name}`)}
                  >
                    <td title={kustomization.metadata.name}>
                      {kustomization.metadata.name}
                    </td>
                    <td>
                      {(() => {
                        if (!creationTime) return 'N/A';
                        const startTime = new Date(creationTime);
                        const now = new Date();
                        const diff = now.getTime() - startTime.getTime();
                        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        return days > 0 ? `${days}d${hours}h` : `${hours}h`;
                      })()}
                    </td>
                    <td>
                      <div class="status-badges">
                        {readyCondition?.status === ConditionStatus.True && (
                          <span class="status-badge ready">Ready</span>
                        )}
                        {readyCondition?.status === ConditionStatus.False && (
                          <span class="status-badge not-ready">NotReady</span>
                        )}
                        {reconcilingCondition?.status === ConditionStatus.True && (
                          <span class="status-badge reconciling">Reconciling</span>
                        )}
                        {kustomization.spec.suspend && (
                          <span class="status-badge suspended">Suspended</span>
                        )}
                      </div>
                    </td>
                    <td class="message-cell">
                      {readyCondition?.message}
                    </td>
                  </tr>
                  <tr class={selectedIndex() === index() ? 'selected' : ''}>
                    <td colSpan={4}>
                      <div class="second-row">
                        <strong>Source:</strong> {kustomization.spec.sourceRef.name} <br />
                        <strong>Path:</strong> {kustomization.spec.path} <br />
                        <strong>Prune:</strong> {kustomization.spec.prune ? 'True' : 'False'} <br />
                        <strong>Suspended:</strong> {kustomization.spec.suspend ? 'True' : 'False'} <br />
                        <strong>Interval:</strong> {kustomization.spec.interval}
                      </div>
                    </td>
                  </tr>
                </>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
} 