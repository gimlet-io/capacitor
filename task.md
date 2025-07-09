# Task

@cli/pkg/server.go
@src/resourceTypeConfigs.tsx
@src/components/resourceList/ResourceList.tsx

We have a reconcile function for flux resources. It is triggered as a keyboard shortcut (command) in the resource list. We need a new command on the keyboard shortcut ctrl+w that triggers the same reconcile api, with an extra flag that reconciles not just the resource in question but its sources. This should be the exact same behavior as when one reconciles resources with `flux reconcile kustomization x --with source`

## Metadata

- Issue: #69
- Branch: agent-69-3052238597
- Amp Thread ID: T-6c1dbd61-7033-40db-8a62-5065cadbae76
- Created: 2025-07-09T11:14:54Z
