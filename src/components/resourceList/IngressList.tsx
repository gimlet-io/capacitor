import type { Ingress } from "../../types/k8s.ts";
import type { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../resourceTypeConfigs.tsx';

export const ingressColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (ingress: Ingress) => <>{ingress.metadata.name}</>,
    title: (ingress: Ingress) => ingress.metadata.name,
    sortable: true,
    sortFunction: sortByName,
  },
  {
    header: "CLASS",
    width: "15%",
    accessor: (ingress: Ingress) => <>{ingress.spec.ingressClassName || "default"}</>,
  },
  {
    header: "HOSTS",
    width: "25%",
    accessor: (ingress: Ingress) => {
      const hosts = ingress.spec.rules?.map(rule => rule.host) || [];
      return <>{hosts.length > 0 ? hosts.join(", ") : "*"}</>;
    },
  },
  {
    header: "ADDRESS",
    width: "15%",
    accessor: (ingress: Ingress) => {
      const ingresses = ingress.status?.loadBalancer?.ingress || [];
      if (ingresses.length > 0) {
        return <>{ingresses.map(ing => ing.ip || ing.hostname).filter(Boolean).join(", ")}</>;
      }
      return <>Pending</>;
    },
  },
  {
    header: "PORTS",
    width: "10%",
    accessor: (ingress: Ingress) => {
      const tlsList = ingress.spec.tls || [];
      return <>{tlsList.length > 0 ? "80, 443" : "80"}</>;
    },
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (ingress: Ingress) =>
      useCalculateAge(ingress.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: sortByAge,
  },
];
