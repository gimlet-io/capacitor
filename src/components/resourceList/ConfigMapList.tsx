// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { ConfigMap } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

// Define the columns for the ConfigMap resource list
export const configMapColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (configMap: ConfigMap) => <>{configMap.metadata.name}</>,
    title: (configMap: ConfigMap) => configMap.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "DATA",
    width: "15%",
    accessor: (configMap: ConfigMap) => {
      const dataCount = configMap.data ? Object.keys(configMap.data).length : 0;
      const binaryDataCount = configMap.binaryData ? Object.keys(configMap.binaryData).length : 0;
      const totalCount = dataCount + binaryDataCount;
      return <>{totalCount}</>;
    },
    title: (configMap: ConfigMap) => {
      const dataCount = configMap.data ? Object.keys(configMap.data).length : 0;
      const binaryDataCount = configMap.binaryData ? Object.keys(configMap.binaryData).length : 0;
      return `${dataCount} data items, ${binaryDataCount} binary data items`;
    },
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (configMap: ConfigMap) => 
      useCalculateAge(configMap.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];
