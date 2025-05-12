import type { StatefulSetWithResources } from '../../types/k8s.ts';
import { ResourceList } from './ResourceList.tsx';
import { useCalculateAge } from './timeUtils.ts';

export function StatefulSetList(props: { 
  statefulSets: StatefulSetWithResources[]
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

  const handleScale = async (statefulSet: StatefulSetWithResources, replicas: number) => {
    try {
      const response = await fetch('/api/scale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: "statefulset",
          name: statefulSet.metadata.name,
          namespace: statefulSet.metadata.namespace,
          replicas: replicas
        }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to scale: ${response.statusText}`);
      }
      
      // Success - the UI will update when the watch detects the changes
    } catch (error) {
      console.error('Error scaling statefulset:', error);
      window.alert(`Error scaling statefulset: ${error}`);
      throw error;
    }
  };

  const columns = [
    {
      header: "NAME",
      width: "30%",
      accessor: (statefulSet: StatefulSetWithResources) => <>{statefulSet.metadata.name}</>,
      title: (statefulSet: StatefulSetWithResources) => statefulSet.metadata.name
    },
    {
      header: "READY",
      width: "10%",
      accessor: (statefulSet: StatefulSetWithResources) => <>{statefulSet.status.readyReplicas || 0}/{statefulSet.spec.replicas}</>,
    },
    {
      header: "PODS",
      width: "10%",
      accessor: (statefulSet: StatefulSetWithResources) => (
        <>
          {statefulSet.pods?.map(pod => (
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
      header: "AGE",
      width: "10%",
      accessor: (statefulSet: StatefulSetWithResources) => useCalculateAge(statefulSet.metadata.creationTimestamp || '')(),
    }
  ];

  return <ResourceList 
    resources={props.statefulSets} 
    columns={columns} 
    onScale={handleScale}
  />;
} 