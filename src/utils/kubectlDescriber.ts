/**
 * Kubernetes Resource Describe Formatter
 * 
 * This module provides utilities to format Kubernetes resources in a style similar
 * to kubectl describe command output. Implementation based on:
 * https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/kubectl/pkg/describe/describe.go
 */

type PrefixWriter = {
  lines: string[];
  write: (level: number, format: string, ...args: any[]) => void;
};

// Level constants for indentation
const LEVEL_0 = 0;
const LEVEL_1 = 1;
const LEVEL_2 = 2;
const LEVEL_3 = 3;

/**
 * Creates a new prefix writer for building the describe output
 */
function createPrefixWriter(): PrefixWriter {
  const lines: string[] = [];
  
  return {
    lines,
    write: (level: number, format: string, ...args: any[]) => {
      // Format the string with the given arguments
      let line = format;
      if (args.length > 0) {
        args.forEach((arg, index) => {
          line = line.replace(`%s`, String(arg));
        });
      }

      // Add the proper indentation
      const prefix = '  '.repeat(level);
      lines.push(`${prefix}${line}`);
    },
  };
}

/**
 * Formats a Pod resource in kubectl describe style
 */
export function describePod(pod: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", pod.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", pod.metadata?.namespace || "default");
  w.write(LEVEL_0, "Priority:\t%s", pod.spec?.priority || "0");
  w.write(LEVEL_0, "Node:\t%s", pod.spec?.nodeName || "<none>");
  w.write(LEVEL_0, "Start Time:\t%s", pod.status?.startTime || "<unknown>");
  
  // Labels and annotations
  printLabelsMultiline(w, "Labels", pod.metadata?.labels);
  printLabelsMultiline(w, "Annotations", pod.metadata?.annotations);
  
  // Status
  w.write(LEVEL_0, "Status:\t%s", pod.status?.phase || "Unknown");
  
  // IP addresses
  if (pod.status?.podIP) {
    w.write(LEVEL_0, "IP:\t%s", pod.status.podIP);
  }
  
  // Controller info
  if (pod.metadata?.ownerReferences && pod.metadata.ownerReferences.length > 0) {
    const owner = pod.metadata.ownerReferences[0];
    w.write(LEVEL_0, "Controlled By:\t%s/%s", owner.kind, owner.name);
  }
  
  // Containers
  w.write(LEVEL_0, "Containers:");
  if (pod.spec?.containers && pod.spec.containers.length > 0) {
    pod.spec.containers.forEach((container: any, i: number) => {
      w.write(LEVEL_1, "%s:", container.name);
      w.write(LEVEL_2, "Container ID:\t%s", findContainerStatus(pod, container.name)?.containerID || "<none>");
      w.write(LEVEL_2, "Image:\t%s", container.image || "<none>");
      w.write(LEVEL_2, "Image ID:\t%s", findContainerStatus(pod, container.name)?.imageID || "<none>");
      w.write(LEVEL_2, "Port:\t%s", formatPorts(container.ports) || "<none>");
      w.write(LEVEL_2, "Host Port:\t%s", formatHostPorts(container.ports) || "<none>");
      
      // Command
      if (container.command && container.command.length > 0) {
        w.write(LEVEL_2, "Command:");
        container.command.forEach((cmd: string) => {
          w.write(LEVEL_3, "%s", cmd);
        });
      }
      
      // Args
      if (container.args && container.args.length > 0) {
        w.write(LEVEL_2, "Args:");
        container.args.forEach((arg: string) => {
          w.write(LEVEL_3, "%s", arg);
        });
      }
      
      // Environment variables
      if (container.env && container.env.length > 0) {
        w.write(LEVEL_2, "Environment:");
        container.env.forEach((env: any) => {
          if (env.value) {
            w.write(LEVEL_3, "%s:\t%s", env.name, env.value);
          } else if (env.valueFrom) {
            w.write(LEVEL_3, "%s:\t<source>", env.name);
          }
        });
      }
      
      // Resources
      w.write(LEVEL_2, "Limits:");
      const limits = container.resources?.limits || {};
      w.write(LEVEL_3, "cpu:\t%s", limits.cpu || "<none>");
      w.write(LEVEL_3, "memory:\t%s", limits.memory || "<none>");
      
      w.write(LEVEL_2, "Requests:");
      const requests = container.resources?.requests || {};
      w.write(LEVEL_3, "cpu:\t%s", requests.cpu || "<none>");
      w.write(LEVEL_3, "memory:\t%s", requests.memory || "<none>");
      
      // Volume mounts
      if (container.volumeMounts && container.volumeMounts.length > 0) {
        w.write(LEVEL_2, "Mounts:");
        container.volumeMounts.forEach((mount: any) => {
          const readOnly = mount.readOnly ? " (ro)" : " (rw)";
          w.write(LEVEL_3, "%s -> %s%s", mount.name, mount.mountPath, readOnly);
          // Add subPath if present
          if (mount.subPath) {
            w.write(LEVEL_4, "SubPath: %s", mount.subPath);
          }
        });
      }
      
      // State
      const status = findContainerStatus(pod, container.name);
      if (status) {
        w.write(LEVEL_2, "State:\t%s", formatContainerState(status.state));
        w.write(LEVEL_2, "Ready:\t%s", status.ready ? "True" : "False");
        w.write(LEVEL_2, "Restart Count:\t%s", status.restartCount || 0);
      }
    });
  }
  
  // Init Containers if present
  if (pod.spec?.initContainers && pod.spec.initContainers.length > 0) {
    w.write(LEVEL_0, "Init Containers:");
    pod.spec.initContainers.forEach((container: any) => {
      w.write(LEVEL_1, "%s:", container.name);
      w.write(LEVEL_2, "Image:\t%s", container.image || "<none>");
      // You could add more init container details here similar to regular containers
    });
  }
  
  // Conditions
  if (pod.status?.conditions && pod.status.conditions.length > 0) {
    w.write(LEVEL_0, "Conditions:");
    w.write(LEVEL_1, "Type\tStatus\tLastProbeTime\tLastTransitionTime\tReason\tMessage");
    pod.status.conditions.forEach((condition: any) => {
      w.write(LEVEL_1, "%s\t%s\t%s\t%s\t%s\t%s",
        condition.type || "<none>",
        condition.status || "<none>",
        condition.lastProbeTime || "<none>",
        condition.lastTransitionTime || "<none>",
        condition.reason || "<none>",
        condition.message || "<none>"
      );
    });
  }
  
  // Volumes
  if (pod.spec?.volumes && pod.spec.volumes.length > 0) {
    w.write(LEVEL_0, "Volumes:");
    pod.spec.volumes.forEach((volume: any) => {
      w.write(LEVEL_1, "%s:", volume.name);
      describeVolume(w, volume);
    });
  }
  
  // Quality of Service
  w.write(LEVEL_0, "QoS Class:\t%s", pod.status?.qosClass || "BestEffort");
  
  // Node selector
  printLabelsMultiline(w, "Node-Selectors", pod.spec?.nodeSelector);
  
  // Tolerations
  if (pod.spec?.tolerations && pod.spec.tolerations.length > 0) {
    w.write(LEVEL_0, "Tolerations:");
    pod.spec.tolerations.forEach((toleration: any) => {
      let tolerationStr = "";
      if (toleration.key) {
        tolerationStr += toleration.key;
      }
      if (toleration.operator) {
        tolerationStr += " " + toleration.operator;
      }
      if (toleration.value) {
        tolerationStr += " " + toleration.value;
      }
      if (toleration.effect) {
        tolerationStr += " " + toleration.effect;
      }
      w.write(LEVEL_1, "%s", tolerationStr);
    });
  }
  
  return w.lines.join("\n");
}

/**
 * Formats a Deployment resource in kubectl describe style
 */
export function describeDeployment(deployment: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", deployment.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", deployment.metadata?.namespace || "default");
  w.write(LEVEL_0, "CreationTimestamp:\t%s", deployment.metadata?.creationTimestamp || "<unknown>");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(deployment.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(deployment.metadata?.annotations));
  w.write(LEVEL_0, "Selector:\t%s", formatLabelSelector(deployment.spec?.selector));
  
  // Replicas
  const replicas = deployment.spec?.replicas || 0;
  w.write(LEVEL_0, "Replicas:\t%s desired | %s updated | %s total | %s available | %s unavailable",
    replicas,
    deployment.status?.updatedReplicas || 0,
    deployment.status?.replicas || 0,
    deployment.status?.availableReplicas || 0,
    (replicas - (deployment.status?.availableReplicas || 0))
  );
  
  // Strategy
  w.write(LEVEL_0, "StrategyType:\t%s", deployment.spec?.strategy?.type || "RollingUpdate");
  if (deployment.spec?.strategy?.type === "RollingUpdate") {
    const rollingUpdate = deployment.spec.strategy.rollingUpdate || {};
    w.write(LEVEL_0, "RollingUpdateStrategy:\t%s max unavailable, %s max surge",
      rollingUpdate.maxUnavailable || "25%",
      rollingUpdate.maxSurge || "25%"
    );
  }
  
  // MinReadySeconds
  w.write(LEVEL_0, "MinReadySeconds:\t%s", deployment.spec?.minReadySeconds || 0);
  
  // Pod template
  if (deployment.spec?.template) {
    const template = deployment.spec.template;
    w.write(LEVEL_0, "Pod Template:");
    
    // Template metadata
    printLabelsMultiline(w, "  Labels", template.metadata?.labels);
    printLabelsMultiline(w, "  Annotations", template.metadata?.annotations);
    
    // Containers
    if (template.spec?.containers && template.spec.containers.length > 0) {
      w.write(LEVEL_1, "Containers:");
      template.spec.containers.forEach((container: any) => {
        w.write(LEVEL_2, "%s:", container.name);
        w.write(LEVEL_3, "Image:\t%s", container.image);
        
        // Ports
        if (container.ports && container.ports.length > 0) {
          w.write(LEVEL_3, "Ports:");
          container.ports.forEach((port: any) => {
            w.write(LEVEL_4, "%s/%s", port.containerPort, port.protocol || "TCP");
          });
        }
        
        // Resources
        if (container.resources) {
          const limits = container.resources.limits || {};
          const requests = container.resources.requests || {};
          
          w.write(LEVEL_3, "Limits:");
          Object.entries(limits).forEach(([key, value]) => {
            w.write(LEVEL_4, "%s:\t%s", key, value);
          });
          
          w.write(LEVEL_3, "Requests:");
          Object.entries(requests).forEach(([key, value]) => {
            w.write(LEVEL_4, "%s:\t%s", key, value);
          });
        }
        
        // Liveness/Readiness probes
        if (container.livenessProbe) {
          w.write(LEVEL_3, "Liveness:\t%s", formatProbe(container.livenessProbe));
        }
        
        if (container.readinessProbe) {
          w.write(LEVEL_3, "Readiness:\t%s", formatProbe(container.readinessProbe));
        }
        
        // Environment
        if (container.env && container.env.length > 0) {
          w.write(LEVEL_3, "Environment:");
          container.env.forEach((env: any) => {
            w.write(LEVEL_4, "%s:\t%s", env.name, env.value || "<set to the key in a configmap/secret>");
          });
        }
        
        // Mounts
        if (container.volumeMounts && container.volumeMounts.length > 0) {
          w.write(LEVEL_3, "Mounts:");
          container.volumeMounts.forEach((mount: any) => {
            w.write(LEVEL_4, "%s from %s (%s)", mount.mountPath, mount.name, mount.readOnly ? "ro" : "rw");
          });
        }
      });
    }
    
    // Volumes
    if (template.spec?.volumes && template.spec.volumes.length > 0) {
      w.write(LEVEL_1, "Volumes:");
      template.spec.volumes.forEach((volume: any) => {
        w.write(LEVEL_2, "%s:", volume.name);
        
        if (volume.persistentVolumeClaim) {
          w.write(LEVEL_3, "Type:\tPersistentVolumeClaim");
          w.write(LEVEL_3, "ClaimName:\t%s", volume.persistentVolumeClaim.claimName);
        } else if (volume.configMap) {
          w.write(LEVEL_3, "Type:\tConfigMap");
          w.write(LEVEL_3, "Name:\t%s", volume.configMap.name);
        } else if (volume.secret) {
          w.write(LEVEL_3, "Type:\tSecret");
          w.write(LEVEL_3, "SecretName:\t%s", volume.secret.secretName);
        } else if (volume.emptyDir) {
          w.write(LEVEL_3, "Type:\tEmptyDir");
        } else {
          w.write(LEVEL_3, "Type:\tOther");
        }
      });
    }
  }
  
  // Conditions
  if (deployment.status?.conditions && deployment.status.conditions.length > 0) {
    w.write(LEVEL_0, "Conditions:");
    w.write(LEVEL_1, "Type\tStatus\tReason\tMessage\tLastUpdateTime\tLastTransitionTime");
    
    deployment.status.conditions.forEach((condition: any) => {
      w.write(LEVEL_1, "%s\t%s\t%s\t%s\t%s\t%s",
        condition.type || "",
        condition.status || "",
        condition.reason || "",
        condition.message || "",
        condition.lastUpdateTime || "",
        condition.lastTransitionTime || ""
      );
    });
  }
  
  // OldReplicaSets
  if (deployment.status?.oldReplicaSets) {
    w.write(LEVEL_0, "OldReplicaSets:\t%s", deployment.status.oldReplicaSets);
  }
  
  // NewReplicaSet
  if (deployment.status?.newReplicaSet) {
    w.write(LEVEL_0, "NewReplicaSet:\t%s", deployment.status.newReplicaSet);
  }
  
  return w.lines.join("\n");
}

/**
 * Formats a Service resource in kubectl describe style
 */
export function describeService(service: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", service.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", service.metadata?.namespace || "default");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(service.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(service.metadata?.annotations));
  w.write(LEVEL_0, "Selector:\t%s", formatLabels(service.spec?.selector));
  w.write(LEVEL_0, "Type:\t%s", service.spec?.type || "ClusterIP");
  w.write(LEVEL_0, "IP Family Policy:\t%s", service.spec?.ipFamilyPolicy || "SingleStack");
  w.write(LEVEL_0, "IP Families:\t%s", (service.spec?.ipFamilies || []).join(",") || "IPv4");
  
  if (service.spec?.externalTrafficPolicy) {
    w.write(LEVEL_0, "External Traffic Policy:\t%s", service.spec.externalTrafficPolicy);
  }
  
  if (service.spec?.healthCheckNodePort) {
    w.write(LEVEL_0, "HealthCheck NodePort:\t%s", service.spec.healthCheckNodePort);
  }
  
  // IPs and ports
  w.write(LEVEL_0, "IP:\t%s", service.spec?.clusterIP || "None");
  
  if (service.spec?.type === "LoadBalancer") {
    w.write(LEVEL_0, "LoadBalancer Ingress:\t%s", 
      service.status?.loadBalancer?.ingress?.map((ing: any) => ing.ip || ing.hostname).join(", ") || "<pending>");
  }
  
  if (service.spec?.externalIPs && service.spec.externalIPs.length > 0) {
    w.write(LEVEL_0, "External IPs:\t%s", service.spec.externalIPs.join(", "));
  }
  
  // Ports
  if (service.spec?.ports && service.spec.ports.length > 0) {
    w.write(LEVEL_0, "Port(s):");
    service.spec.ports.forEach((port: any) => {
      let portInfo = `${port.port}/${port.protocol || "TCP"}`;
      
      if (port.name) {
        portInfo = `${port.name} ${portInfo}`;
      }
      
      if (port.nodePort) {
        portInfo += ` ${port.nodePort}/${port.protocol || "TCP"}`;
      }
      
      if (port.targetPort) {
        portInfo += ` -> ${port.targetPort}`;
      }
      
      w.write(LEVEL_1, "%s", portInfo);
    });
  } else {
    w.write(LEVEL_0, "Port(s):\t<none>");
  }
  
  if (service.spec?.sessionAffinity) {
    w.write(LEVEL_0, "Session Affinity:\t%s", service.spec.sessionAffinity);
  }
  
  // Endpoints
  w.write(LEVEL_0, "Endpoints:\t%s", "<none>");  // In a real implementation, you would fetch and display endpoints
  
  return w.lines.join("\n");
}

/**
 * Main entry point for describing a kubernetes resource
 */
export function describeResource(resource: any): string {
  if (!resource) return "No resource data available";
  
  if (!resource.kind) {
    return "Unknown resource kind";
  }
  
  // Choose the appropriate describer function based on the resource kind
  switch (resource.kind) {
    case "Pod":
      return describePod(resource);
    case "Deployment":
      return describeDeployment(resource);
    case "Service":
      return describeService(resource);
    case "ConfigMap":
      return describeConfigMap(resource);
    case "Secret":
      return describeSecret(resource);
    case "PersistentVolumeClaim":
      return describePVC(resource);
    case "PersistentVolume":
      return describePV(resource);
    case "ServiceAccount":
      return describeServiceAccount(resource);
    case "ReplicaSet":
      return describeReplicaSet(resource);
    case "Endpoints":
      return describeEndpoints(resource);
    case "Ingress":
      return describeIngress(resource);
    default:
      // For other resource types, provide a generic formatter
      return formatGenericResource(resource);
  }
}

/**
 * Formats a ConfigMap resource in kubectl describe style
 */
export function describeConfigMap(configMap: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", configMap.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", configMap.metadata?.namespace || "default");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(configMap.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(configMap.metadata?.annotations));
  
  // Data
  if (configMap.data && Object.keys(configMap.data).length > 0) {
    w.write(LEVEL_0, "Data");
    Object.entries(configMap.data).forEach(([key, value]) => {
      const displayValue = typeof value === 'string' && value.length > 50 
        ? value.substring(0, 47) + '...' 
        : value;
      w.write(LEVEL_1, "%s:\t%s", key, displayValue);
    });
  } else {
    w.write(LEVEL_0, "Data:\t<none>");
  }
  
  // Binary data
  if (configMap.binaryData && Object.keys(configMap.binaryData).length > 0) {
    w.write(LEVEL_0, "Binary Data");
    Object.keys(configMap.binaryData).forEach(key => {
      w.write(LEVEL_1, "%s:\t%d bytes", key, configMap.binaryData[key].length);
    });
  }
  
  return w.lines.join("\n");
}

/**
 * Formats a Secret resource in kubectl describe style
 */
export function describeSecret(secret: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", secret.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", secret.metadata?.namespace || "default");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(secret.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(secret.metadata?.annotations));
  w.write(LEVEL_0, "Type:\t%s", secret.type || "Opaque");
  
  // Data (just show keys, not the actual values for security)
  if (secret.data && Object.keys(secret.data).length > 0) {
    w.write(LEVEL_0, "Data");
    Object.keys(secret.data).forEach(key => {
      w.write(LEVEL_1, "%s:\t%d bytes", key, 
        // Use length of base64-decoded data if possible
        typeof secret.data[key] === 'string' 
          ? secret.data[key].length 
          : '<unknown size>');
    });
  } else {
    w.write(LEVEL_0, "Data:\t<none>");
  }
  
  return w.lines.join("\n");
}

/**
 * Formats a PersistentVolumeClaim resource in kubectl describe style
 */
export function describePVC(pvc: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", pvc.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", pvc.metadata?.namespace || "default");
  w.write(LEVEL_0, "StorageClass:\t%s", pvc.spec?.storageClassName || "<none>");
  w.write(LEVEL_0, "Status:\t%s", pvc.status?.phase || "Unknown");
  w.write(LEVEL_0, "Volume:\t%s", pvc.spec?.volumeName || "<none>");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(pvc.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(pvc.metadata?.annotations));
  w.write(LEVEL_0, "Finalizers:\t%s", (pvc.metadata?.finalizers || []).join(", ") || "<none>");
  
  // Capacity
  w.write(LEVEL_0, "Capacity:\t%s", pvc.status?.capacity?.storage || "<none>");
  
  // Access Modes
  w.write(LEVEL_0, "Access Modes:\t%s", (pvc.status?.accessModes || pvc.spec?.accessModes || []).join(", ") || "<none>");
  
  // Volume Mode
  w.write(LEVEL_0, "VolumeMode:\t%s", pvc.spec?.volumeMode || "Filesystem");
  
  // Events (normally would fetch these separately, but not applicable here)
  
  return w.lines.join("\n");
}

/**
 * Formats a PersistentVolume resource in kubectl describe style
 */
export function describePV(pv: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", pv.metadata?.name || "unknown");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(pv.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(pv.metadata?.annotations));
  w.write(LEVEL_0, "Finalizers:\t%s", (pv.metadata?.finalizers || []).join(", ") || "<none>");
  
  // Status
  w.write(LEVEL_0, "Status:\t%s", pv.status?.phase || "Unknown");
  w.write(LEVEL_0, "Claim:\t%s/%s", pv.spec?.claimRef?.namespace || "<none>", pv.spec?.claimRef?.name || "<none>");
  w.write(LEVEL_0, "Reclaim Policy:\t%s", pv.spec?.persistentVolumeReclaimPolicy || "Retain");
  w.write(LEVEL_0, "Access Modes:\t%s", (pv.spec?.accessModes || []).join(", ") || "<none>");
  w.write(LEVEL_0, "VolumeMode:\t%s", pv.spec?.volumeMode || "Filesystem");
  w.write(LEVEL_0, "Capacity:\t%s", pv.spec?.capacity?.storage || "<none>");
  w.write(LEVEL_0, "Node Affinity:\t%s", formatNodeAffinity(pv.spec?.nodeAffinity));
  
  // Volume source - different types like hostPath, nfs, etc.
  w.write(LEVEL_0, "Source:");
  describePVSource(w, pv.spec);
  
  return w.lines.join("\n");
}

/**
 * Formats a ServiceAccount resource in kubectl describe style
 */
export function describeServiceAccount(sa: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", sa.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", sa.metadata?.namespace || "default");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(sa.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(sa.metadata?.annotations));
  
  // Image pull secrets
  if (sa.imagePullSecrets && sa.imagePullSecrets.length > 0) {
    w.write(LEVEL_0, "Image pull secrets:\t%s", sa.imagePullSecrets.map((s: any) => s.name).join(", "));
  } else {
    w.write(LEVEL_0, "Image pull secrets:\t<none>");
  }
  
  // Mountable secrets
  if (sa.secrets && sa.secrets.length > 0) {
    w.write(LEVEL_0, "Mountable secrets:\t%s", sa.secrets.map((s: any) => s.name).join(", "));
  } else {
    w.write(LEVEL_0, "Mountable secrets:\t<none>");
  }
  
  // Token information
  if (sa.tokens && sa.tokens.length > 0) {
    w.write(LEVEL_0, "Tokens:\t%s", sa.tokens.map((t: any) => t.metadata.name).join(", "));
  } else {
    w.write(LEVEL_0, "Tokens:\t<none>");
  }
  
  return w.lines.join("\n");
}

/**
 * Formats a ReplicaSet resource in kubectl describe style
 */
export function describeReplicaSet(rs: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", rs.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", rs.metadata?.namespace || "default");
  w.write(LEVEL_0, "Selector:\t%s", formatLabelSelector(rs.spec?.selector));
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(rs.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(rs.metadata?.annotations));
  w.write(LEVEL_0, "Replicas:\t%s current / %s desired", rs.status?.replicas || 0, rs.spec?.replicas || 0);
  w.write(LEVEL_0, "Pods Status:\t%s Running / %s Waiting / %s Succeeded / %s Failed", 
    rs.status?.readyReplicas || 0, 
    (rs.status?.replicas || 0) - (rs.status?.readyReplicas || 0), 
    rs.status?.succeededReplicas || 0, 
    rs.status?.failedReplicas || 0);
  
  // Pod template
  w.write(LEVEL_0, "Pod Template:");
  if (rs.spec?.template) {
    const template = rs.spec.template;
    printLabelsMultiline(w, "  Labels", template.metadata?.labels);
    
    // Containers
    if (template.spec?.containers && template.spec.containers.length > 0) {
      w.write(LEVEL_1, "Containers:");
      template.spec.containers.forEach((container: any) => {
        w.write(LEVEL_2, "%s:", container.name);
        w.write(LEVEL_3, "Image:\t%s", container.image);
        
        // Add more container details as needed
      });
    }
  }
  
  return w.lines.join("\n");
}

/**
 * Formats an Endpoints resource in kubectl describe style
 */
export function describeEndpoints(endpoints: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", endpoints.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", endpoints.metadata?.namespace || "default");
  w.write(LEVEL_0, "Labels:\t%s", formatLabels(endpoints.metadata?.labels));
  w.write(LEVEL_0, "Annotations:\t%s", formatLabels(endpoints.metadata?.annotations));
  
  // Subsets
  if (endpoints.subsets && endpoints.subsets.length > 0) {
    endpoints.subsets.forEach((subset: any, i: number) => {
      w.write(LEVEL_0, "Subset %d:", i + 1);
      
      // Addresses
      if (subset.addresses && subset.addresses.length > 0) {
        w.write(LEVEL_1, "Addresses:");
        subset.addresses.forEach((addr: any) => {
          let addrStr = addr.ip;
          if (addr.hostname) {
            addrStr += ` (${addr.hostname})`;
          }
          if (addr.nodeName) {
            addrStr += ` on node ${addr.nodeName}`;
          }
          if (addr.targetRef) {
            addrStr += ` targeting ${addr.targetRef.kind}/${addr.targetRef.name}`;
          }
          w.write(LEVEL_2, "%s", addrStr);
        });
      }
      
      // NotReadyAddresses
      if (subset.notReadyAddresses && subset.notReadyAddresses.length > 0) {
        w.write(LEVEL_1, "NotReadyAddresses:");
        subset.notReadyAddresses.forEach((addr: any) => {
          let addrStr = addr.ip;
          if (addr.hostname) {
            addrStr += ` (${addr.hostname})`;
          }
          w.write(LEVEL_2, "%s", addrStr);
        });
      }
      
      // Ports
      if (subset.ports && subset.ports.length > 0) {
        w.write(LEVEL_1, "Ports:");
        subset.ports.forEach((port: any) => {
          w.write(LEVEL_2, "%s\t%s/%s", port.name || "<unnamed>", port.port, port.protocol || "TCP");
        });
      }
    });
  } else {
    w.write(LEVEL_0, "Subsets:\t<none>");
  }
  
  return w.lines.join("\n");
}

/**
 * Formats an Ingress resource in kubectl describe style
 */
export function describeIngress(ingress: any): string {
  const w = createPrefixWriter();
  
  // Basic info
  w.write(LEVEL_0, "Name:\t%s", ingress.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", ingress.metadata?.namespace || "default");
  w.write(LEVEL_0, "Address:\t%s", 
    ingress.status?.loadBalancer?.ingress?.map((i: any) => i.ip || i.hostname).join(", ") || "<none>");
  w.write(LEVEL_0, "Default backend:\t%s", formatIngressBackend(ingress.spec?.defaultBackend) || "<default>");
  w.write(LEVEL_0, "TLS:");
  if (ingress.spec?.tls && ingress.spec.tls.length > 0) {
    ingress.spec.tls.forEach((tls: any) => {
      w.write(LEVEL_1, "%s termination", tls.hosts?.join(", ") || "<none>");
    });
  } else {
    w.write(LEVEL_1, "<none>");
  }
  
  // Rules
  w.write(LEVEL_0, "Rules:");
  if (ingress.spec?.rules && ingress.spec.rules.length > 0) {
    ingress.spec.rules.forEach((rule: any) => {
      const host = rule.host || "*";
      w.write(LEVEL_1, "Host\tPath\tBackends");
      
      if (rule.http?.paths && rule.http.paths.length > 0) {
        rule.http.paths.forEach((path: any) => {
          w.write(LEVEL_1, "%s\t%s\t%s", 
            host, 
            path.path || "/", 
            formatIngressBackend(path.backend));
        });
      } else {
        w.write(LEVEL_1, "%s\t*\t<default>", host);
      }
    });
  } else {
    w.write(LEVEL_1, "<none>");
  }
  
  return w.lines.join("\n");
}

/**
 * Format a PersistentVolume source
 */
function describePVSource(w: PrefixWriter, spec: any): void {
  if (!spec) {
    w.write(LEVEL_1, "<none>");
    return;
  }
  
  if (spec.hostPath) {
    w.write(LEVEL_1, "Type:\tHostPath (bare host directory volume)");
    w.write(LEVEL_1, "Path:\t%s", spec.hostPath.path);
    w.write(LEVEL_1, "HostPathType:\t%s", spec.hostPath.type || "");
  } else if (spec.nfs) {
    w.write(LEVEL_1, "Type:\tNFS (an NFS mount that lasts the lifetime of a pod)");
    w.write(LEVEL_1, "Server:\t%s", spec.nfs.server);
    w.write(LEVEL_1, "Path:\t%s", spec.nfs.path);
    w.write(LEVEL_1, "ReadOnly:\t%s", spec.nfs.readOnly ? "true" : "false");
  } else if (spec.glusterfs) {
    w.write(LEVEL_1, "Type:\tGlusterfs (a Glusterfs mount on the host)");
    w.write(LEVEL_1, "EndpointsName:\t%s", spec.glusterfs.endpoints);
    w.write(LEVEL_1, "Path:\t%s", spec.glusterfs.path);
    w.write(LEVEL_1, "ReadOnly:\t%s", spec.glusterfs.readOnly ? "true" : "false");
  } else if (spec.csi) {
    w.write(LEVEL_1, "Type:\tCSI (a Container Storage Interface (CSI) volume source)");
    w.write(LEVEL_1, "Driver:\t%s", spec.csi.driver);
    w.write(LEVEL_1, "FSType:\t%s", spec.csi.fsType || "<none>");
    w.write(LEVEL_1, "VolumeHandle:\t%s", spec.csi.volumeHandle);
    w.write(LEVEL_1, "ReadOnly:\t%s", spec.csi.readOnly ? "true" : "false");
  } else if (spec.awsElasticBlockStore) {
    w.write(LEVEL_1, "Type:\tAWS EBS");
    w.write(LEVEL_1, "VolumeID:\t%s", spec.awsElasticBlockStore.volumeID);
    w.write(LEVEL_1, "FSType:\t%s", spec.awsElasticBlockStore.fsType || "<none>");
  } else if (spec.gcePersistentDisk) {
    w.write(LEVEL_1, "Type:\tGCE PD");
    w.write(LEVEL_1, "PDName:\t%s", spec.gcePersistentDisk.pdName);
    w.write(LEVEL_1, "FSType:\t%s", spec.gcePersistentDisk.fsType || "<none>");
  } else {
    w.write(LEVEL_1, "Type:\tOther/Unsupported");
  }
}

/**
 * Format node affinity for PV
 */
function formatNodeAffinity(nodeAffinity: any): string {
  if (!nodeAffinity) return "<none>";
  
  // This is a simplified version - real kubectl has more detailed formatting
  if (nodeAffinity.required && nodeAffinity.required.nodeSelectorTerms) {
    return `Required terms: ${nodeAffinity.required.nodeSelectorTerms.length}`;
  }
  
  return "<unknown format>";
}

/**
 * Format ingress backend
 */
function formatIngressBackend(backend: any): string {
  if (!backend) return "<none>";
  
  if (backend.service) {
    return `${backend.service.name}:${backend.service.port.number || backend.service.port.name || "<unknown>"}`;
  } else if (backend.resource) {
    return `${backend.resource.kind}/${backend.resource.name}`;
  }
  
  return backend.serviceName ? `${backend.serviceName}:${backend.servicePort}` : "<unknown>";
}

// Helper functions

const LEVEL_4 = 4;

/**
 * Format container ports for display
 */
function formatPorts(ports: any[] | undefined): string {
  if (!ports || ports.length === 0) return "<none>";
  
  return ports
    .map(port => `${port.containerPort}/${port.protocol || "TCP"}`)
    .join(", ");
}

/**
 * Format container host ports for display
 */
function formatHostPorts(ports: any[] | undefined): string {
  if (!ports || ports.length === 0) return "<none>";
  
  return ports
    .map(port => port.hostPort ? `${port.hostPort}/${port.protocol || "TCP"}` : "<none>")
    .join(", ");
}

/**
 * Find container status by name
 */
function findContainerStatus(pod: any, containerName: string): any {
  if (!pod.status?.containerStatuses) return null;
  
  return pod.status.containerStatuses.find((status: any) => 
    status.name === containerName
  );
}

/**
 * Format container state for display
 */
function formatContainerState(state: any): string {
  if (!state) return "Unknown";
  
  if (state.running) {
    return `Running (Started at: ${state.running.startedAt || "unknown"})`;
  }
  
  if (state.waiting) {
    return `Waiting (Reason: ${state.waiting.reason || "unknown"})`;
  }
  
  if (state.terminated) {
    return `Terminated (Reason: ${state.terminated.reason || "unknown"}, Exit code: ${state.terminated.exitCode})`;
  }
  
  return "Unknown";
}

/**
 * Print labels in a multiline format
 */
function printLabelsMultiline(w: PrefixWriter, title: string, labels: Record<string, string> | undefined): void {
  if (!labels || Object.keys(labels).length === 0) {
    w.write(LEVEL_0, "%s:\t<none>", title);
    return;
  }
  
  w.write(LEVEL_0, "%s:", title);
  
  Object.entries(labels).forEach(([key, value]) => {
    w.write(LEVEL_1, "%s: %s", key, value);
  });
}

/**
 * Format labels as a single-line string
 */
function formatLabels(labels: Record<string, string> | undefined): string {
  if (!labels || Object.keys(labels).length === 0) {
    return "<none>";
  }
  
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

/**
 * Format label selector as a string
 */
function formatLabelSelector(selector: any): string {
  if (!selector) return "<none>";
  
  if (selector.matchLabels) {
    return formatLabels(selector.matchLabels);
  }
  
  if (selector.matchExpressions && selector.matchExpressions.length > 0) {
    return selector.matchExpressions
      .map((expr: any) => {
        return `${expr.key} ${expr.operator} ${expr.values ? expr.values.join(",") : ""}`;
      })
      .join(", ");
  }
  
  return "<none>";
}

/**
 * Format a probe (liveness or readiness) as a string
 */
function formatProbe(probe: any): string {
  if (!probe) return "<none>";
  
  const parts = [];
  
  if (probe.httpGet) {
    parts.push(`http-get ${probe.httpGet.path}:${probe.httpGet.port}`);
  } else if (probe.tcpSocket) {
    parts.push(`tcp-socket :${probe.tcpSocket.port}`);
  } else if (probe.exec) {
    parts.push(`exec ${(probe.exec.command || []).join(" ")}`);
  }
  
  if (probe.initialDelaySeconds) {
    parts.push(`delay=${probe.initialDelaySeconds}s`);
  }
  
  if (probe.timeoutSeconds) {
    parts.push(`timeout=${probe.timeoutSeconds}s`);
  }
  
  if (probe.periodSeconds) {
    parts.push(`period=${probe.periodSeconds}s`);
  }
  
  if (probe.successThreshold) {
    parts.push(`#success=${probe.successThreshold}`);
  }
  
  if (probe.failureThreshold) {
    parts.push(`#failure=${probe.failureThreshold}`);
  }
  
  return parts.join(" ");
}

/**
 * Generic resource formatter for unsupported types
 */
function formatGenericResource(resource: any): string {
  const w = createPrefixWriter();
  
  w.write(LEVEL_0, "Name:\t%s", resource.metadata?.name || "unknown");
  w.write(LEVEL_0, "Namespace:\t%s", resource.metadata?.namespace || "default");
  w.write(LEVEL_0, "Kind:\t%s", resource.kind);
  w.write(LEVEL_0, "API Version:\t%s", resource.apiVersion || "unknown");
  
  if (resource.metadata?.creationTimestamp) {
    w.write(LEVEL_0, "Creation Timestamp:\t%s", resource.metadata.creationTimestamp);
  }
  
  if (resource.metadata?.uid) {
    w.write(LEVEL_0, "UID:\t%s", resource.metadata.uid);
  }
  
  printLabelsMultiline(w, "Labels", resource.metadata?.labels);
  printLabelsMultiline(w, "Annotations", resource.metadata?.annotations);
  
  // Add spec info if available
  if (resource.spec) {
    w.write(LEVEL_0, "Spec:");
    formatNestedObject(w, resource.spec, LEVEL_1);
  }
  
  // Add status info if available
  if (resource.status) {
    w.write(LEVEL_0, "Status:");
    formatNestedObject(w, resource.status, LEVEL_1);
  }
  
  return w.lines.join("\n");
}

/**
 * Format a nested object with proper indentation
 */
function formatNestedObject(w: PrefixWriter, obj: any, level: number): void {
  if (!obj || typeof obj !== 'object') return;
  
  Object.entries(obj).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      w.write(level, "%s:\t<none>", key);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        w.write(level, "%s:\t<none>", key);
      } else {
        w.write(level, "%s:", key);
        value.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            w.write(level + 1, "[%d]:", index);
            formatNestedObject(w, item, level + 2);
          } else {
            w.write(level + 1, "[%d]:\t%s", index, String(item));
          }
        });
      }
    } else if (typeof value === 'object') {
      w.write(level, "%s:", key);
      formatNestedObject(w, value, level + 1);
    } else {
      w.write(level, "%s:\t%s", key, String(value));
    }
  });
}

/**
 * Detailed volume description function
 */
function describeVolume(w: PrefixWriter, volume: any): void {
  if (volume.persistentVolumeClaim) {
    w.write(LEVEL_2, "Type:\tPersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)");
    w.write(LEVEL_2, "ClaimName:\t%s", volume.persistentVolumeClaim.claimName);
    w.write(LEVEL_2, "ReadOnly:\t%s", volume.persistentVolumeClaim.readOnly ? "true" : "false");
  } else if (volume.hostPath) {
    w.write(LEVEL_2, "Type:\tHostPath (bare host directory volume)");
    w.write(LEVEL_2, "Path:\t%s", volume.hostPath.path);
    if (volume.hostPath.type) {
      w.write(LEVEL_2, "HostPathType:\t%s", volume.hostPath.type);
    }
  } else if (volume.emptyDir) {
    w.write(LEVEL_2, "Type:\tEmptyDir (a temporary directory that shares a pod's lifetime)");
    w.write(LEVEL_2, "Medium:\t%s", volume.emptyDir.medium || "");
    if (volume.emptyDir.sizeLimit) {
      w.write(LEVEL_2, "SizeLimit:\t%s", volume.emptyDir.sizeLimit);
    }
  } else if (volume.configMap) {
    w.write(LEVEL_2, "Type:\tConfigMap (a volume populated by a ConfigMap)");
    w.write(LEVEL_2, "Name:\t%s", volume.configMap.name);
    if (volume.configMap.optional !== undefined) {
      w.write(LEVEL_2, "Optional:\t%s", volume.configMap.optional.toString());
    }
    if (volume.configMap.items && volume.configMap.items.length > 0) {
      w.write(LEVEL_2, "Items:");
      volume.configMap.items.forEach((item: any) => {
        w.write(LEVEL_3, "%s -> %s", item.key, item.path);
      });
    }
  } else if (volume.secret) {
    w.write(LEVEL_2, "Type:\tSecret (a volume populated by a Secret)");
    w.write(LEVEL_2, "SecretName:\t%s", volume.secret.secretName);
    if (volume.secret.optional !== undefined) {
      w.write(LEVEL_2, "Optional:\t%s", volume.secret.optional.toString());
    }
    if (volume.secret.items && volume.secret.items.length > 0) {
      w.write(LEVEL_2, "Items:");
      volume.secret.items.forEach((item: any) => {
        w.write(LEVEL_3, "%s -> %s", item.key, item.path);
      });
    }
  } else if (volume.projected) {
    w.write(LEVEL_2, "Type:\tProjected (a volume that contains injected data from multiple sources)");
    if (volume.projected.sources && volume.projected.sources.length > 0) {
      w.write(LEVEL_2, "Sources:");
      volume.projected.sources.forEach((source: any) => {
        if (source.secret) {
          w.write(LEVEL_3, "Secret %s", source.secret.name);
        } else if (source.configMap) {
          w.write(LEVEL_3, "ConfigMap %s", source.configMap.name);
        } else if (source.downwardAPI) {
          w.write(LEVEL_3, "DownwardAPI");
        } else if (source.serviceAccountToken) {
          w.write(LEVEL_3, "ServiceAccountToken");
        }
      });
    }
  } else if (volume.downwardAPI) {
    w.write(LEVEL_2, "Type:\tDownwardAPI (a volume populated by information about the pod)");
    if (volume.downwardAPI.items && volume.downwardAPI.items.length > 0) {
      w.write(LEVEL_2, "Items:");
      volume.downwardAPI.items.forEach((item: any) => {
        w.write(LEVEL_3, "%s -> %s", formatDownwardAPIItem(item.fieldRef || item.resourceFieldRef), item.path);
      });
    }
  } else if (volume.csi) {
    w.write(LEVEL_2, "Type:\tCSI (a Container Storage Interface (CSI) volume source)");
    w.write(LEVEL_2, "Driver:\t%s", volume.csi.driver);
    w.write(LEVEL_2, "VolumeAttributes:\t%s", formatLabels(volume.csi.volumeAttributes));
    w.write(LEVEL_2, "ReadOnly:\t%s", volume.csi.readOnly ? "true" : "false");
  } else if (volume.nfs) {
    w.write(LEVEL_2, "Type:\tNFS (an NFS mount that lasts the lifetime of a pod)");
    w.write(LEVEL_2, "Server:\t%s", volume.nfs.server);
    w.write(LEVEL_2, "Path:\t%s", volume.nfs.path);
    w.write(LEVEL_2, "ReadOnly:\t%s", volume.nfs.readOnly ? "true" : "false");
  } else if (volume.glusterfs) {
    w.write(LEVEL_2, "Type:\tGlusterFS (a Glusterfs mount on the host that shares a pod's lifetime)");
    w.write(LEVEL_2, "EndpointsName:\t%s", volume.glusterfs.endpoints);
    w.write(LEVEL_2, "Path:\t%s", volume.glusterfs.path);
    w.write(LEVEL_2, "ReadOnly:\t%s", volume.glusterfs.readOnly ? "true" : "false");
  } else {
    w.write(LEVEL_2, "Type:\tOther");
  }
}

/**
 * Format downward API item reference
 */
function formatDownwardAPIItem(fieldRef: any): string {
  if (!fieldRef) return "<none>";
  
  if (fieldRef.fieldPath) {
    return fieldRef.fieldPath;
  } else if (fieldRef.containerName && fieldRef.resource) {
    return `${fieldRef.containerName}.${fieldRef.resource}`;
  }
  
  return "<unknown>";
} 