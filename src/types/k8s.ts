// Basic metadata interfaces
import { Filter } from "../components/filterBar/FilterBar.tsx";

export interface ObjectMeta {
    name: string;
    namespace: string;
    labels?: { [key: string]: string };
    annotations?: { [key: string]: string };
    creationTimestamp?: string;
    uid?: string;
    ownerReferences?: Array<{
        apiVersion: string;
        kind: string;
        name: string;
        uid: string;
        controller?: boolean;
        blockOwnerDeletion?: boolean;
    }>;
    deletionTimestamp?: string;
}

export interface ListMeta {
    continue?: string;
    remainingItemCount?: number;
    resourceVersion?: string;
    selfLink?: string;
}

// Container related interfaces
export interface Container {
    name: string;
    image: string;
    command?: string[];
    args?: string[];
    ports?: ContainerPort[];
    resources?: {
        limits?: { [key: string]: string };
        requests?: { [key: string]: string };
    };
}

export interface ContainerPort {
    containerPort: number;
    protocol?: string;
    name?: string;
}

// Pod related interfaces
export interface PodSpec {
    containers: Container[];
    nodeName?: string;
    serviceAccountName?: string;
    restartPolicy?: string;
}

export interface PodStatus {
    phase: string;
    conditions?: PodCondition[];
    hostIP?: string;
    podIP?: string;
    startTime?: string;
    containerStatuses?: ContainerStatus[];
}

export interface PodCondition {
    type: string;
    status: string;
    lastProbeTime?: string;
    lastTransitionTime?: string;
    reason?: string;
    message?: string;
}

export interface ContainerStatus {
    name: string;
    ready: boolean;
    restartCount: number;
    state?: {
        running?: { startedAt: string };
        waiting?: { reason: string; message: string };
        terminated?: { 
            exitCode: number;
            reason: string;
            message?: string;
            startedAt?: string;
            finishedAt?: string;
        };
    };
}

export interface Pod {
    apiVersion?: string;
    kind?: string;
    metadata: ObjectMeta;
    spec: PodSpec;
    status: PodStatus;
}

export interface PodList {
    apiVersion: string;
    kind: string;
    metadata: ListMeta;
    items: Pod[];
}

export interface DeploymentSpec {
    replicas?: number;
    selector: {
        matchLabels: { [key: string]: string };
    };
    template: {
        metadata: ObjectMeta;
        spec: PodSpec;
    };
}

export interface DeploymentStatus {
    availableReplicas: number;
    readyReplicas: number;
    replicas: number;
    updatedReplicas: number;
}

export interface Deployment {
    apiVersion: string;
    kind: string;
    metadata: ObjectMeta;
    spec: DeploymentSpec;
    status: DeploymentStatus;
}

export interface DeploymentList {
    apiVersion: string;
    kind: string;
    metadata: ListMeta;
    items: Deployment[];
}

export interface DeploymentWithResources extends Deployment {
  pods: Pod[];
  replicaSets: ReplicaSetWithResources[];
}

export interface ServicePort {
    name?: string;
    protocol?: string;
    port: number;
    targetPort?: number | string;
    nodePort?: number;
}

export interface ServiceSpec {
    ports?: ServicePort[];
    selector?: { [key: string]: string };
    clusterIP?: string;
    type?: string;
    externalIPs?: string[];
}

export interface Service {
    apiVersion: string;
    kind: string;
    metadata: ObjectMeta;
    spec: ServiceSpec;
}

export interface ServiceList {
    apiVersion: string;
    kind: string;
    metadata: ListMeta;
    items: Service[];
}

export interface ServiceWithResources extends Service {
  matchingPods: Pod[];
  matchingDeployments: Deployment[];
}

import { Condition } from "../utils/conditions.ts";

export interface Kustomization {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: {
    path: string;
    sourceRef: {
      kind: string;
      name: string;
    };
    interval: string;
    prune: boolean;
    validation?: string;
    suspend?: boolean;
    healthChecks?: Array<{
      apiVersion: string;
      kind: string;
      name: string;
      namespace: string;
    }>;
  };
  status?: {
    conditions?: Condition[];
    lastAppliedRevision?: string;
    lastAttemptedRevision?: string;
    inventory?: {
      entries?: Array<{
        id: string;
        v: string;
      }>;
    };
  };
}

export interface KustomizationWithInventory extends Kustomization {
  inventoryItems: {
    deployments: DeploymentWithResources[];
    services: Service[];
  };
}

export interface Source {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: {
    interval: string;
    timeout?: string;
    suspend?: boolean;
  };
  status?: {
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime: string;
    }>;
    artifact?: {
      path: string;
      url: string;
      revision: string;
      checksum?: string;
      lastUpdateTime: string;
    };
  };
}

export interface OCIRepository extends Source {
  spec: Source['spec'] & {
    url: string;
    provider?: string;
    secretRef?: {
      name: string;
    };
    serviceAccountName?: string;
    certSecretRef?: {
      name: string;
    };
    insecure?: boolean;
    interval: string;
  };
}

export interface HelmRepository extends Source {
  spec: Source['spec'] & {
    url: string;
    secretRef?: {
      name: string;
    };
    passCredentials?: boolean;
    interval: string;
  };
}

export interface HelmChart extends Source {
  spec: Source['spec'] & {
    chart: string;
    sourceRef: {
      kind: string;
      name: string;
    };
    interval: string;
    valuesFiles?: string[];
    valuesFrom?: Array<{
      kind: string;
      name: string;
    }>;
  };
}

export interface GitRepository extends Source {
  spec: Source['spec'] & {
    url: string;
    secretRef?: {
      name: string;
    };
    interval: string;
    ref?: {
      branch?: string;
      tag?: string;
      semver?: string;
      commit?: string;
    };
    ignore?: string;
    timeout?: string;
  };
}

export interface Event {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  involvedObject: {
    kind: string;
    namespace: string;
    name: string;
  };
  type: string;
  reason: string;
  message: string;
  firstTimestamp: string;
  lastTimestamp: string;
  count: number;
  source: {
    component: string;
  };
}

// ArgoCD types
export interface ArgoCDApplication {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    creationTimestamp?: string;
  };
  spec: {
    project: string;
    source: {
      repoURL: string;
      targetRevision?: string;
      path?: string;
      chart?: string;
      helm?: {
        valueFiles?: string[];
        parameters?: Array<{
          name: string;
          value: string;
        }>;
      };
    };
    destination: {
      server?: string;
      namespace: string;
      name?: string;
    };
    syncPolicy?: {
      automated?: {
        prune: boolean;
        selfHeal: boolean;
      };
      syncOptions?: string[];
      retry?: {
        limit: number;
        backoff?: {
          duration: string;
          factor: number;
          maxDuration: string;
        };
      };
    };
  };
  status?: {
    sync: {
      status: string;
      comparedTo: {
        source: {
          repoURL: string;
          targetRevision: string;
          path?: string;
          chart?: string;
        };
        destination: {
          server?: string;
          namespace: string;
        };
      };
      revision: string;
    };
    health: {
      status: string;
      message?: string;
    };
    history?: Array<{
      revision: string;
      deployedAt: string;
      id: number;
      source: {
        repoURL: string;
        targetRevision: string;
        path?: string;
        chart?: string;
      };
    }>;
    operationState?: {
      operation: {
        sync: {
          revision: string;
        };
      };
      phase: string;
      message: string;
      startedAt: string;
      finishedAt?: string;
    };
    conditions?: Array<{
      type: string;
      status: string;
      message: string;
      lastTransitionTime: string;
    }>;
    reconciledAt: string;
    observedAt: string;
    resources?: Array<{
      group: string;
      version: string;
      kind: string;
      namespace: string;
      name: string;
      status: string;
      message?: string;
      health?: {
        status: string;
      };
    }>;
  };
}

export interface ArgoCDApplicationWithResources extends ArgoCDApplication {
  resources: {
    deployments: DeploymentWithResources[];
    services: Service[];
  };
}

export interface ReplicaSet {
  metadata: ObjectMeta;
  spec: {
    replicas: number;
    selector: {
      matchLabels: { [key: string]: string };
    };
    template: {
      metadata: ObjectMeta;
      spec: PodSpec;
    };
  };
  status: {
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
  };
}

export interface ReplicaSetWithResources extends ReplicaSet {
  pods: Pod[];
}

export interface ReplicaSet {
  metadata: ObjectMeta;
  spec: {
    replicas: number;
    selector: {
      matchLabels: { [key: string]: string };
    };
    template: {
      metadata: ObjectMeta;
      spec: PodSpec;
    };
  };
  status: {
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
  };
}

export interface ReplicaSetWithResources extends ReplicaSet {
  pods: Pod[];
}

// API Resource type definitions
export interface ApiResource {
  name: string;
  singularName: string;
  namespaced: boolean;
  kind: string;
  verbs: string[];
  shortNames?: string[];
  group?: string;
  version?: string;
  apiPath?: string;
}

export interface ApiResourceList {
  groupVersion: string;
  apiVersion: string;
  kind: string;
  resources: ApiResource[];
}

export interface ApiGroup {
  name: string;
  versions: Array<{
    groupVersion: string;
    version: string;
  }>;
  preferredVersion: {
    groupVersion: string;
    version: string;
  };
}

export interface ApiGroupList {
  apiVersion: string;
  kind: string;
  groups: ApiGroup[];
}

export interface K8sResource {
  id: string;
  filters: Filter[];
  group: string;
  version: string;
  kind: string;
  apiPath: string;
  name?: string;
  namespaced: boolean;
} 