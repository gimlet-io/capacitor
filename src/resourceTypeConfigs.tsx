import { JSX } from "solid-js";
import { podColumns } from "./components/resourceList/PodList.tsx";
import { deploymentColumns } from "./components/resourceList/DeploymentList.tsx";
import { serviceColumns } from "./components/ServiceList.tsx";
import { ingressColumns } from "./components/resourceList/IngressList.tsx";
import { kustomizationColumns, renderKustomizationDetails } from "./components/resourceList/KustomizationList.tsx";
import { gitRepositoryColumns, renderGitRepositoryDetails } from "./components/resourceList/GitRepositoryList.tsx";
import { helmRepositoryColumns, renderHelmRepositoryDetails } from "./components/resourceList/HelmRepositoryList.tsx";
import { ociRepositoryColumns, renderOCIRepositoryDetails } from "./components/resourceList/OCIRepositoryList.tsx";
import { helmChartColumns, renderHelmChartDetails } from "./components/resourceList/HelmChartList.tsx";
import { helmReleaseFluxColumns, renderHelmReleaseFluxDetails } from "./components/resourceList/HelmReleaseFluxList.tsx";
import { bucketColumns, renderBucketDetails } from "./components/resourceList/BucketList.tsx";
import { applicationColumns, renderApplicationDetails } from "./components/resourceList/ApplicationList.tsx";
import { helmReleaseColumns, helmReleaseStatusFilter, helmReleaseChartFilter } from "./components/resourceList/HelmReleaseList.tsx";
import { eventColumns, eventTypeFilter, sortEventsByLastSeen } from "./components/resourceList/EventList.tsx";
import { KeyboardShortcut } from "./components/keyboardShortcuts/KeyboardShortcuts.tsx";
import { handleScale, handleRolloutRestart } from "./components/resourceList/DeploymentList.tsx";
import { Filter } from "./components/filterBar/FilterBar.tsx";
import { podsStatusFilter, podsReadinessFilter, podsNodeFilter } from "./components/resourceList/PodList.tsx";
import { deploymentReadinessFilter } from "./components/resourceList/DeploymentList.tsx";
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
import { fluxReadyFilter } from "./utils/fluxUtils.tsx";
import { handleFluxReconcile } from "./utils/fluxUtils.tsx";
import { scaledJobColumns, scaledJobTriggerFilter, scaledJobStrategyFilter } from "./components/resourceList/ScaledJobList.tsx";

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

export interface ResourceCardRenderer {
  render: (resource: any) => JSX.Element;
  width?: number;
  height?: number;
}

export interface ResourceTypeConfig {
  columns: Column<any>[];
  detailRowRenderer?: (item: any, columnCount?: number) => JSX.Element;
  noSelectClass?: boolean;
  rowKeyField?: string;
  commands?: ResourceCommand[];
  filter?: Filter[];
  sortFunction?: (items: any[]) => any[];
  treeCardRenderer?: ResourceCardRenderer;
  abbreviations?: string[]; // Common abbreviations for this resource type
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

// Define a command to switch to viewing pods in a namespace
export const showPodsInNamespace: ResourceCommand = {
  shortcut: { key: "Enter", description: "View pods in this namespace", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

// Helper function to create card renderers that reuse column accessors
const createCardRenderer = (
  columns: Column<any>[],
  selectedColumns: string[],
  backgroundColor: string = "var(--linear-bg-secondary)",
  width: number = 250,
  height: number = 80
): ResourceCardRenderer => {
  return {
    render: (resource) => {
      // Get the accessor functions for the selected columns
      const columnData = selectedColumns.map(header => {
        const column = columns.find(col => col.header === header);
        return {
          header,
          element: column ? column.accessor(resource) : null
        };
      }).filter(item => item.element);

      return (
        <div 
          class="resource-card" 
          style={`width: ${width}px; height: ${height}px; --card-bg-color: ${backgroundColor};`}
        >
          <div class="resource-card-header">
            <div class="resource-type">{resource.kind}</div>
          </div>
          
          <div class="resource-name" title={resource.metadata.name}>
            {resource.metadata.name}
          </div>
          
          <div class="resource-card-details">
            {columnData.map(({ element }) => (
              <div class="resource-card-pill">
                {element}
              </div>
            ))}
          </div>
        </div>
      );
    },
    width,
    height
  };
};

// Create card renderers for different resource types
export const podCardRenderer = createCardRenderer(
  podColumns,
  ["READY", "STATUS"],
  "rgb(225, 235, 245)", // Muted light blue that fits with other colors
  300,
  80
);

export const deploymentCardRenderer = createCardRenderer(
  deploymentColumns,
  ["READY"],
  "rgb(245, 235, 220)" // Muted light orange
);

export const serviceCardRenderer = createCardRenderer(
  serviceColumns,
  ["TYPE"],
  "rgb(230, 245, 230)" // Muted light green
);

export const nodeCardRenderer = createCardRenderer(
  nodeColumns,
  ["STATUS"],
  "rgb(235, 235, 245)" // Muted light blue
);

export const ingressCardRenderer = createCardRenderer(
  ingressColumns,
  ["CLASS", "HOSTS"],
  "rgb(230, 245, 245)" // Muted light cyan
);

export const daemonSetCardRenderer = createCardRenderer(
  daemonSetColumns,
  ["READY"],
  "rgb(245, 230, 230)" // Muted light pink
);

export const jobCardRenderer = createCardRenderer(
  jobColumns,
  ["COMPLETIONS", "STATUS", "AGE"],
  "rgb(235, 245, 235)" // Muted light mint
);

export const cronJobCardRenderer = createCardRenderer(
  cronJobColumns,
  ["SCHEDULE", "SUSPEND"],
  "rgb(235, 235, 245)" // Muted light lavender
);

export const pvcCardRenderer = createCardRenderer(
  pvcColumns,
  ["STATUS", "CAPACITY"],
  "rgb(245, 240, 230)" // Muted light peach
);

export const pvCardRenderer = createCardRenderer(
  pvColumns,
  ["STATUS", "CAPACITY"],
  "rgb(245, 240, 230)" // Muted light peach
);

// Define the centralized resource configurations
export const resourceTypeConfigs: Record<string, ResourceTypeConfig> = {
  'core/Pod': {
    columns: podColumns,
    filter: [podsReadinessFilter, podsStatusFilter, podsNodeFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands, 
    ],
    treeCardRenderer: podCardRenderer
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
      },
      {
        shortcut: { key: "Ctrl+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      }
    ],
    filter: [deploymentReadinessFilter],
    treeCardRenderer: deploymentCardRenderer
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
      },
      {
        shortcut: { key: "Ctrl+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      }
    ],
    filter: [deploymentReadinessFilter],
    treeCardRenderer: deploymentCardRenderer,
    abbreviations: ['sts']
  },
  
  'core/Service': {
    columns: serviceColumns,
    treeCardRenderer: serviceCardRenderer,
    abbreviations: ['svc']
  },
  
  'networking.k8s.io/Ingress': {
    columns: ingressColumns,
    commands: [
      ...builtInCommands
    ],
    treeCardRenderer: ingressCardRenderer
  },
  
  'core/Node': {
    columns: nodeColumns,
    filter: [nodeReadinessFilter, nodeRoleFilter],
    commands: [
      ...builtInCommands
    ],
    treeCardRenderer: nodeCardRenderer
  },
  
  'core/ConfigMap': {
    columns: configMapColumns,
    filter: [configMapDataFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['cm']
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
    ],
    treeCardRenderer: pvcCardRenderer,
    abbreviations: ['pvc']
  },
  
  'apps/DaemonSet': {
    columns: daemonSetColumns,
    filter: [daemonSetReadinessFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      }
    ],
    treeCardRenderer: daemonSetCardRenderer,
    abbreviations: ['ds']
  },

  'apps/ReplicaSet': {
    columns: deploymentColumns,
    filter: [],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands
    ],
    treeCardRenderer: deploymentCardRenderer,
    abbreviations: ['rs']
  },
  
  'core/Namespace': {
    columns: namespaceColumns,
    filter: [namespaceStatusFilter],
    commands: [
      ...builtInCommands,
      showPodsInNamespace
    ],
    abbreviations: ['ns']
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
    ],
    treeCardRenderer: jobCardRenderer
  },
  
  'batch/CronJob': {
    columns: cronJobColumns,
    filter: [cronJobSuspendedFilter],
    commands: [
      ...builtInCommands
    ],
    treeCardRenderer: cronJobCardRenderer,
    abbreviations: ['cj']
  },
  
  'autoscaling/HorizontalPodAutoscaler': {
    columns: hpaColumns,
    filter: [hpaStatusFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['hpa']
  },
  
  'core/PersistentVolume': {
    columns: pvColumns,
    filter: [pvPhaseFilter, pvReclaimPolicyFilter],
    commands: [
      ...builtInCommands
    ],
    treeCardRenderer: pvCardRenderer,
    abbreviations: ['pv']
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
    ],
    abbreviations: ['rb']
  },
  
  'core/ServiceAccount': {
    columns: serviceAccountColumns,
    filter: [serviceAccountAutomountFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['sa']
  },
  
  'networking.k8s.io/NetworkPolicy': {
    columns: networkPolicyColumns,
    filter: [networkPolicyTypeFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['netpol']
  },
  
  'keda.sh/ScaledJob': {
    columns: scaledJobColumns,
    filter: [scaledJobTriggerFilter, scaledJobStrategyFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['sj']
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
        handler: handleFluxReconcile
      },
      navigateToKustomization
    ],
    filter: [fluxReadyFilter],
    abbreviations: ['ks']
  },
  
  'source.toolkit.fluxcd.io/GitRepository': {
    columns: gitRepositoryColumns,
    detailRowRenderer: renderGitRepositoryDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile GitRepository", isContextual: true },
        handler: handleFluxReconcile
      }
    ],
    filter: [fluxReadyFilter]
  },
  
  'source.toolkit.fluxcd.io/HelmRepository': {
    columns: helmRepositoryColumns,
    detailRowRenderer: renderHelmRepositoryDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile HelmRepository", isContextual: true },
        handler: handleFluxReconcile
      }
    ],
    filter: [fluxReadyFilter]
  },
  
  'source.toolkit.fluxcd.io/HelmChart': {
    columns: helmChartColumns,
    detailRowRenderer: renderHelmChartDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile HelmChart", isContextual: true },
        handler: handleFluxReconcile
      }
    ],
    filter: [fluxReadyFilter]
  },
  
  'source.toolkit.fluxcd.io/OCIRepository': {
    columns: ociRepositoryColumns,
    detailRowRenderer: renderOCIRepositoryDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile OCIRepository", isContextual: true },
        handler: handleFluxReconcile
      }
    ],
    filter: [fluxReadyFilter]
  },
  
  'source.toolkit.fluxcd.io/Bucket': {
    columns: bucketColumns,
    detailRowRenderer: renderBucketDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile Bucket", isContextual: true },
        handler: handleFluxReconcile
      }
    ],
    filter: [fluxReadyFilter]
  },
  
  'helm.toolkit.fluxcd.io/HelmRelease': {
    columns: helmReleaseFluxColumns,
    detailRowRenderer: renderHelmReleaseFluxDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Ctrl+r", description: "Reconcile HelmRelease", isContextual: true },
        handler: handleFluxReconcile
      }
    ],
    filter: [fluxReadyFilter],
    abbreviations: ['hr']
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
