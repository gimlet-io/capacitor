# Task

@src/resourceTypeConfigs.tsx
@src/components/resourceList/resourceTypeConfigs.tsx

We configure the available commands (keyboard shortcuts) in the resource type configs. The logs command is configured for pods, deployments, etc. We can reconcile flux kustomizations.

Your task is to add a new command: rollout restart, that should be available for deployments, statefullsets and daemonsets. The behavior should mimic the `kuebctl rollout restart deploy/mydpeloyment` command.

## Metadata

- Issue: #158
- Branch: agent-158-3045638590
- Amp Thread ID: T-79fe029f-b458-4faa-99fa-4fecb2077114
- Created: 2025-07-07T15:32:56Z
