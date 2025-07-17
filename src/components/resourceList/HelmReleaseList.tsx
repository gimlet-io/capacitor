import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import type { Column } from "../../resourceTypeConfigs.tsx";
import type { Filter } from "../filterBar/FilterBar.tsx";

export interface HelmRelease {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  spec: {
    chart: string;
    chartVersion: string;
    values: Record<string, any>;
  };
  status: {
    status: string;
    revision: number;
    appVersion: string;
    notes: string;
  };
}

// Status badge component for Helm releases
function StatusBadge(props: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'deployed':
        return 'var(--success-color)';
      case 'failed':
        return 'var(--error-color)';
      case 'pending-install':
      case 'pending-upgrade':
      case 'pending-rollback':
        return 'var(--warning-color)';
      case 'superseded':
        return 'var(--linear-text-tertiary)';
      default:
        return 'var(--linear-text-secondary)';
    }
  };

  return (
    <span 
      style={{
        color: getStatusColor(props.status),
        'font-weight': '500'
      }}
    >
      {props.status}
    </span>
  );
}

export const helmReleaseColumns: Column<HelmRelease>[] = [
  {
    header: "Name",
    width: "20%",
    accessor: (release) => <>{release.metadata?.name || ""}</>,
    title: (release) => release.metadata?.name || "",
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "Chart",
    width: "20%", 
    accessor: (release) => (
      <div style="display: flex; flex-direction: column;">
        <span>{release.spec?.chart || ""}</span>
        <span style="color: var(--linear-text-tertiary); font-size: 0.85em;">
          {release.spec?.chartVersion || ""}
        </span>
      </div>
    ),
    title: (release) => `${release.spec?.chart || ""} (${release.spec?.chartVersion || ""})`,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "App Version",
    width: "12%",
    accessor: (release) => <>{release.status?.appVersion || ""}</>,
    title: (release) => release.status?.appVersion || ""
  },
  {
    header: "Status",
    width: "12%", 
    accessor: (release) => <StatusBadge status={release.status?.status || ""} />,
    title: (release) => release.status?.status || ""
  },
  {
    header: "Revision",
    width: "8%",
    accessor: (release) => <>{release.status?.revision || ""}</>,
    title: (release) => String(release.status?.revision || "")
  },
  {
    header: "Age",
    width: "13%",
    accessor: (release) => useCalculateAge(release.metadata?.creationTimestamp || '')(),
    title: (release) => release.metadata?.creationTimestamp || "",
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  }
];

export const helmReleaseStatusFilter: Filter = {
  name: "HelmReleaseStatus",
  label: "Status",
  type: "select",
  options: [
    { value: "deployed", label: "Deployed" },
    { value: "failed", label: "Failed" },
    { value: "pending-install", label: "Pending Install" },
    { value: "pending-upgrade", label: "Pending Upgrade" },
    { value: "pending-rollback", label: "Pending Rollback" },
    { value: "superseded", label: "Superseded" }
  ],
  multiSelect: true,
  filterFunction: (release: HelmRelease, value: string) => {
    if (!value) return true;
    return (release.status?.status?.toLowerCase() || "") === value;
  }
};

export const helmReleaseChartFilter: Filter = {
  name: "HelmReleaseChart",
  label: "Chart",
  type: "text",
  placeholder: "Filter by chart name",
  filterFunction: (release: HelmRelease, value: string) => {
    if (!value) return true;
    return (release.spec?.chart || "").toLowerCase().includes(value.toLowerCase());
  }
};
