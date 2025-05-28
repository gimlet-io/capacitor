import { JSX } from "solid-js";
import type { RoleBinding } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

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
  },
  {
    header: "NAMESPACE",
    width: "15%",
    accessor: (roleBinding: RoleBinding) => <>{roleBinding.metadata.namespace}</>,
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
    width: "10%",
    accessor: (roleBinding: RoleBinding) => {
      if (!roleBinding.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(roleBinding.metadata.creationTimestamp);
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
    },
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