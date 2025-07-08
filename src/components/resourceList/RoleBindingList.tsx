import type { RoleBinding } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../resourceTypeConfigs.tsx';

// Format the subjects into a user-friendly string
function getSubjectsString(roleBinding: RoleBinding): string {
  const subjects = roleBinding.subjects || [];
  if (subjects.length === 0) {
    return "No subjects";
  }
  
  return subjects.map(subject => {
    const kind = subject.kind;
    const name = subject.name;
    const namespace = subject.namespace ? `(${subject.namespace})` : "";
    return `${kind}/${name}${namespace}`;
  }).join(", ");
}

// Define the columns for the RoleBinding resource list
export const roleBindingColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (roleBinding: RoleBinding) => <>{roleBinding.metadata.name}</>,
    title: (roleBinding: RoleBinding) => roleBinding.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "ROLE",
    width: "30%",
    accessor: (roleBinding: RoleBinding) => {
      const kind = roleBinding.roleRef.kind;
      const name = roleBinding.roleRef.name;
      return <>{kind}/{name}</>;
    },
  },
  {
    header: "SUBJECTS",
    width: "20%",
    accessor: (roleBinding: RoleBinding) => {
      const subjectCount = roleBinding.subjects?.length || 0;
      return <>{subjectCount} subject{subjectCount !== 1 ? "s" : ""}</>;
    },
    title: (roleBinding: RoleBinding) => getSubjectsString(roleBinding),
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (roleBinding: RoleBinding) => 
      useCalculateAge(roleBinding.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];

// Filter for RoleBindings by subject kind
export const roleBindingSubjectKindFilter: Filter = {
  name: "roleBindingSubjectKind",
  label: "Subject Kind",
  options: [
    { value: "User", label: "User" },
    { value: "Group", label: "Group" },
    { value: "ServiceAccount", label: "ServiceAccount" },
  ],
  filterFunction: (roleBinding: RoleBinding, value: string) => {
    if (!roleBinding.subjects) return false;
    
    return roleBinding.subjects.some(subject => subject.kind === value);
  },
};

// Filter for RoleBindings by role kind
export const roleBindingRoleKindFilter: Filter = {
  name: "roleBindingRoleKind",
  label: "Role Kind",
  options: [
    { value: "Role", label: "Role" },
    { value: "ClusterRole", label: "ClusterRole" },
  ],
  filterFunction: (roleBinding: RoleBinding, value: string) => {
    return roleBinding.roleRef.kind === value;
  },
}; 