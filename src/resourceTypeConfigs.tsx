import { JSX } from "solid-js";
import { podColumns } from "./components/resourceList/PodList.tsx";
import { deploymentColumns } from "./components/resourceList/DeploymentList.tsx";
import { serviceColumns } from "./components/ServiceList.tsx";
import { ingressColumns } from "./components/resourceList/IngressList.tsx";
import { kustomizationColumns, renderKustomizationDetails } from "./components/resourceList/KustomizationList.tsx";
import { applicationColumns, renderApplicationDetails } from "./components/resourceList/ApplicationList.tsx";
import { helmReleaseColumns, helmReleaseStatusFilter, helmReleaseChartFilter } from "./components/resourceList/HelmReleaseList.tsx";
import { eventColumns, eventTypeFilter, sortEventsByLastSeen } from "./components/resourceList/EventList.tsx";
import { KeyboardShortcut } from "./components/keyboardShortcuts/KeyboardShortcuts.tsx";
import { handleScale } from "./components/resourceList/DeploymentList.tsx";
import { handleReconcile } from "./components/resourceList/KustomizationList.tsx";
import { Filter } from "./components/filterBar/FilterBar.tsx";
import { podsStatusFilter, podsReadinessFilter } from "./components/resourceList/PodList.tsx";
import { deploymentReadinessFilter } from "./components/resourceList/DeploymentList.tsx";
import { kustomizationReadyFilter } from "./components/resourceList/KustomizationList.tsx";
import { argocdApplicationSyncFilter, argocdApplicationHealthFilter } from "./components/resourceList/ApplicationList.tsx";
import { builtInCommands } from "./components/resourceList/ResourceList.tsx";
import { nodeColumns, nodeReadinessFilter, nodeRoleFilter } from "./components/resourceList/NodeList.tsx";
import { configMapColumns, configMapDataFilter } from "./components/resourceList/ConfigMapList.tsx";
import { secretColumns, secretTypeFilter } from "./components/resourceList/SecretList.tsx";
import { pvcColumns, pvcStatusFilter, pvcStorageClassFilter } from "./components/resourceList/PersistentVolumeClaimList.tsx";
import { daemonSetColumns, daemonSetReadinessFilter } from "./components/resourceList/DaemonSetList.tsx";
import { namespaceColumns, namespaceStatusFilter } from "./components/resourceList/NamespaceList.tsx";
import { jobColumns, jobStatusFilter } from "./components/resourceList/JobList.tsx";
import { cronJobColumns, cronJobSuspendedFilter } from "./components/resourceList/CronJobList.tsx";
import { hpaColumns, hpaStatusFilter } from "./components/resourceList/HorizontalPodAutoscalerList.tsx";
import { pvColumns, pvPhaseFilter, pvReclaimPolicyFilter } from "./components/resourceList/PersistentVolumeList.tsx";
import { roleColumns, roleVerbFilter } from "./components/resourceList/RoleList.tsx";
import { roleBindingColumns, roleBindingSubjectKindFilter, roleBindingRoleKindFilter } from "./components/resourceList/RoleBindingList.tsx";
import { serviceAccountColumns, serviceAccountAutomountFilter } from "./components/resourceList/ServiceAccountList.tsx";
import { networkPolicyColumns, networkPolicyTypeFilter } from "./components/resourceList/NetworkPolicyList.tsx";

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
  commands?: ResourceCommand[];
  filter?: Filter[];
  sortFunction?: (items: any[]) => any[];
}

// Define a reusable namespace column for all namespaced resources
export const namespaceColumn: Column<any> = {
  header: "NAMESPACE",
  width: "15%",
  accessor: (resource: any) => <>{resource.metadata.namespace}</>,
};

// Define navigation command placeholders that will be implemented in ResourceList
export const navigateToKustomization: ResourceCommand = {
  shortcut: { key: "Enter", description: "View kustomization details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToApplication: ResourceCommand = {
  shortcut: { key: "Enter", description: "View application details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

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
  
  'networking.k8s.io/Ingress': {
    columns: ingressColumns,
    commands: [
      ...builtInCommands
    ]
  },
  
  'core/Node': {
    columns: nodeColumns,
    filter: [nodeReadinessFilter, nodeRoleFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'core/ConfigMap': {
    columns: configMapColumns,
    filter: [configMapDataFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'core/Secret': {
    columns: secretColumns,
    filter: [secretTypeFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'core/PersistentVolumeClaim': {
    columns: pvcColumns,
    filter: [pvcStatusFilter, pvcStorageClassFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'apps/DaemonSet': {
    columns: daemonSetColumns,
    filter: [daemonSetReadinessFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands
    ]
  },
  
  'core/Namespace': {
    columns: namespaceColumns,
    filter: [namespaceStatusFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'batch/Job': {
    columns: jobColumns,
    filter: [jobStatusFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands
    ]
  },
  
  'batch/CronJob': {
    columns: cronJobColumns,
    filter: [cronJobSuspendedFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'autoscaling/HorizontalPodAutoscaler': {
    columns: hpaColumns,
    filter: [hpaStatusFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'core/PersistentVolume': {
    columns: pvColumns,
    filter: [pvPhaseFilter, pvReclaimPolicyFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'rbac.authorization.k8s.io/Role': {
    columns: roleColumns,
    filter: [roleVerbFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'rbac.authorization.k8s.io/RoleBinding': {
    columns: roleBindingColumns,
    filter: [roleBindingSubjectKindFilter, roleBindingRoleKindFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'core/ServiceAccount': {
    columns: serviceAccountColumns,
    filter: [serviceAccountAutomountFilter],
    commands: [
      ...builtInCommands
    ]
  },
  
  'networking.k8s.io/NetworkPolicy': {
    columns: networkPolicyColumns,
    filter: [networkPolicyTypeFilter],
    commands: [
      ...builtInCommands
    ]
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
      {
        shortcut: { key: "m", description: "Manifest", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
    ]
  },
  
  'kustomize.toolkit.fluxcd.io/Kustomization': {
    columns: kustomizationColumns,
    detailRowRenderer: renderKustomizationDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile kustomization", isContextual: true },
        handler: handleReconcile
      },
      navigateToKustomization
    ],
    filter: [kustomizationReadyFilter]
  },
  
  'core/Event': {
    columns: eventColumns,
    filter: [eventTypeFilter],
    sortFunction: sortEventsByLastSeen
  },
  
  'argoproj.io/Application': {
    columns: applicationColumns,
    detailRowRenderer: renderApplicationDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      navigateToApplication
    ],
    filter: [argocdApplicationSyncFilter, argocdApplicationHealthFilter]
  }
};
