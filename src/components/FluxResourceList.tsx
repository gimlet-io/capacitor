import { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Kustomization, Source } from '../types/k8s.ts';
import { ConditionType, ConditionStatus } from '../utils/conditions.ts';
import { ResourceList } from './ResourceList.tsx';
import { FilterGroup, ActiveFilter } from './FilterBar.tsx';

export function FluxResourceList(props: { 
  kustomizations: Kustomization[],
  sources: Source[]
}) {
  const navigate = useNavigate();

  // Define Ready condition filter options
  const readyFilterGroup: FilterGroup = {
    name: "Ready",
    type: "select",
    options: [
      { label: "Ready", value: ConditionStatus.True, color: "var(--linear-green)" },
      { label: "Not Ready", value: ConditionStatus.False, color: "var(--linear-red)" },
      { label: "Unknown", value: ConditionStatus.Unknown, color: "var(--linear-text-tertiary)" },
      { label: "Suspended", value: "Suspended", color: "var(--linear-blue)" }
    ],
    multiSelect: true
  };

  // Define filter function
  const filterKustomizations = (kustomization: Kustomization, activeFilters: ActiveFilter[]): boolean => {
    // If no filters are applied, show all kustomizations
    if (activeFilters.length === 0) return true;

    // Check if we have ready condition filters
    const readyFilters = activeFilters.filter(f => f.group === 'Ready');
    if (readyFilters.length > 0) {
      const readyCondition = kustomization.status?.conditions?.find(c => c.type === ConditionType.Ready);
      
      // Check for suspended state specifically
      if (readyFilters.some(f => f.value === 'Suspended')) {
        if (kustomization.spec.suspend) return true;
      }
      
      // Check for other condition statuses
      return readyFilters.some(filter => {
        if (filter.value === 'Suspended') {
          return kustomization.spec.suspend;
        }
        return readyCondition?.status === filter.value;
      });
    }

    return true;
  };

  const handleKustomizationClick = (kustomization: Kustomization) => {
    navigate(`/kustomization/${kustomization.metadata.namespace}/${kustomization.metadata.name}`);
  };

  const renderKustomizationDetails = (kustomization: Kustomization) => (
    <td colSpan={4}>
      <div class="second-row">
        <strong>Source:</strong> {kustomization.spec.sourceRef.name} <br />
        <strong>Path:</strong> {kustomization.spec.path} <br />
        <strong>Prune:</strong> {kustomization.spec.prune ? 'True' : 'False'} <br />
        <strong>Suspended:</strong> {kustomization.spec.suspend ? 'True' : 'False'} <br />
        <strong>Interval:</strong> {kustomization.spec.interval}
      </div>
    </td>
  );

  const columns = [
    {
      header: "NAME",
      width: "30%",
      accessor: (kustomization: Kustomization) => <>{kustomization.metadata.name}</>,
      title: (kustomization: Kustomization) => kustomization.metadata.name
    },
    {
      header: "AGE",
      width: "5%",
      accessor: (kustomization: Kustomization) => {
        if (!kustomization.metadata.creationTimestamp) return <>N/A</>;
        const startTime = new Date(kustomization.metadata.creationTimestamp);
        const now = new Date();
        const diff = now.getTime() - startTime.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
      }
    },
    {
      header: "READY",
      width: "20%",
      accessor: (kustomization: Kustomization) => {
        const readyCondition = kustomization.status?.conditions?.find(c => c.type === ConditionType.Ready);
        const reconcilingCondition = kustomization.status?.conditions?.find(c => c.type === ConditionType.Reconciling);
        
        return (
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
        );
      }
    },
    {
      header: "STATUS",
      width: "55%",
      accessor: (kustomization: Kustomization) => {
        const readyCondition = kustomization.status?.conditions?.find(c => c.type === ConditionType.Ready);
        return <div class="message-cell">{readyCondition?.message}</div>;
      }
    }
  ];

  return (
    <ResourceList 
      resources={props.kustomizations} 
      columns={columns} 
      onItemClick={handleKustomizationClick}
      detailRowRenderer={renderKustomizationDetails}
      noSelectClass={true}
      rowKeyField="name"
      filterGroups={[readyFilterGroup]}
      filterFunction={filterKustomizations}
    />
  );
} 