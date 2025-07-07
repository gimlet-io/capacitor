# Task

@src/components/resourceList/resourceList.tsx
@src/components/resourceList/resourceTypeConfigs.tsx

We need to be able to order resources displayed in the ResourceList.tsx.
- By default resources are ordered by name, but i would like to make this more flexible.
- Each columns in resourceTypeConfig can be marked as a column that supports ordering, and the ordering function should be configurable.
- The default name based ordering should be adopted to this new system.
- One example is age based filtering. Resources that have age as a column should be able to ordered by age based on the same function
- Naturally there should be UI elements to toggle ordering per certain column.
- There is a sortColumn on resourceTypeConfigs already, but that concept is not used. Feels like it is there to overwrite the default name based filter for some event types. Instead of this

## Metadata

- Issue: #155
- Branch: agent-155-3045749261
- Amp Thread ID: T-0fd74191-5bea-4f98-b302-b3fb7c9ff26e
- Created: 2025-07-07T16:09:22Z
