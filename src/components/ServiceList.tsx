import type { Service } from '../types/k8s.ts';
import { ResourceList } from './ResourceList.tsx';

export function ServiceList(props: { 
  services: Service[]
}) {
  const columns = [
    {
      header: "NAME",
      width: "30%",
      accessor: (service: Service) => <>{service.metadata.name}</>,
      title: (service: Service) => service.metadata.name
    },
    {
      header: "TYPE",
      width: "15%",
      accessor: (service: Service) => <>{service.spec.type}</>
    },
    {
      header: "CLUSTER-IP",
      width: "15%",
      accessor: (service: Service) => <>{service.spec.clusterIP}</>
    },
    {
      header: "EXTERNAL-IP",
      width: "15%",
      accessor: (service: Service) => <>{service.spec.externalIPs?.join(', ') || 'None'}</>
    },
    {
      header: "PORT(S)",
      width: "15%",
      accessor: (service: Service) => <>{service.spec.ports?.map(port => `${port.port}:${port.targetPort}/${port.protocol}`).join(', ') || 'None'}</>
    },
    {
      header: "AGE",
      width: "10%",
      accessor: (service: Service) => {
        if (!service.metadata.creationTimestamp) return <>N/A</>;
        const startTime = new Date(service.metadata.creationTimestamp);
        const now = new Date();
        const diff = now.getTime() - startTime.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
      }
    }
  ];

  return <ResourceList resources={props.services} columns={columns} />;
}
