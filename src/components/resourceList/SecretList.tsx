import { JSX } from "solid-js";
import type { Secret } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Define the columns for the Secret resource list
export const secretColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (secret: Secret) => <>{secret.metadata.name}</>,
    title: (secret: Secret) => secret.metadata.name,
  },
  {
    header: "TYPE",
    width: "20%",
    accessor: (secret: Secret) => <>{secret.type || "Opaque"}</>,
  },
  {
    header: "DATA",
    width: "10%",
    accessor: (secret: Secret) => {
      const dataCount = secret.data ? Object.keys(secret.data).length : 0;
      const stringDataCount = secret.stringData ? Object.keys(secret.stringData).length : 0;
      const totalCount = dataCount + stringDataCount;
      return <>{totalCount}</>;
    },
    title: (secret: Secret) => {
      const dataCount = secret.data ? Object.keys(secret.data).length : 0;
      const stringDataCount = secret.stringData ? Object.keys(secret.stringData).length : 0;
      return `${dataCount} data items, ${stringDataCount} string data items`;
    },
  },
  {
    header: "AGE",
    width: "20%",
    accessor: (secret: Secret) => {
      if (!secret.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(secret.metadata.creationTimestamp);
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
    },
  },
];

// Filter for Secret based on its type
export const secretTypeFilter: Filter = {
  name: "secretType",
  label: "Type",
  options: [
    { value: "Opaque", label: "Opaque" },
    { value: "kubernetes.io/service-account-token", label: "Service Account Token" },
    { value: "kubernetes.io/dockerconfigjson", label: "Docker Registry" },
    { value: "kubernetes.io/tls", label: "TLS" },
    { value: "kubernetes.io/basic-auth", label: "Basic Auth" },
    { value: "kubernetes.io/ssh-auth", label: "SSH Auth" },
  ],
  filterFunction: (secret: Secret, value: string) => {
    const secretType = secret.type || "Opaque";
    return secretType === value;
  },
}; 