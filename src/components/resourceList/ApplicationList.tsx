import type { ArgoCDApplication } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from "./timeUtils.ts";

export const argocdApplicationSyncFilter: Filter = {
  name: "ApplicationSyncStatus",
  label: "Sync Status",
  type: "select",
  options: [
    { label: "Synced", value: "Synced", color: "var(--linear-green)" },
    { label: "OutOfSync", value: "OutOfSync", color: "var(--linear-red)" },
    {
      label: "Unknown",
      value: "Unknown",
      color: "var(--linear-text-tertiary)",
    },
  ],
  multiSelect: true,
  filterFunction: (application: ArgoCDApplication, value: string) => {
    return application.status?.sync?.status === value;
  },
};

export const argocdApplicationHealthFilter: Filter = {
  name: "ApplicationHealth",
  label: "Health",
  type: "select",
  options: [
    { label: "Healthy", value: "Healthy", color: "var(--linear-green)" },
    { label: "Progressing", value: "Progressing", color: "var(--linear-blue)" },
    { label: "Degraded", value: "Degraded", color: "var(--linear-red)" },
    {
      label: "Suspended",
      value: "Suspended",
      color: "var(--linear-text-tertiary)",
    },
    { label: "Missing", value: "Missing", color: "var(--linear-yellow)" },
    {
      label: "Unknown",
      value: "Unknown",
      color: "var(--linear-text-tertiary)",
    },
  ],
  multiSelect: true,
  filterFunction: (application: ArgoCDApplication, value: string) => {
    return application.status?.health?.status === value;
  },
};

export const renderApplicationDetails = (application: ArgoCDApplication) => (
  <td colSpan={4}>
    <div class="second-row">
      <strong>Source:</strong> {application.spec.source.repoURL} <br />
      <strong>Path:</strong> {application.spec.source.path} <br />
      <strong>Revision:</strong> {application.status?.sync.revision}
    </div>
  </td>
);

export const applicationColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (application: ArgoCDApplication) => (
      <>{application.metadata.name}</>
    ),
    title: (application: ArgoCDApplication) => application.metadata.name,
  },
  {
    header: "STATUS",
    width: "20%",
    accessor: (application: ArgoCDApplication) => {
      const syncStatus = application.status?.sync?.status || "Unknown";
      return (
        <span class={`status-badge sync-${syncStatus.toLowerCase()}`}>
          {syncStatus}
        </span>
      );
    },
  },
  {
    header: "HEALTH",
    width: "20%",
    accessor: (application: ArgoCDApplication) => {
      const healthStatus = application.status?.health?.status || "Unknown";
      return (
        <span class={`status-badge health-${healthStatus.toLowerCase()}`}>
          {healthStatus}
        </span>
      );
    },
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (application: ArgoCDApplication) =>
      useCalculateAge(application.metadata.creationTimestamp || "")(),
  },
];
