// Basic metadata interfaces
export interface ObjectMeta {
    name: string;
    namespace?: string;
    labels?: { [key: string]: string };
    annotations?: { [key: string]: string };
    creationTimestamp?: string;
    uid?: string;
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