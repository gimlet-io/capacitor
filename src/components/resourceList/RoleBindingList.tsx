import type { RoleBinding, ClusterRoleBinding } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';

// Format the subjects into a concise summary string
function getSubjectsString(item: { subjects?: Array<{ kind: string; name: string; namespace?: string }> }): string {
  const subjects = item.subjects || [];
  if (subjects.length === 0) return "No subjects";
  return subjects.map(s => `${s.kind}/${s.name}${s.namespace ? `(${s.namespace})` : ''}`).join(", ");
}

// Define the columns for the RoleBinding resource list
export const roleBindingColumns = [
  {
    header: "NAME",
    width: "30%",
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
    width: "25%",
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

// Define the columns for the ClusterRoleBinding resource list (kubectl: NAME, ROLE, AGE)
export const clusterRoleBindingColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (crb: ClusterRoleBinding) => <>{crb.metadata.name}</>,
    title: (crb: ClusterRoleBinding) => crb.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "ROLE",
    width: "30%",
    accessor: (crb: ClusterRoleBinding) => {
      const kind = crb.roleRef.kind;
      const name = crb.roleRef.name;
      return <>{kind}/{name}</>;
    },
  },
  {
    header: "SUBJECTS",
    width: "25%",
    accessor: (crb: ClusterRoleBinding) => {
      const subjectCount = crb.subjects?.length || 0;
      return <>{subjectCount} subject{subjectCount !== 1 ? "s" : ""}</>;
    },
    title: (crb: ClusterRoleBinding) => getSubjectsString(crb),
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (crb: ClusterRoleBinding) => 
      useCalculateAge(crb.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
];

// Detail renderer for showing full subjects list for RoleBinding/ClusterRoleBinding
export const renderRoleBindingDetails = (item: { subjects?: Array<{ kind: string; name: string; namespace?: string }> }, columnCount = 4) => {
  const subjects = item.subjects || [];
  return (
    <td colSpan={columnCount}>
      <div class="second-row" style="display: flex; gap: 24px;">
        <div style="flex: 1;">
          {subjects.length === 0 ? (
            <div>None</div>
          ) : (
            <ul>
              {subjects.map(s => (
                <li>{s.kind}/{s.name}{s.namespace ? ` (${s.namespace})` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </td>
  );
};

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