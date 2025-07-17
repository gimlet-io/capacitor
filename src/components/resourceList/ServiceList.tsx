import type { Service } from "../../types/k8s.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';
import { useCalculateAge } from './timeUtils.ts';

export const serviceColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (service: Service) => <>{service.metadata.name}</>,
    title: (service: Service) => service.metadata.name,
    sortable: true,
    sortFunction: sortByName,
  },
  {
    header: "TYPE",
    width: "15%",
    accessor: (service: Service) => <>{service.spec.type}</>,
  },
  {
    header: "CLUSTER-IP",
    width: "15%",
    accessor: (service: Service) => <>{service.spec.clusterIP}</>,
  },
  {
    header: "EXTERNAL-IP",
    width: "15%",
    accessor: (service: Service) => {
      const ingress = service.status?.loadBalancer?.ingress;
      if (service.spec.type === "LoadBalancer" && ingress && ingress.length > 0) {
        return <>{ingress.map(ingress => ingress.ip || ingress.hostname).filter(Boolean).join(", ") || "Pending"}</>;
      }
      return <>None</>;
    },
  },
  {
    header: "PORT(S)",
    width: "15%",
    accessor: (service: Service) => (
      <>
        {service.spec.ports?.map((port) =>
          `${port.port}:${port.targetPort}/${port.protocol}`
        ).join(", ") || "None"}
      </>
    ),
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (service: Service) => useCalculateAge(service.metadata.creationTimestamp || '')(),
    sortable: true,
    sortFunction: sortByAge,
  },
];
