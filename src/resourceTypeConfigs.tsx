import { JSX } from "solid-js";
import { podColumns } from "./components/resourceList/PodList.tsx";
import { deploymentColumns } from "./components/resourceList/DeploymentList.tsx";
import { serviceColumns } from "./components/resourceList/ServiceList.tsx";
import { ingressColumns } from "./components/resourceList/IngressList.tsx";
import { KustomizationColumns, renderKustomizationDetails } from "./components/resourceList/KustomizationList.tsx";
import { gitRepositoryColumns, renderGitRepositoryDetails } from "./components/resourceList/GitRepositoryList.tsx";
import { helmRepositoryColumns, renderHelmRepositoryDetails } from "./components/resourceList/HelmRepositoryList.tsx";
import { ociRepositoryColumns, renderOCIRepositoryDetails } from "./components/resourceList/OCIRepositoryList.tsx";
import { helmChartColumns, renderHelmChartDetails } from "./components/resourceList/HelmChartList.tsx";
import { helmReleaseFluxColumns, renderHelmReleaseFluxDetails } from "./components/resourceList/HelmReleaseFluxList.tsx";
import { bucketColumns, renderBucketDetails } from "./components/resourceList/BucketList.tsx";
import { applicationColumns, renderApplicationDetails } from "./components/resourceList/ApplicationList.tsx";
import { helmReleaseColumns, helmReleaseStatusFilter, helmReleaseChartFilter } from "./components/resourceList/HelmReleaseList.tsx";
import { eventColumns, eventTypeFilter } from "./components/resourceList/EventList.tsx";
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
import { jobColumns, jobStatusFilter, jobNodeFilter } from "./components/resourceList/JobList.tsx";
import { cronJobColumns, cronJobSuspendedFilter } from "./components/resourceList/CronJobList.tsx";
import { hpaColumns, hpaStatusFilter } from "./components/resourceList/HorizontalPodAutoscalerList.tsx";
import { pvColumns, pvPhaseFilter, pvReclaimPolicyFilter } from "./components/resourceList/PersistentVolumeList.tsx";
import { roleColumns, roleVerbFilter } from "./components/resourceList/RoleList.tsx";
import { roleBindingColumns, roleBindingSubjectKindFilter, roleBindingRoleKindFilter } from "./components/resourceList/RoleBindingList.tsx";
import { serviceAccountColumns, serviceAccountAutomountFilter } from "./components/resourceList/ServiceAccountList.tsx";
import { networkPolicyColumns, networkPolicyTypeFilter } from "./components/resourceList/NetworkPolicyList.tsx";
import { podDisruptionBudgetColumns } from "./components/resourceList/PodDisruptionBudgetList.tsx";
import { fluxReadyFilter } from "./utils/fluxUtils.tsx";
import { handleFluxReconcile, handleFluxReconcileWithSources } from "./utils/fluxUtils.tsx";
import { scaledJobColumns, scaledJobTriggerFilter, scaledJobStrategyFilter } from "./components/resourceList/ScaledJobList.tsx";
import { sortByNamespace } from "./utils/sortUtils.ts";
import {
  updateDeploymentMatchingResources,
  updateKustomizationMatchingEvents,
  updateReplicaSetMatchingResources,
  updateKustomizationMatchingGitRepositories,
  updateKustomizationMatchingBuckets,
  updateKustomizationMatchingOCIRepositories
} from "./utils/k8s.ts";
import { updateJobMatchingResources } from "./utils/k8s.ts";

export interface Column<T> {
  header: string;
  width: string;
  accessor: (item: T) => JSX.Element;
  title?: (item: T) => string;
  sortable?: boolean;
  sortFunction?: (items: T[], ascending: boolean) => T[];
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
  defaultSortColumn?: string;
  treeCardRenderer?: ResourceCardRenderer;
  abbreviations?: string[]; // Common abbreviations for this resource type
  extraWatches?: ExtraWatchConfig[];
}

// Define a reusable namespace column for all namespaced resources
export const namespaceColumn: Column<any> = {
  header: "NAMESPACE",
  width: "15%",
  accessor: (resource: any) => <>{resource.metadata.namespace}</>,
  sortable: true,
  sortFunction: sortByNamespace,
};

// Define navigation command placeholders that will be implemented in ResourceList
export const navigateToKustomization: ResourceCommand = {
  shortcut: { key: "Enter", description: "View kustomization details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToHelmClassicReleaseDetails: ResourceCommand = {
  shortcut: { key: "Enter", description: "View Helm release details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToApplication: ResourceCommand = {
  shortcut: { key: "Enter", description: "View application details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToSecret: ResourceCommand = {
  shortcut: { key: "Enter", description: "View secret details", isContextual: true },
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

// Define extra watches for certain resource types
export type ResourceUpdater = (mainResource: any, extraResources: any[]) => any;
export type ExtraWatchConfig = {
  resourceType: string;          // The type of resource to watch 
  updater: ResourceUpdater;      // Function to update main resource with the extra resource data
  isParent: (resource: any, obj: any) => boolean;
};

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
      {
        shortcut: { key: "x", description: "Exec", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      {
        shortcut: { key: "Mod+p", description: "Copy port-forward", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands, 
    ],
    defaultSortColumn: "NAME",
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
        shortcut: { key: "Mod+p", description: "Copy port-forward", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      {
        shortcut: { key: "Mod+s", description: "Scale deployment", isContextual: true },
        handler: handleScale
      },
      {
        shortcut: { key: "Mod+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      }
    ],
    filter: [deploymentReadinessFilter],
    defaultSortColumn: "NAME",
    treeCardRenderer: deploymentCardRenderer,
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (deployment, pods) => updateDeploymentMatchingResources(deployment, pods),
        isParent: (resource: any, obj: any) => {return false}
      }
    ],
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
        shortcut: { key: "Mod+p", description: "Copy port-forward", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      {
        shortcut: { key: "Mod+s", description: "Scale statefulset", isContextual: true },
        handler: handleScale
      },
      {
        shortcut: { key: "Mod+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      }
    ],
    filter: [deploymentReadinessFilter],
    defaultSortColumn: "NAME",
    treeCardRenderer: deploymentCardRenderer,
    abbreviations: ['sts']
  },
  
  'core/Service': {
    columns: serviceColumns,
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Mod+p", description: "Copy port-forward", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: serviceCardRenderer,
    abbreviations: ['svc']
  },
  
  'networking.k8s.io/Ingress': {
    columns: ingressColumns,
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: ingressCardRenderer
  },
  
  'core/Node': {
    columns: nodeColumns,
    filter: [nodeReadinessFilter, nodeRoleFilter],
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: nodeCardRenderer
  },
  
  'core/ConfigMap': {
    columns: configMapColumns,
    filter: [configMapDataFilter],
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    abbreviations: ['cm']
  },
  
  'core/Secret': {
    columns: secretColumns,
    filter: [secretTypeFilter],
    commands: [
      ...builtInCommands,
      navigateToSecret
    ],
    defaultSortColumn: "NAME"
  },
  
  'core/PersistentVolumeClaim': {
    columns: pvcColumns,
    filter: [pvcStatusFilter, pvcStorageClassFilter],
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
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
        shortcut: { key: "Mod+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      }
    ],
    defaultSortColumn: "NAME",
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
      ...builtInCommands,
      {
        shortcut: { key: "Mod+p", description: "Copy port-forward", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      }
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: deploymentCardRenderer,
    abbreviations: ['rs'],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (replicaSet, pods) => updateReplicaSetMatchingResources(replicaSet, pods),
        isParent: (resource: any, obj: any) => {return false}
      }
    ],
  },
  
  'core/Namespace': {
    columns: namespaceColumns,
    filter: [namespaceStatusFilter],
    commands: [
      ...builtInCommands,
      showPodsInNamespace
    ],
    defaultSortColumn: "NAME",
    abbreviations: ['ns']
  },
  
  'batch/Job': {
    columns: jobColumns,
    filter: [jobStatusFilter, jobNodeFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: jobCardRenderer,
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (job, pods) => updateJobMatchingResources(job, pods),
        isParent: (_resource: any, _obj: any) => {return false}
      }
    ]
  },
  
  'batch/CronJob': {
    columns: cronJobColumns,
    filter: [cronJobSuspendedFilter],
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
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
  
  'policy/PodDisruptionBudget': {
    columns: podDisruptionBudgetColumns,
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    abbreviations: ['pdb']
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
      navigateToHelmClassicReleaseDetails,
    ]
  },
  
  'kustomize.toolkit.fluxcd.io/Kustomization': {
    columns: KustomizationColumns,
    detailRowRenderer: renderKustomizationDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Mod+r", description: "Reconcile", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
      },
      navigateToKustomization
    ],
    filter: [fluxReadyFilter],
    abbreviations: ['ks'],
    extraWatches: [
      {
        resourceType: 'source.toolkit.fluxcd.io/GitRepository',
        updater: (kustomization, gitRepositories) => updateKustomizationMatchingGitRepositories(kustomization, gitRepositories),
        isParent: (resource: any, obj: any) => {return false}
      },
      {
        resourceType: 'source.toolkit.fluxcd.io/Bucket',
        updater: (kustomization, buckets) => updateKustomizationMatchingBuckets(kustomization, buckets),
        isParent: (resource: any, obj: any) => {return false}
      },
      {
        resourceType: 'source.toolkit.fluxcd.io/OCIRepository',
        updater: (kustomization, ocirepositories) => updateKustomizationMatchingOCIRepositories(kustomization, ocirepositories),
        isParent: (resource: any, obj: any) => {return false}
      },
      {
        resourceType: 'core/Event',
        updater: (kustomization, events) => updateKustomizationMatchingEvents(kustomization, events),
        isParent: (resource: any, obj: any) => {return false}
      }
    ]
  },
  'source.toolkit.fluxcd.io/GitRepository': {
    columns: gitRepositoryColumns,
    detailRowRenderer: renderGitRepositoryDetails,
    noSelectClass: true,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Mod+r", description: "Reconcile GitRepository", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile GitRepository with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
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
        shortcut: { key: "Mod+r", description: "Reconcile HelmRepository", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile HelmRepository with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
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
        shortcut: { key: "Mod+r", description: "Reconcile HelmChart", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile HelmChart with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
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
        shortcut: { key: "Mod+r", description: "Reconcile OCIRepository", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile OCIRepository with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
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
        shortcut: { key: "Mod+r", description: "Reconcile Bucket", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile Bucket with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
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
        shortcut: { key: "Mod+r", description: "Reconcile HelmRelease", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile HelmRelease with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
      },
      {
        shortcut: { key: "Enter", description: "View Helm release details", isContextual: true },
        handler: null as any // Implemented in ResourceList navigate handler
      }
    ],
    filter: [fluxReadyFilter],
    abbreviations: ['hr']
  },
  
  'core/Event': {
    columns: eventColumns,
    filter: [eventTypeFilter],
    defaultSortColumn: "LAST SEEN"
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
