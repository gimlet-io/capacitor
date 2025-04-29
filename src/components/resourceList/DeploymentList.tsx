import type { DeploymentWithResources } from '../../types/k8s.ts';
import { ResourceList } from './ResourceList.tsx';
import { ActiveFilter } from '../filterBar/FilterBar.tsx';
import { useCalculateAge } from './timeUtils.ts';

export function DeploymentList(props: { 
  deployments: DeploymentWithResources[]
  activeFilters: ActiveFilter[]
}) {
  const getPodColor = (status: string) => {
    switch (status) {
      case 'Running':
        return 'var(--linear-green)';
      case 'Pending':
        return 'var(--linear-yellow)';
      case 'Failed':
        return 'var(--linear-red)';
      default:
        return 'var(--linear-gray)';
    }
  };

  const columns = [
    {
      header: "NAME",
      width: "30%",
      accessor: (deployment: DeploymentWithResources) => <>{deployment.metadata.name}</>,
      title: (deployment: DeploymentWithResources) => deployment.metadata.name
    },
    {
      header: "READY",
      width: "10%",
      accessor: (deployment: DeploymentWithResources) => <>{deployment.status.readyReplicas || 0}/{deployment.spec.replicas}</>
    },
    {
      header: "PODS",
      width: "10%",
      accessor: (deployment: DeploymentWithResources) => (
        <>
          {deployment.pods?.map(pod => (
            <span 
              title={pod.metadata.name} 
              style={{
                "display": 'inline-block',
                "width": '10px',
                "height": '10px',
                "border-radius": '5%',
                "background-color": getPodColor(pod.status.phase),
                "margin": '0 2px'
              } as any} 
            >
            </span>
          ))}
        </>
      )
    },
    {
      header: "UP-TO-DATE",
      width: "10%",
      accessor: (deployment: DeploymentWithResources) => <>{deployment.status.updatedReplicas || 0}</>
    },
    {
      header: "AVAILABLE",
      width: "10%",
      accessor: (deployment: DeploymentWithResources) => <>{deployment.status.availableReplicas || 0}</>
    },
    {
      header: "AGE",
      width: "10%",
      accessor: (deployment: DeploymentWithResources) => useCalculateAge(deployment.metadata.creationTimestamp || '')(),
    }
  ];

  return <ResourceList resources={props.deployments} columns={columns} activeFilters={props.activeFilters} />;
}
