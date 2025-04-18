import { Filter } from "./FilterBar.tsx";

export const namespaceFilter: Filter = {
  name: "Namespace",
  type: "select",
  options: namespaceOptions(),
  multiSelect: false,
};

export const resourceTypeFilter: Filter = {
  name: "ResourceType",
  type: "select",
  options: CARD_TYPES.map((type) => ({ value: type.value, label: type.label })),
  multiSelect: false,
};
