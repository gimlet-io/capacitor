import type { Pod, Deployment, Service, ServiceWithResources, DeploymentWithResources, ReplicaSet, ReplicaSetWithResources, Kustomization, KustomizationWithEvents, Event } from '../types/k8s.ts';

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

export const updateKustomizationMatchingEvents = (kustomization: Kustomization, allEvents: Event[]): KustomizationWithEvents => {
  return {
    ...kustomization,
    events: allEvents.filter(event => event.metadata.namespace === kustomization.metadata.namespace && event.involvedObject.kind === "Kustomization" && event.involvedObject.name === kustomization.metadata.name)
  };
};
