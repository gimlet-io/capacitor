# Task

@src/components/resourceList/NodeList.tsx
@src/components/resourceList/PodList.tsx
@src/components/resourceList/ResourceList.tsx
@src/resourceTypeConfigs.tsx
@src/views/dashboard.tsx

Node status is extracted from the Kubernetes resource state in NodeList.tsx where we define accessors. Extend accessor for nodes to display the common Kubernetes Node states like SchedulingDisabled, Cordoned. A node can have multiple states (look for it) or conditions, like DiskPressure, MemoryPressure. Display them as comma separated list, like kubectl does it on `kubectl get nodes`

## Metadata

- Issue: #151
- Branch: agent-151-3040982426
- Amp Thread ID: T-8865d174-de6b-4aa5-a47a-3dc95a7aab3b
- Created: 2025-07-06T06:10:01Z
