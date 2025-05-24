import { JSX } from "solid-js";
import { podColumns } from "./components/resourceList/PodList.tsx";
import { deploymentColumns } from "./components/resourceList/DeploymentList.tsx";
import { serviceColumns } from "./components/ServiceList.tsx";
import { kustomizationColumns, renderKustomizationDetails } from "./components/resourceList/KustomizationList.tsx";
import { applicationColumns, renderApplicationDetails } from "./components/resourceList/ApplicationList.tsx";
import { helmReleaseColumns, helmReleaseStatusFilter, helmReleaseChartFilter } from "./components/resourceList/HelmReleaseList.tsx";
import { KeyboardShortcut } from "./components/keyboardShortcuts/KeyboardShortcuts.tsx";
import { handleScale } from "./components/resourceList/DeploymentList.tsx";
import { handleReconcile } from "./components/resourceList/KustomizationList.tsx";
import { Filter } from "./components/filterBar/FilterBar.tsx";
import { podsStatusFilter, podsReadinessFilter } from "./components/resourceList/PodList.tsx";
import { deploymentReadinessFilter } from "./components/resourceList/DeploymentList.tsx";
import { kustomizationReadyFilter } from "./components/resourceList/KustomizationList.tsx";
import { argocdApplicationSyncFilter, argocdApplicationHealthFilter } from "./components/resourceList/ApplicationList.tsx";
import { builtInCommands } from "./components/resourceList/ResourceList.tsx";
export interface Column<T> {
  header: string;
  width: string;
  accessor: (item: T) => JSX.Element;
  title?: (item: T) => string;
}

export interface ResourceCommand {
  shortcut: KeyboardShortcut;
  handler: (item: any) => void | Promise<void>;
}

export interface ResourceTypeConfig {
  columns: Column<any>[];
  detailRowRenderer?: (item: any) => JSX.Element;
  noSelectClass?: boolean;
  rowKeyField?: string;
  onItemClick?: (item: any, navigate: any) => void;
  commands?: ResourceCommand[];
  filter?: Filter[];
}

// Define the centralized resource configurations
export const resourceTypeConfigs: Record<string, ResourceTypeConfig> = {
  'core/Pod': {
    columns: podColumns,
    filter: [podsReadinessFilter, podsStatusFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands, 
    ]
  },
  
  'apps/Deployment': {
    columns: deploymentColumns,
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+s", description: "Scale deployment", isContextual: true },
        handler: handleScale
      }
    ],
    filter: [deploymentReadinessFilter]
  },
  
  'apps/StatefulSet': {
    columns: deploymentColumns,
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+s", description: "Scale statefulset", isContextual: true },
        handler: handleScale
      }
    ],
    filter: [deploymentReadinessFilter]
  },
  
  'core/Service': {
    columns: serviceColumns
  },
  
  'helm.sh/Release': {
    columns: helmReleaseColumns,
    filter: [helmReleaseStatusFilter, helmReleaseChartFilter],
    commands: [
      {
        shortcut: { key: "h", description: "Release History", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      {
        shortcut: { key: "v", description: "Values", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
    ]
  },
  
  'kustomize.toolkit.fluxcd.io/Kustomization': {
    columns: kustomizationColumns,
    detailRowRenderer: renderKustomizationDetails,
    noSelectClass: true,
    rowKeyField: "name",
    onItemClick: (kustomization, navigate) => {
      navigate(`/kustomization/${kustomization.metadata.namespace}/${kustomization.metadata.name}`);
    },
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile kustomization", isContextual: true },
        handler: handleReconcile
      }
    ],
    filter: [kustomizationReadyFilter]
  },
  
  'argoproj.io/Application': {
    columns: applicationColumns,
    detailRowRenderer: renderApplicationDetails,
    noSelectClass: true,
    rowKeyField: "name",
    onItemClick: (application, navigate) => {
      navigate(`/application/${application.metadata.namespace}/${application.metadata.name}`);
    },
    filter: [argocdApplicationSyncFilter, argocdApplicationHealthFilter]
  }
};
