## RBAC and Read-only Mode

Capacitor uses your kube config to access [your clusters](#multi-cluster). Thus it is using your personal access to the cluster. If your access is limited to certain actions only, Capacitor Next will respect your limited view on the cluster, eventually functioning as read-only.

### RBAC example for a read-only setup

```yaml
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: read-only-except-secrets
rules:
# Core API group (""), excluding secrets
- apiGroups: [""]
  resources: ["namespaces", "pods", "services", "configmaps", "endpoints", "persistentvolumeclaims", "namespaces", "nodes", "replicationcontrollers", "events", "serviceaccounts"]
  verbs: ["get", "list", "watch"]

# Apps API group
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
  verbs: ["get", "list", "watch"]

# Batch API group
- apiGroups: ["batch"]
  resources: ["jobs", "cronjobs"]
  verbs: ["get", "list", "watch"]

# Networking API group
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses", "networkpolicies"]
  verbs: ["get", "list", "watch"]

# RBAC API group
- apiGroups: ["rbac.authorization.k8s.io"]
  resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]
  verbs: ["get", "list", "watch"]

# Policy API group
- apiGroups: ["policy"]
  resources: ["poddisruptionbudgets", "podsecuritypolicies"]
  verbs: ["get", "list", "watch"]

# Storage API group
- apiGroups: ["storage.k8s.io"]
  resources: ["storageclasses", "volumeattachments"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: read-only-except-secrets-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: read-only-except-secrets
subjects:
- kind: User
  name: alice@example.com
```