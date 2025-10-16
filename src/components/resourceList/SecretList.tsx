// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { Secret } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

// Define the columns for the Secret resource list
export const secretColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (secret: Secret) => <>{secret.metadata.name}</>,
    title: (secret: Secret) => secret.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
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
    width: "15%",
    accessor: (secret: Secret) => 
      useCalculateAge(secret.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
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