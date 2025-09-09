import type { Pod, 
  Deployment,
  Service,
  ServiceWithResources, 
  DeploymentWithResources, 
  ReplicaSet, 
  ReplicaSetWithResources, 
  ExtendedKustomization, 
  Event, 
  GitRepository, 
  OCIRepository, 
  Bucket,
  Job,
  JobWithResources,
  StatefulSet,
  StatefulSetWithResources,
  DaemonSet,
} from '../types/k8s.ts';

export const matchesServiceSelector = (labels: Record<string, string> | undefined, selector: Record<string, string> | undefined) => {
  if (!selector || !labels) return false;
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
};

export const getMatchingPods = (service: Service, allPods: Pod[]) => {
  if (!service.spec.selector) return [];
  return allPods.filter(pod => matchesServiceSelector(pod.metadata.labels, service.spec.selector));
};

export const getMatchingDeployments = (service: Service, allDeployments: Deployment[]) => {
  if (!service.spec.selector) return [];
  return allDeployments.filter(deployment => 
    matchesServiceSelector(deployment.spec.template.metadata.labels, service.spec.selector)
  );
};

export const updateServiceMatchingResources = (service: Service, allPods: Pod[], allDeployments: Deployment[]): ServiceWithResources => {
  return {
    ...service,
    matchingPods: getMatchingPods(service, allPods),
    matchingDeployments: getMatchingDeployments(service, allDeployments)
  };
};

export const updateDeploymentMatchingResources = (deployment: Deployment, allPods: Pod[], replicaSets = []): DeploymentWithResources => {
  return {
    ...deployment,
    pods: getDeploymentMatchingPods(deployment, allPods),
    replicaSets
  };
};

export const updateReplicaSetMatchingResources = (replicaSet: ReplicaSet, allPods: Pod[]): ReplicaSetWithResources => {
  return {
    ...replicaSet,
    pods: getReplicaSetMatchingPods(replicaSet, allPods)
  };
};

export const getDeploymentMatchingPods = (deployment: Deployment, allPods: Pod[]) => {
  if (!deployment.spec.selector.matchLabels) return [];
  return allPods.filter(pod => 
    Object.entries(deployment.spec.selector.matchLabels).every(([key, value]) => 
      pod.metadata.labels?.[key] === value
    )
  );
}; 

export const getReplicaSetMatchingPods = (replicaSet: ReplicaSet, allPods: Pod[]) => {
  if (!replicaSet.spec.selector.matchLabels) return [];
  return allPods.filter(pod => 
    Object.entries(replicaSet.spec.selector.matchLabels).every(([key, value]) => 
      pod.metadata.labels?.[key] === value
    )
  );
};

export const getJobMatchingPods = (job: Job, allPods: Pod[]) => {
  const selectorLabels = job.spec?.selector?.matchLabels || job.spec?.template?.metadata?.labels;
  if (!selectorLabels) return [];
  return allPods.filter(pod => 
    Object.entries(selectorLabels).every(([key, value]) => pod.metadata.labels?.[key] === value)
  );
};

export const updateJobMatchingResources = (job: Job, allPods: Pod[]): JobWithResources => {
  return {
    ...job,
    pods: getJobMatchingPods(job, allPods)
  };
};

// StatefulSet -> Pods
export const getStatefulSetMatchingPods = (statefulSet: StatefulSet, allPods: Pod[]) => {
  const selectorLabels = statefulSet.spec?.selector?.matchLabels || statefulSet.spec?.template?.metadata?.labels;
  if (!selectorLabels) return [];
  return allPods.filter(pod => 
    Object.entries(selectorLabels).every(([key, value]) => pod.metadata.labels?.[key] === value)
  );
};

export const updateStatefulSetMatchingResources = (statefulSet: StatefulSet, allPods: Pod[]): StatefulSetWithResources => {
  return {
    ...statefulSet,
    pods: getStatefulSetMatchingPods(statefulSet, allPods)
  };
};

// DaemonSet -> Pods
export const getDaemonSetMatchingPods = (daemonSet: DaemonSet, allPods: Pod[]) => {
  const selectorLabels = daemonSet.spec?.selector?.matchLabels || daemonSet.spec?.template?.metadata?.labels;
  if (!selectorLabels) return [];
  return allPods.filter(pod => 
    Object.entries(selectorLabels).every(([key, value]) => pod.metadata.labels?.[key] === value)
  );
};

export const updateDaemonSetMatchingResources = (daemonSet: DaemonSet, allPods: Pod[]) => {
  return {
    ...daemonSet,
    pods: getDaemonSetMatchingPods(daemonSet, allPods)
  } as DaemonSet & { pods: Pod[] };
};

export const updateKustomizationMatchingEvents = (kustomization: ExtendedKustomization, allEvents: Event[]): ExtendedKustomization => {
  return {
    ...kustomization,
    events: allEvents.filter(event => 
      (event.metadata.namespace === kustomization.metadata.namespace && 
      event.involvedObject.kind === "Kustomization" && 
      event.involvedObject.name === kustomization.metadata.name) ||
      ((event.metadata.namespace === kustomization.spec.sourceRef.namespace || event.metadata.namespace === kustomization.metadata.namespace) && 
      event.involvedObject.kind === kustomization.spec.sourceRef.kind && 
      event.involvedObject.name === kustomization.spec.sourceRef.name)
    )
  };
};

export const updateKustomizationMatchingGitRepositories = (kustomization: ExtendedKustomization, allGitRepositories: GitRepository[]): ExtendedKustomization => {
  let namespace = kustomization.spec.sourceRef.namespace;
  if (namespace === undefined) {
    namespace = kustomization.metadata.namespace;
  }
  const source = allGitRepositories.find(gitRepository => gitRepository.metadata.namespace === namespace && gitRepository.metadata.name === kustomization.spec.sourceRef.name);
  if (source === undefined) {
    return kustomization;
  } else return {
    ...kustomization,
    source: source
  };
};

export const updateKustomizationMatchingOCIRepositories = (kustomization: ExtendedKustomization, allOCIRepositories: OCIRepository[]): ExtendedKustomization => {
  let namespace = kustomization.spec.sourceRef.namespace;
  if (namespace === undefined) {
    namespace = kustomization.metadata.namespace;
  }
  const source = allOCIRepositories.find(ocirepository => ocirepository.metadata.namespace === namespace && ocirepository.metadata.name === kustomization.spec.sourceRef.name);
  if (source === undefined) {
    return kustomization;
  } else return {
    ...kustomization,
    source: source
  };
};

export const updateKustomizationMatchingBuckets = (kustomization: ExtendedKustomization, allBuckets: Bucket[]): ExtendedKustomization => {
  let namespace = kustomization.spec.sourceRef.namespace;
  if (namespace === undefined) {
    namespace = kustomization.metadata.namespace;
  }
  const source = allBuckets.find(bucket => bucket.metadata.namespace === namespace && bucket.metadata.name === kustomization.spec.sourceRef.name);
  if (source === undefined) {
    return kustomization;
  } else return {
    ...kustomization,
    source: source
  };
};
