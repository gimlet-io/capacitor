// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

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
  Ingress,
  Kustomization,
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

// Service -> Pods (separate updater for extra watches pipeline)
export const updateServiceMatchingPods = (service: Service | ServiceWithResources, allPods: Pod[]): ServiceWithResources => {
  const current = service as ServiceWithResources;
  return {
    ...(service as Service),
    matchingPods: getMatchingPods(service as Service, allPods),
    matchingDeployments: current.matchingDeployments || [],
    ingresses: current.ingresses,
    kustomizations: current.kustomizations,
  };
};

// Service -> Deployments (separate updater)
export const updateServiceMatchingDeployments = (service: Service | ServiceWithResources, allDeployments: Deployment[]): ServiceWithResources => {
  const current = service as ServiceWithResources;
  return {
    ...(service as Service),
    matchingPods: current.matchingPods || [],
    matchingDeployments: getMatchingDeployments(service as Service, allDeployments),
    ingresses: current.ingresses,
    kustomizations: current.kustomizations,
  };
};

// Service -> Ingresses that route to the service
export const getServiceMatchingIngresses = (service: Service, allIngresses: Ingress[]): Ingress[] => {
  const ns = service.metadata.namespace;
  const name = service.metadata.name;
  return (allIngresses || []).filter((ing) => {
    if (ing.metadata.namespace !== ns) return false;
    const rules = ing.spec?.rules || [];
    for (const rule of rules) {
      for (const p of (rule.http?.paths ?? [])) {
        const svc = p.backend?.service;
        if (svc?.name === name) return true;
      }
    }
    // Also check default backend
    const defSvc = ing.spec?.defaultBackend?.service;
    return defSvc?.name === name;
  });
};

export const updateServiceMatchingIngresses = (service: Service | ServiceWithResources, allIngresses: Ingress[]): ServiceWithResources => {
  const current = service as ServiceWithResources;
  return {
    ...(service as Service),
    matchingPods: current.matchingPods || [],
    matchingDeployments: current.matchingDeployments || [],
    ingresses: getServiceMatchingIngresses(service as Service, allIngresses),
    kustomizations: current.kustomizations,
  };
};

// Service -> Kustomizations containing it in inventory
const serviceInventoryId = (service: Service): string => {
  // Core group uses double underscore between name and kind
  return `${service.metadata.namespace}_${service.metadata.name}__Service`;
};

export const getServiceKustomizations = (service: Service, allKustomizations: Kustomization[]): Kustomization[] => {
  const id = serviceInventoryId(service);
  return (allKustomizations || []).filter(k => (k.status?.inventory?.entries || []).some(e => e.id === id));
};

export const updateServiceMatchingKustomizations = (service: Service | ServiceWithResources, allKustomizations: Kustomization[]): ServiceWithResources => {
  const current = service as ServiceWithResources;
  return {
    ...(service as Service),
    matchingPods: current.matchingPods || [],
    matchingDeployments: current.matchingDeployments || [],
    ingresses: current.ingresses,
    kustomizations: getServiceKustomizations(service as Service, allKustomizations),
  };
};

export const updateDeploymentMatchingResources = (deployment: Deployment, allPods: Pod[], replicaSets = []): DeploymentWithResources => {
  console.log('[updateDeploymentMatchingResources] called for:', deployment.metadata?.name, 'hasSpec:', !!deployment.spec, 'hasSelector:', !!deployment.spec?.selector, 'hasMatchLabels:', !!deployment.spec?.selector?.matchLabels);
  const matchingPods = getDeploymentMatchingPods(deployment, allPods);
  console.log('[updateDeploymentMatchingResources] matched pods:', matchingPods.length, 'out of', allPods.length);
  return {
    ...deployment,
    pods: matchingPods,
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
