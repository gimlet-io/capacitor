// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { JSX } from "solid-js";
import { podColumns } from "./components/resourceList/PodList.tsx";
import { deploymentColumns } from "./components/resourceList/DeploymentList.tsx";
import { serviceColumns, renderServiceDetails } from "./components/resourceList/ServiceList.tsx";
import { ingressColumns } from "./components/resourceList/IngressList.tsx";
import { KustomizationColumns, renderKustomizationDetails } from "./components/resourceList/KustomizationList.tsx";
import { gitRepositoryColumns, renderGitRepositoryDetails } from "./components/resourceList/GitRepositoryList.tsx";
import { helmRepositoryColumns, renderHelmRepositoryDetails } from "./components/resourceList/HelmRepositoryList.tsx";
import { ociRepositoryColumns, renderOCIRepositoryDetails } from "./components/resourceList/OCIRepositoryList.tsx";
import { helmChartColumns, renderHelmChartDetails } from "./components/resourceList/HelmChartList.tsx";
import { helmReleaseFluxColumns, renderHelmReleaseFluxDetails } from "./components/resourceList/HelmReleaseFluxList.tsx";
import { carvelAppColumns, renderCarvelAppDetails } from "./components/resourceList/CarvelAppList.tsx";
import { carvelPackageInstallColumns, renderCarvelPackageInstallDetails } from "./components/resourceList/CarvelPackageInstallList.tsx";
import { terraformColumns, renderTerraformDetails } from "./components/resourceList/TerraformList.tsx";
import { bucketColumns, renderBucketDetails } from "./components/resourceList/BucketList.tsx";
import { applicationColumns, renderApplicationDetails } from "./components/resourceList/ApplicationList.tsx";
import { helmReleaseColumns, helmReleaseStatusFilter, helmReleaseChartFilter } from "./components/resourceList/HelmReleaseList.tsx";
import { eventColumns, eventTypeFilter } from "./components/resourceList/EventList.tsx";
import { kluctlDeploymentColumns, renderKluctlDeploymentDetails } from "./components/resourceList/KluctlDeploymentList.tsx";
import { kluctlDeploymentResultColumns, renderKluctlDeploymentResultsDetails } from "./components/resourceList/KluctlDeploymentResultsList.tsx";
import { KeyboardShortcut } from "./components/keyboardShortcuts/KeyboardShortcuts.tsx";
import { handleScale, handleRolloutRestart } from "./components/resourceList/DeploymentList.tsx";
import { Filter } from "./components/filterBar/FilterBar.tsx";
import { podsStatusFilter, podsReadinessFilter, podsNodeFilter } from "./components/resourceList/PodList.tsx";
import { deploymentReadinessFilter } from "./components/resourceList/DeploymentList.tsx";
import { argocdApplicationSyncFilter, argocdApplicationHealthFilter } from "./components/resourceList/ApplicationList.tsx";
import { builtInCommands } from "./components/resourceList/ResourceList.tsx";
import { nodeColumns, nodeReadinessFilter, nodeRoleFilter } from "./components/resourceList/NodeList.tsx";
import { configMapColumns } from "./components/resourceList/ConfigMapList.tsx";
import { secretColumns, secretTypeFilter } from "./components/resourceList/SecretList.tsx";
import { pvcColumns, pvcStatusFilter, pvcStorageClassFilter } from "./components/resourceList/PersistentVolumeClaimList.tsx";
import { daemonSetColumns, daemonSetReadinessFilter } from "./components/resourceList/DaemonSetList.tsx";
import { namespaceColumns, namespaceStatusFilter } from "./components/resourceList/NamespaceList.tsx";
import { jobColumns, jobStatusFilter, jobNodeFilter } from "./components/resourceList/JobList.tsx";
import { cronJobColumns, cronJobSuspendedFilter, renderCronJobDetails, handleRunCronJobNow } from "./components/resourceList/CronJobList.tsx";
import { hpaColumns, hpaStatusFilter } from "./components/resourceList/HorizontalPodAutoscalerList.tsx";
import { pvColumns, pvPhaseFilter, pvReclaimPolicyFilter } from "./components/resourceList/PersistentVolumeList.tsx";
import { roleColumns, roleVerbFilter, clusterRoleColumns, renderRoleDetails } from "./components/resourceList/RoleList.tsx";
import { roleBindingColumns, roleBindingSubjectKindFilter, roleBindingRoleKindFilter, clusterRoleBindingColumns, renderRoleBindingDetails } from "./components/resourceList/RoleBindingList.tsx";
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
  updateKustomizationMatchingOCIRepositories,
  updateHelmReleaseMatchingEvents,
  updateKluctlDeploymentMatchingEvents,
  updateCronJobMatchingJobs
} from "./utils/k8s.ts";
import { updateJobMatchingResources, updateStatefulSetMatchingResources, updateDaemonSetMatchingResources, updateServiceMatchingPods, updateServiceMatchingIngresses, updateServiceMatchingKustomizations } from "./utils/k8s.ts";

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
  handler: (item: any, contextName?: string) => void | Promise<void>;
}

export interface ResourceCardRenderer {
  render: (resource: any) => JSX.Element;
  width?: number;
  height?: number;
}

export interface ResourceTypeConfig {
  columns: Column<any>[];
  detailRowRenderer?: (item: any, columnCount?: number) => JSX.Element;
  rowKeyField?: string;
  commands?: ResourceCommand[];
  filter?: Filter[];
  defaultSortColumn?: string;
  treeCardRenderer?: ResourceCardRenderer;
  abbreviations?: string[]; // Common abbreviations for this resource type
  extraWatches?: ExtraWatchConfig[];
  // Optional JSONPath-like field refs to project in server watch payloads
  projectFields?: string[];
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

export const navigateToConfigMap: ResourceCommand = {
  shortcut: { key: "Enter", description: "View ConfigMap details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToTerraform: ResourceCommand = {
  shortcut: { key: "Enter", description: "View Terraform details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToKluctlDeployment: ResourceCommand = {
  shortcut: { key: "Enter", description: "View Kluctl deployment details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToCarvelApp: ResourceCommand = {
  shortcut: { key: "Enter", description: "View Carvel App details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

export const navigateToCarvelPackageInstall: ResourceCommand = {
  shortcut: { key: "Enter", description: "View PackageInstall details", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

// Define a command to switch to viewing pods in a namespace
export const showPodsInNamespace: ResourceCommand = {
  shortcut: { key: "Enter", description: "View pods in this namespace", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

// Define a command to view pods related to a resource (workloads/services)
export const showRelatedPods: ResourceCommand = {
  shortcut: { key: "Enter", description: "View related pods", isContextual: true },
  handler: null as any // Will be implemented in ResourceList
};

// Define a command to view pods spawned by a CronJob (via its Jobs)
export const showCronJobPods: ResourceCommand = {
  shortcut: { key: "Enter", description: "View pods for CronJob", isContextual: true },
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
  // Optional JSONPath-like field refs to project for this extra watch payload
  projectFields?: string[];
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
        shortcut: { key: "m", description: "Metrics", isContextual: true },
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
    treeCardRenderer: podCardRenderer,
    projectFields: [
      'spec.nodeName',
      'spec.containers.[*].name',
      'spec.containers.[*].ports',
      'spec.containers.[*].resources.requests',
      'spec.containers.[*].resources.limits',
      'status.phase',
      'status.podIP',
      'status.containerStatuses',
      'status.initContainerStatuses',
      'status.conditions',
      'metadata.deletionTimestamp'
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
      },
      showRelatedPods
    ],
    filter: [deploymentReadinessFilter],
    defaultSortColumn: "NAME",
    treeCardRenderer: deploymentCardRenderer,
    projectFields: [
      'spec.replicas',
      'spec.selector.matchLabels',
      'spec.template.metadata.labels',
      'spec.template.spec.containers.[*].ports',
      'status.readyReplicas',
      'status.updatedReplicas',
      'status.availableReplicas'
    ],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (deployment, pods) => updateDeploymentMatchingResources(deployment, pods),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.labels',
          'spec.nodeName',
          'spec.containers.[*].name',
          'spec.containers.[*].ports',
          'status.phase',
          'status.podIP',
          'status.containerStatuses',
          'status.initContainerStatuses',
          'status.conditions',
          'metadata.deletionTimestamp'
        ]
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
      },
      showRelatedPods
    ],
    filter: [deploymentReadinessFilter],
    defaultSortColumn: "NAME",
    treeCardRenderer: deploymentCardRenderer,
    abbreviations: ['sts'],
    projectFields: [
      'spec.replicas',
      'spec.selector.matchLabels',
      'spec.template.metadata.labels',
      'spec.template.spec.containers.[*].ports',
      'status.readyReplicas'
    ],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (statefulSet, pods) => updateStatefulSetMatchingResources(statefulSet, pods),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.labels',
          'spec.nodeName',
          'spec.containers.[*].name',
          'spec.containers.[*].ports',
          'status.phase',
          'status.podIP',
          'status.containerStatuses',
          'status.initContainerStatuses',
          'status.conditions',
          'metadata.deletionTimestamp'
        ]
      }
    ]
  },
  
  'core/Service': {
    columns: serviceColumns,
    detailRowRenderer: renderServiceDetails,
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Mod+p", description: "Copy port-forward", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      showRelatedPods,
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: serviceCardRenderer,
    abbreviations: ['svc'],
    projectFields: [
      'spec.type',
      'spec.clusterIP',
      'spec.selector',
      'spec.ports.[*].port',
      'spec.ports.[*].targetPort',
      'spec.ports.[*].protocol',
      'status.loadBalancer.ingress'
    ],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (service, pods) => updateServiceMatchingPods(service, pods),
        isParent: (_resource: any, _obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.labels',
          'spec.nodeName',
          'spec.containers.[*].name',
          'spec.containers.[*].ports',
          'status.phase',
          'status.podIP',
          'status.containerStatuses',
          'status.initContainerStatuses',
          'status.conditions',
          'metadata.deletionTimestamp'
        ]
      },
      {
        resourceType: 'networking.k8s.io/Ingress',
        updater: (service, ingresses) => updateServiceMatchingIngresses(service, ingresses),
        isParent: (_resource: any, _obj: any) => {return false},
        projectFields: [
          'spec.rules',
          'spec.defaultBackend',
          'status.loadBalancer.ingress'
        ]
      },
      {
        resourceType: 'kustomize.toolkit.fluxcd.io/Kustomization',
        updater: (service, kustomizations) => updateServiceMatchingKustomizations(service, kustomizations),
        isParent: (_resource: any, _obj: any) => {return false},
        projectFields: [
          'status.inventory.entries',
          'status.conditions',
          'spec.suspend',
          'status.lastHandledReconcileAt',
          'status.lastAppliedRevision',
          'status.lastAttemptedRevision'
        ]
      }
    ]
  },
  
  'networking.k8s.io/Ingress': {
    columns: ingressColumns,
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: ingressCardRenderer,
    projectFields: [
      'spec.ingressClassName',
      'spec.rules',
      'spec.tls',
      'status.loadBalancer.ingress'
    ]
  },
  
  'core/Node': {
    columns: nodeColumns,
    filter: [nodeReadinessFilter, nodeRoleFilter],
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: nodeCardRenderer,
    projectFields: [
      'spec.unschedulable',
      'status.conditions',
      'status.addresses',
      'status.nodeInfo'
    ]
  },
  
  'core/ConfigMap': {
    columns: configMapColumns,
    commands: [
      ...builtInCommands,
      navigateToConfigMap
    ],
    defaultSortColumn: "NAME",
    abbreviations: ['cm'],
    projectFields: []
  },
  
  'core/Secret': {
    columns: secretColumns,
    filter: [secretTypeFilter],
    commands: [
      ...builtInCommands,
      navigateToSecret
    ],
    defaultSortColumn: "NAME",
    // Do not include data in watch payloads for security/perf; count shown may be 0
    projectFields: [
      'type'
    ]
  },
  
  'core/PersistentVolumeClaim': {
    columns: pvcColumns,
    filter: [pvcStatusFilter, pvcStorageClassFilter],
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: pvcCardRenderer,
    abbreviations: ['pvc'],
    projectFields: [
      'spec.storageClassName',
      'status.phase',
      'status.capacity'
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
      ...builtInCommands,
      {
        shortcut: { key: "Mod+r", description: "Rollout restart", isContextual: true },
        handler: handleRolloutRestart
      },
      showRelatedPods
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: daemonSetCardRenderer,
    abbreviations: ['ds'],
    projectFields: [
      'spec.selector.matchLabels',
      'spec.template.metadata.labels',
      'status.desiredNumberScheduled',
      'status.numberReady',
      'status.updatedNumberScheduled'
    ],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (daemonSet, pods) => updateDaemonSetMatchingResources(daemonSet, pods),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.labels',
          'spec.nodeName',
          'spec.containers.[*].name',
          'spec.containers.[*].ports',
          'status.phase',
          'status.podIP',
          'status.containerStatuses',
          'status.initContainerStatuses',
          'status.conditions',
          'metadata.deletionTimestamp'
        ]
      }
    ]
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
    projectFields: [
      'spec.replicas',
      'spec.selector.matchLabels',
      'spec.template.metadata.labels',
      'status.readyReplicas'
    ],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (replicaSet, pods) => updateReplicaSetMatchingResources(replicaSet, pods),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.labels',
          'spec.nodeName',
          'spec.containers.[*].name',
          'spec.containers.[*].ports',
          'status.phase',
          'status.podIP',
          'status.containerStatuses',
          'status.initContainerStatuses',
          'status.conditions',
          'metadata.deletionTimestamp'
        ]
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
    abbreviations: ['ns'],
    projectFields: [
      'status.phase'
    ]
  },
  
  'batch/Job': {
    columns: jobColumns,
    filter: [jobStatusFilter, jobNodeFilter],
    commands: [
      {
        shortcut: { key: "l", description: "Logs", isContextual: true },
        handler: null as any  // Will be implemented in ResourceList
      },
      ...builtInCommands,
      showRelatedPods
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: jobCardRenderer,
    projectFields: [
      'spec.selector.matchLabels',
      'spec.template.metadata.labels',
      'status.active',
      'status.succeeded',
      'status.failed',
      'status.conditions',
      'status.ready'
    ],
    extraWatches: [
      {
        resourceType: 'core/Pod',
        updater: (job, pods) => updateJobMatchingResources(job, pods),
        isParent: (_resource: any, _obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.labels',
          'spec.nodeName',
          'spec.containers.[*].name',
          'spec.containers.[*].ports',
          'status.phase',
          'status.podIP',
          'status.containerStatuses',
          'status.initContainerStatuses',
          'status.conditions',
          'metadata.deletionTimestamp'
        ]
      }
    ]
  },
  
  'batch/CronJob': {
    columns: cronJobColumns,
    filter: [cronJobSuspendedFilter],
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Mod+t", description: "Run CronJob now", isContextual: true },
        handler: handleRunCronJobNow
      },
      showCronJobPods
    ],
    defaultSortColumn: "NAME",
    treeCardRenderer: cronJobCardRenderer,
    abbreviations: ['cj'],
    projectFields: [
      'spec.schedule',
      'spec.suspend',
      'spec.timeZone',
      'spec.concurrencyPolicy',
      'spec.successfulJobsHistoryLimit',
      'spec.failedJobsHistoryLimit',
      'spec.jobTemplate.spec.template.metadata.labels',
      'status.lastScheduleTime'
     ],
    detailRowRenderer: renderCronJobDetails,
    extraWatches: [
      {
        resourceType: 'batch/Job',
        updater: (cronJob, jobs) => updateCronJobMatchingJobs(cronJob, jobs),
        isParent: (_resource: any, _obj: any) => {return false},
        projectFields: [
          'metadata.name',
          'metadata.namespace',
          'metadata.ownerReferences',
          'metadata.creationTimestamp',
          'spec.completions',
          'spec.template.metadata.labels',
          'status.startTime',
          'status.completionTime',
          'status.succeeded',
          'status.failed',
          'status.active'
        ]
      }
    ]
  },
  
  'autoscaling/HorizontalPodAutoscaler': {
    columns: hpaColumns,
    filter: [hpaStatusFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['hpa'],
    projectFields: [
      'spec.scaleTargetRef.kind',
      'spec.scaleTargetRef.name',
      'spec.targetCPUUtilizationPercentage',
      'spec.metrics',
      'spec.minReplicas',
      'spec.maxReplicas',
      'status.currentCPUUtilizationPercentage',
      'status.currentReplicas',
      'status.conditions'
    ]
  },
  
  'core/PersistentVolume': {
    columns: pvColumns,
    filter: [pvPhaseFilter, pvReclaimPolicyFilter],
    commands: [
      ...builtInCommands
    ],
    treeCardRenderer: pvCardRenderer,
    abbreviations: ['pv'],
    projectFields: [
      'status.phase',
      'spec.capacity',
      'spec.persistentVolumeReclaimPolicy'
    ]
  },
  
  'rbac.authorization.k8s.io/Role': {
    columns: roleColumns,
    detailRowRenderer: renderRoleDetails,
    filter: [roleVerbFilter],
    commands: [
      ...builtInCommands
    ],
    projectFields: [
      'rules'
    ]
  },
  
  'rbac.authorization.k8s.io/ClusterRole': {
    columns: clusterRoleColumns,
    detailRowRenderer: renderRoleDetails,
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['cr'],
    projectFields: [
      'rules'
    ]
  },
  
  'rbac.authorization.k8s.io/RoleBinding': {
    columns: roleBindingColumns,
    detailRowRenderer: renderRoleBindingDetails,
    filter: [roleBindingSubjectKindFilter, roleBindingRoleKindFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['rb'],
    projectFields: [
      'roleRef.kind',
      'roleRef.name',
      'subjects'
    ]
  },
  
  'rbac.authorization.k8s.io/ClusterRoleBinding': {
    columns: clusterRoleBindingColumns,
    detailRowRenderer: renderRoleBindingDetails,
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['crb'],
    projectFields: [
      'roleRef.kind',
      'roleRef.name',
      'subjects'
    ]
  },
  
  'core/ServiceAccount': {
    columns: serviceAccountColumns,
    filter: [serviceAccountAutomountFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['sa'],
    projectFields: [
      'secrets',
      'imagePullSecrets',
      'automountServiceAccountToken'
    ]
  },
  
  'networking.k8s.io/NetworkPolicy': {
    columns: networkPolicyColumns,
    filter: [networkPolicyTypeFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['netpol'],
    projectFields: [
      'spec.podSelector',
      'spec.policyTypes',
      'spec.ingress',
      'spec.egress'
    ]
  },
  
  'policy/PodDisruptionBudget': {
    columns: podDisruptionBudgetColumns,
    commands: [
      ...builtInCommands
    ],
    defaultSortColumn: "NAME",
    abbreviations: ['pdb'],
    projectFields: [
      'spec.minAvailable',
      'spec.maxUnavailable',
      'status.disruptionsAllowed',
      'status.currentHealthy',
      'status.desiredHealthy',
      'status.expectedPods'
    ]
  },
  
  'keda.sh/ScaledJob': {
    columns: scaledJobColumns,
    filter: [scaledJobTriggerFilter, scaledJobStrategyFilter],
    commands: [
      ...builtInCommands
    ],
    abbreviations: ['sj'],
    projectFields: [
      'spec.triggers',
      'spec.maxReplicaCount',
      'spec.pollingInterval',
      'spec.scalingStrategy.strategy',
      'status.conditions'
    ]
  },
  
  'helm.sh/Release': {
    columns: helmReleaseColumns,
    filter: [helmReleaseStatusFilter, helmReleaseChartFilter],
    commands: [
      navigateToHelmClassicReleaseDetails,
    ],
    projectFields: [
      'spec.chart',
      'spec.chartVersion',
      'status.status',
      'status.revision',
      'status.appVersion'
    ]
  },
  
  'kustomize.toolkit.fluxcd.io/Kustomization': {
    columns: KustomizationColumns,
    detailRowRenderer: renderKustomizationDetails,
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
    projectFields: [
      'spec.sourceRef.kind',
      'spec.sourceRef.name',
      'spec.sourceRef.namespace',
      'spec.path',
      'spec.prune',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ],
    abbreviations: ['ks'],
    extraWatches: [
      {
        resourceType: 'source.toolkit.fluxcd.io/GitRepository',
        updater: (kustomization, gitRepositories) => updateKustomizationMatchingGitRepositories(kustomization, gitRepositories),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'spec.url',
          'status.conditions'
        ]
      },
      {
        resourceType: 'source.toolkit.fluxcd.io/Bucket',
        updater: (kustomization, buckets) => updateKustomizationMatchingBuckets(kustomization, buckets),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'status.conditions'
        ]
      },
      {
        resourceType: 'source.toolkit.fluxcd.io/OCIRepository',
        updater: (kustomization, ocirepositories) => updateKustomizationMatchingOCIRepositories(kustomization, ocirepositories),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'status.conditions'
        ]
      },
      {
        resourceType: 'core/Event',
        updater: (kustomization, events) => updateKustomizationMatchingEvents(kustomization, events),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'type',
          'lastTimestamp',
          'reason',
          'involvedObject',
          'message',
          'source.component'
        ]
      }
    ]
  },
  'source.toolkit.fluxcd.io/GitRepository': {
    columns: gitRepositoryColumns,
    detailRowRenderer: renderGitRepositoryDetails,
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
    filter: [fluxReadyFilter],
    projectFields: [
      'spec.url',
      'spec.ref',
      'spec.secretRef.name',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ]
  },
  
  'source.toolkit.fluxcd.io/HelmRepository': {
    columns: helmRepositoryColumns,
    detailRowRenderer: renderHelmRepositoryDetails,
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
    filter: [fluxReadyFilter],
    projectFields: [
      'spec.url',
      'spec.secretRef.name',
      'spec.passCredentials',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ]
  },
  
  'source.toolkit.fluxcd.io/HelmChart': {
    columns: helmChartColumns,
    detailRowRenderer: renderHelmChartDetails,
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
    filter: [fluxReadyFilter],
    projectFields: [
      'spec.chart',
      'spec.sourceRef.kind',
      'spec.sourceRef.name',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ]
  },
  
  'source.toolkit.fluxcd.io/OCIRepository': {
    columns: ociRepositoryColumns,
    detailRowRenderer: renderOCIRepositoryDetails,
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
    filter: [fluxReadyFilter],
    projectFields: [
      'spec.url',
      'spec.secretRef.name',
      'spec.serviceAccountName',
      'spec.insecure',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ]
  },
  
  'source.toolkit.fluxcd.io/Bucket': {
    columns: bucketColumns,
    detailRowRenderer: renderBucketDetails,
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
    filter: [fluxReadyFilter],
    projectFields: [
      'spec.bucketName',
      'spec.endpoint',
      'spec.provider',
      'spec.secretRef.name',
      'spec.insecure',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ]
  },
  
  'helm.toolkit.fluxcd.io/HelmRelease': {
    columns: helmReleaseFluxColumns,
    detailRowRenderer: renderHelmReleaseFluxDetails,
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
    projectFields: [
      'spec.chart.spec.chart',
      'spec.chart.spec.sourceRef.kind',
      'spec.chart.spec.sourceRef.name',
      'spec.chart.spec.version',
      'spec.releaseName',
      'spec.targetNamespace',
      'spec.interval',
      'spec.suspend',
      'status.conditions'
    ],
    abbreviations: ['hr'],
    extraWatches: [
      {
        resourceType: 'core/Event',
        updater: (helmRelease, events) => updateHelmReleaseMatchingEvents(helmRelease, events),
        isParent: (resource: any, obj: any) => {return false},
        projectFields: [
          'type',
          'lastTimestamp',
          'reason',
          'involvedObject',
          'message',
          'source.component'
        ]
      }
    ]
  },

  'kappctrl.k14s.io/App': {
    columns: carvelAppColumns,
    detailRowRenderer: renderCarvelAppDetails,
    rowKeyField: "name",
    commands: [
      navigateToCarvelApp,
      ...builtInCommands
    ],
    projectFields: [
      'spec.syncPeriod',
      'spec.paused',
      'spec.canceled',
      'spec.fetch',
      'spec.template',
      'spec.cluster',
      'status.friendlyDescription',
      'status.usefulErrorMessage',
      'status.conditions',
      'status.consecutiveReconcileSuccesses',
      'status.consecutiveReconcileFailures',
      'status.deploy',
      'status.fetch',
      'status.template'
    ]
  },

  'packaging.carvel.dev/PackageInstall': {
    columns: carvelPackageInstallColumns,
    detailRowRenderer: renderCarvelPackageInstallDetails,
    rowKeyField: "name",
    commands: [
      navigateToCarvelPackageInstall,
      ...builtInCommands
    ],
    projectFields: [
      'spec.packageRef',
      'spec.syncPeriod',
      'spec.paused',
      'spec.canceled',
      'status.friendlyDescription',
      'status.usefulErrorMessage',
      'status.version',
      'status.lastAttemptedVersion',
      'status.conditions',
      'status.consecutiveReconcileSuccesses',
      'status.consecutiveReconcileFailures',
      'status.deploy',
      'status.fetch'
    ]
  },
  
  'infra.contrib.fluxcd.io/Terraform': {
    columns: terraformColumns,
    detailRowRenderer: renderTerraformDetails,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      {
        shortcut: { key: "Mod+r", description: "Reconcile Terraform", isContextual: true },
        handler: handleFluxReconcile
      },
      {
        shortcut: { key: "Mod+w", description: "Reconcile Terraform with sources", isContextual: true },
        handler: handleFluxReconcileWithSources
      },
      navigateToTerraform
    ],
    filter: [fluxReadyFilter],
    projectFields: [
      'spec.sourceRef.kind',
      'spec.sourceRef.namespace',
      'spec.sourceRef.name',
      'spec.path',
      'spec.interval',
      'spec.approvePlan',
      'spec.suspend',
      'status.conditions'
    ],
    abbreviations: ['tf']
  },
  
  'kluctl.io/Deployment': {
    columns: kluctlDeploymentResultColumns,
    detailRowRenderer: renderKluctlDeploymentResultsDetails,
    rowKeyField: "name",
    commands: [
      navigateToKluctlDeployment
    ],
    defaultSortColumn: "NAME",
    projectFields: [
      'spec.project',
      'spec.target',
      'status.latestResult',
      'status.commandSummaries'
    ]
  },
  
  'gitops.kluctl.io/KluctlDeployment': {
    columns: kluctlDeploymentColumns,
    detailRowRenderer: renderKluctlDeploymentDetails,
    rowKeyField: "name",
    commands: [
      ...builtInCommands,
      navigateToKluctlDeployment
    ],
    defaultSortColumn: "NAME",
    projectFields: [
      'spec.interval',
      'spec.target',
      'spec.source.git.url',
      'spec.source.git.path',
      'spec.validate',
      'spec.args',
      'spec.context',
      'spec.prune',
      'spec.delete',
      'spec.suspend',
      'status.conditions',
      'status.lastDriftDetectionResultMessage',
      'status.lastDriftDetectionResult',
      'status.lastValidateResult',
      'status.lastDeployResult',
      'status.lastAppliedRevision',
      'status.lastAttemptedRevision'
    ],
    extraWatches: [
      {
        resourceType: 'core/Event',
        updater: (deployment, events) => updateKluctlDeploymentMatchingEvents(deployment, events),
        isParent: (_resource: any, _obj: any) => {return false},
        projectFields: [
          'type',
          'lastTimestamp',
          'reason',
          'involvedObject',
          'message',
          'source.component'
        ]
      }
    ]
  },
  
  'core/Event': {
    columns: eventColumns,
    filter: [eventTypeFilter],
    defaultSortColumn: "LAST SEEN",
    projectFields: [
      'type',
      'lastTimestamp',
      'count',
      'reason',
      'involvedObject',
      'message',
      'source.component'
    ]
  },
  
  'argoproj.io/Application': {
    columns: applicationColumns,
    detailRowRenderer: renderApplicationDetails,
    rowKeyField: "name",
    commands: [
      navigateToApplication
    ],
    filter: [argocdApplicationSyncFilter, argocdApplicationHealthFilter],
    projectFields: [
      'status.sync.status',
      'status.health.status',
      'spec.source.repoURL',
      'spec.source.path',
      'status.sync.revision'
    ]
  }
};
