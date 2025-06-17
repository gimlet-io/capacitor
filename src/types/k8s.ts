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
    initContainerStatuses?: ContainerStatus[];
    reason?: string;
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
}

export interface ServiceStatus {
    loadBalancer?: {
        ingress?: Array<{
            ip?: string;
            hostname?: string;
        }>;
    };
}

export interface Service {
    apiVersion: string;
    kind: string;
    metadata: ObjectMeta;
    spec: ServiceSpec;
    status?: ServiceStatus;
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
      namespace?: string;
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
    lastHandledReconcileAt?: string;
    inventory?: {
      entries?: Array<{
        id: string;
        v: string;
      }>;
    };
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

export interface HelmRelease {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: {
    chart: {
      spec: {
        chart: string;
        version?: string;
        sourceRef: {
          kind: string;
          name: string;
          namespace?: string;
        };
      };
    };
    interval: string;
    suspend?: boolean;
    releaseName?: string;
    targetNamespace?: string;
    values?: any;
  };
  status?: {
    conditions?: Condition[];
    lastAppliedRevision?: string;
    lastAttemptedRevision?: string;
    helmChart?: string;
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

// StatefulSet related interfaces
export interface StatefulSetSpec {
  replicas?: number;
  selector: {
    matchLabels: { [key: string]: string };
  };
  serviceName: string;
  template: {
    metadata: ObjectMeta;
    spec: PodSpec;
  };
  volumeClaimTemplates?: Array<{
    metadata: ObjectMeta;
    spec: {
      accessModes: string[];
      resources: {
        requests: {
          storage: string;
        };
      };
      storageClassName?: string;
    };
  }>;
}

export interface StatefulSetStatus {
  availableReplicas: number;
  readyReplicas: number;
  replicas: number;
  updatedReplicas: number;
  currentReplicas?: number;
}

export interface StatefulSet {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: StatefulSetSpec;
  status: StatefulSetStatus;
}

export interface StatefulSetList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: StatefulSet[];
}

export interface StatefulSetWithResources extends StatefulSet {
  pods: Pod[];
}

export interface IngressRule {
  host?: string;
  http?: {
    paths: Array<{
      path?: string;
      pathType?: string;
      backend: {
        service?: {
          name: string;
          port: {
            name?: string;
            number?: number;
          };
        };
        resource?: {
          apiGroup: string;
          kind: string;
          name: string;
        };
      };
    }>;
  };
}

export interface IngressTLS {
  hosts?: string[];
  secretName?: string;
}

export interface IngressSpec {
  rules?: IngressRule[];
  tls?: IngressTLS[];
  ingressClassName?: string;
  defaultBackend?: {
    service?: {
      name: string;
      port: {
        name?: string;
        number?: number;
      };
    };
    resource?: {
      apiGroup: string;
      kind: string;
      name: string;
    };
  };
}

export interface IngressStatus {
  loadBalancer?: {
    ingress?: Array<{
      ip?: string;
      hostname?: string;
    }>;
  };
}

export interface Ingress {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: IngressSpec;
  status?: IngressStatus;
}

export interface IngressList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: Ingress[];
}

export interface IngressWithResources extends Ingress {
  relatedServices: Service[];
}

export interface NodeCondition {
  type: string;
  status: string;
  lastHeartbeatTime?: string;
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface NodeAddress {
  type: string;
  address: string;
}

export interface NodeStatus {
  conditions?: NodeCondition[];
  addresses?: NodeAddress[];
  phase?: string;
  nodeInfo?: {
    architecture: string;
    bootID: string;
    containerRuntimeVersion: string;
    kernelVersion: string;
    kubeProxyVersion: string;
    kubeletVersion: string;
    machineID: string;
    operatingSystem: string;
    osImage: string;
    systemUUID: string;
  };
  capacity?: {
    cpu?: string;
    memory?: string;
    pods?: string;
    [key: string]: string | undefined;
  };
  allocatable?: {
    cpu?: string;
    memory?: string;
    pods?: string;
    [key: string]: string | undefined;
  };
}

export interface NodeSpec {
  podCIDR?: string;
  podCIDRs?: string[];
  providerID?: string;
  unschedulable?: boolean;
  taints?: {
    key: string;
    value: string;
    effect: string;
  }[];
}

export interface Node {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: NodeSpec;
  status: NodeStatus;
}

export interface NodeList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: Node[];
}

export interface ConfigMap {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  data?: { [key: string]: string };
  binaryData?: { [key: string]: string }; // base64 encoded
}

export interface ConfigMapList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: ConfigMap[];
}

export interface Secret {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  type?: string;
  data?: { [key: string]: string }; // base64 encoded
  stringData?: { [key: string]: string }; // not base64 encoded
}

export interface SecretList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: Secret[];
}

export interface PersistentVolumeClaimSpec {
  accessModes?: string[];
  resources?: {
    requests?: {
      storage?: string;
    };
    limits?: {
      storage?: string;
    };
  };
  storageClassName?: string;
  volumeName?: string;
  volumeMode?: string;
  dataSource?: {
    apiGroup?: string;
    kind: string;
    name: string;
  };
  selector?: {
    matchLabels?: { [key: string]: string };
    matchExpressions?: Array<{
      key: string;
      operator: string;
      values?: string[];
    }>;
  };
}

export interface PersistentVolumeClaimStatus {
  phase?: string;
  accessModes?: string[];
  capacity?: {
    storage?: string;
  };
}

export interface PersistentVolumeClaim {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: PersistentVolumeClaimSpec;
  status?: PersistentVolumeClaimStatus;
}

export interface PersistentVolumeClaimList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: PersistentVolumeClaim[];
}

export interface DaemonSetSpec {
  selector: {
    matchLabels: { [key: string]: string };
  };
  template: {
    metadata: ObjectMeta;
    spec: PodSpec;
  };
  updateStrategy?: {
    type?: string;
    rollingUpdate?: {
      maxUnavailable?: number | string;
    };
  };
  minReadySeconds?: number;
  revisionHistoryLimit?: number;
}

export interface DaemonSetStatus {
  currentNumberScheduled: number;
  desiredNumberScheduled: number;
  numberMisscheduled: number;
  numberReady: number;
  updatedNumberScheduled?: number;
  numberAvailable?: number;
  numberUnavailable?: number;
  observedGeneration?: number;
}

export interface DaemonSet {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: DaemonSetSpec;
  status: DaemonSetStatus;
}

export interface DaemonSetList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: DaemonSet[];
}

// Namespace
export interface NamespaceSpec {
  finalizers?: string[];
}

export interface NamespaceStatus {
  phase: string; // "Active", "Terminating"
}

export interface Namespace {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec?: NamespaceSpec;
  status?: NamespaceStatus;
}

export interface NamespaceList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: Namespace[];
}

// Job
export interface JobSpec {
  parallelism?: number;
  completions?: number;
  activeDeadlineSeconds?: number;
  backoffLimit?: number;
  selector?: {
    matchLabels?: { [key: string]: string };
  };
  template: {
    metadata?: ObjectMeta;
    spec: PodSpec;
  };
  ttlSecondsAfterFinished?: number;
}

export interface JobStatus {
  active?: number;
  succeeded?: number;
  failed?: number;
  completionTime?: string;
  startTime?: string;
  conditions?: Array<{
    type: string;
    status: string;
    lastProbeTime?: string;
    lastTransitionTime?: string;
    reason?: string;
    message?: string;
  }>;
}

export interface Job {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: JobSpec;
  status?: JobStatus;
}

export interface JobList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: Job[];
}

// CronJob
export interface CronJobSpec {
  schedule: string;
  timeZone?: string;
  startingDeadlineSeconds?: number;
  concurrencyPolicy?: string; // "Allow", "Forbid", "Replace"
  suspend?: boolean;
  jobTemplate: {
    metadata?: ObjectMeta;
    spec: JobSpec;
  };
  successfulJobsHistoryLimit?: number;
  failedJobsHistoryLimit?: number;
}

export interface CronJobStatus {
  active?: Array<{
    apiVersion?: string;
    kind?: string;
    name: string;
    namespace: string;
    uid?: string;
  }>;
  lastScheduleTime?: string;
  lastSuccessfulTime?: string;
}

export interface CronJob {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: CronJobSpec;
  status?: CronJobStatus;
}

export interface CronJobList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: CronJob[];
}

// HorizontalPodAutoscaler
export interface HorizontalPodAutoscalerSpec {
  scaleTargetRef: {
    apiVersion: string;
    kind: string;
    name: string;
  };
  minReplicas?: number;
  maxReplicas: number;
  targetCPUUtilizationPercentage?: number;
  metrics?: Array<{
    type: string;
    resource?: {
      name: string;
      target: {
        type: string;
        averageUtilization?: number;
        averageValue?: string;
        value?: string;
      };
    };
    pods?: {
      metric: {
        name: string;
      };
      target: {
        type: string;
        averageValue: string;
      };
    };
    object?: {
      metric: {
        name: string;
      };
      target: {
        type: string;
        value?: string;
        averageValue?: string;
      };
      describedObject: {
        kind: string;
        name: string;
        apiVersion?: string;
      };
    };
    external?: {
      metric: {
        name: string;
      };
      target: {
        type: string;
        value?: string;
        averageValue?: string;
      };
    };
  }>;
  behavior?: {
    scaleUp?: {
      stabilizationWindowSeconds?: number;
      selectPolicy?: string;
      policies?: Array<{
        type: string;
        value: number;
        periodSeconds: number;
      }>;
    };
    scaleDown?: {
      stabilizationWindowSeconds?: number;
      selectPolicy?: string;
      policies?: Array<{
        type: string;
        value: number;
        periodSeconds: number;
      }>;
    };
  };
}

export interface HorizontalPodAutoscalerStatus {
  observedGeneration?: number;
  lastScaleTime?: string;
  currentReplicas: number;
  desiredReplicas: number;
  currentCPUUtilizationPercentage?: number;
  conditions?: Array<{
    type: string;
    status: string;
    lastTransitionTime?: string;
    reason?: string;
    message?: string;
  }>;
}

export interface HorizontalPodAutoscaler {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: HorizontalPodAutoscalerSpec;
  status?: HorizontalPodAutoscalerStatus;
}

export interface HorizontalPodAutoscalerList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: HorizontalPodAutoscaler[];
}

// PersistentVolume
export interface PersistentVolumeSpec {
  capacity?: {
    storage?: string;
  };
  accessModes?: string[];
  persistentVolumeReclaimPolicy?: string; // "Retain", "Delete", "Recycle"
  storageClassName?: string;
  mountOptions?: string[];
  volumeMode?: string; // "Filesystem", "Block"
  claimRef?: {
    kind?: string;
    namespace?: string;
    name?: string;
    uid?: string;
  };
  nodeAffinity?: {
    required?: {
      nodeSelectorTerms: Array<{
        matchExpressions?: Array<{
          key: string;
          operator: string;
          values?: string[];
        }>;
        matchFields?: Array<{
          key: string;
          operator: string;
          values?: string[];
        }>;
      }>;
    };
  };
  // Various volume source types omitted for brevity
}

export interface PersistentVolumeStatus {
  phase: string; // "Available", "Bound", "Released", "Failed"
  message?: string;
  reason?: string;
}

export interface PersistentVolume {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: PersistentVolumeSpec;
  status?: PersistentVolumeStatus;
}

export interface PersistentVolumeList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: PersistentVolume[];
}

// Role
export interface PolicyRule {
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  verbs: string[];
  nonResourceURLs?: string[];
}

export interface Role {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  rules: PolicyRule[];
}

export interface RoleList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: Role[];
}

// RoleBinding
export interface Subject {
  kind: string;
  name: string;
  namespace?: string;
  apiGroup?: string;
}

export interface RoleRef {
  apiGroup: string;
  kind: string;
  name: string;
}

export interface RoleBinding {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  subjects: Subject[];
  roleRef: RoleRef;
}

export interface RoleBindingList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: RoleBinding[];
}

// ServiceAccount
export interface ServiceAccount {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  secrets?: Array<{
    name?: string;
  }>;
  imagePullSecrets?: Array<{
    name?: string;
  }>;
  automountServiceAccountToken?: boolean;
}

export interface ServiceAccountList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: ServiceAccount[];
}

// NetworkPolicy
export interface NetworkPolicySpec {
  podSelector: {
    matchLabels?: { [key: string]: string };
    matchExpressions?: Array<{
      key: string;
      operator: string;
      values?: string[];
    }>;
  };
  ingress?: Array<{
    from?: Array<{
      ipBlock?: {
        cidr: string;
        except?: string[];
      };
      namespaceSelector?: {
        matchLabels?: { [key: string]: string };
        matchExpressions?: Array<{
          key: string;
          operator: string;
          values?: string[];
        }>;
      };
      podSelector?: {
        matchLabels?: { [key: string]: string };
        matchExpressions?: Array<{
          key: string;
          operator: string;
          values?: string[];
        }>;
      };
    }>;
    ports?: Array<{
      protocol?: string;
      port?: number | string;
      endPort?: number;
    }>;
  }>;
  egress?: Array<{
    to?: Array<{
      ipBlock?: {
        cidr: string;
        except?: string[];
      };
      namespaceSelector?: {
        matchLabels?: { [key: string]: string };
        matchExpressions?: Array<{
          key: string;
          operator: string;
          values?: string[];
        }>;
      };
      podSelector?: {
        matchLabels?: { [key: string]: string };
        matchExpressions?: Array<{
          key: string;
          operator: string;
          values?: string[];
        }>;
      };
    }>;
    ports?: Array<{
      protocol?: string;
      port?: number | string;
      endPort?: number;
    }>;
  }>;
  policyTypes?: string[]; // "Ingress", "Egress"
}

export interface NetworkPolicy {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec: NetworkPolicySpec;
}

export interface NetworkPolicyList {
  apiVersion: string;
  kind: string;
  metadata: ListMeta;
  items: NetworkPolicy[];
} 