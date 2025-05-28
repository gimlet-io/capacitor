import type { ConfigMap } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Define the columns for the ConfigMap resource list
export const configMapColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (configMap: ConfigMap) => <>{configMap.metadata.name}</>,
    title: (configMap: ConfigMap) => configMap.metadata.name,
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
    accessor: (configMap: ConfigMap) => {
      if (!configMap.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(configMap.metadata.creationTimestamp);
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

// Filter for ConfigMap based on whether it has data or not
export const configMapDataFilter: Filter = {
  name: "configMapData",
  label: "Has Data",
  options: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
  filterFunction: (configMap: ConfigMap, value: string) => {
    const hasData = (configMap.data && Object.keys(configMap.data).length > 0) || 
                   (configMap.binaryData && Object.keys(configMap.binaryData).length > 0);
    
    return (value === "yes" && hasData) || (value === "no" && !hasData);
  },
}; 