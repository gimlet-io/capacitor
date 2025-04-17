import { JSX } from "solid-js";
import type { ArgoCDApplication } from '../types/k8s.ts';
import { useNavigate } from "@solidjs/router";
import { ResourceList } from './ResourceList.tsx';

export function ArgoCDResourceList(props: { 
  applications: ArgoCDApplication[]
}) {
  const navigate = useNavigate();

  const handleApplicationClick = (application: ArgoCDApplication) => {
    navigate(`/application/${application.metadata.namespace}/${application.metadata.name}`);
  };

  const renderApplicationDetails = (application: ArgoCDApplication) => (
    <td colSpan={4}>
      <div class="second-row">
        <strong>Source:</strong> {application.spec.source.repoURL} <br />
        <strong>Path:</strong> {application.spec.source.path} <br />
        <strong>Revision:</strong> {application.status?.sync.revision}
      </div>
    </td>
  );

  const columns = [
    {
      header: "NAME",
      width: "30%",
      accessor: (application: ArgoCDApplication) => <>{application.metadata.name}</>,
      title: (application: ArgoCDApplication) => application.metadata.name
    },
    {
      header: "STATUS",
      width: "20%",
      accessor: (application: ArgoCDApplication) => {
        const syncStatus = application.status?.sync?.status || 'Unknown';
        return (
          <span class={`status-badge sync-${syncStatus.toLowerCase()}`}>
            {syncStatus}
          </span>
        );
      }
    },
    {
      header: "HEALTH",
      width: "20%",
      accessor: (application: ArgoCDApplication) => {
        const healthStatus = application.status?.health?.status || 'Unknown';
        return (
          <span class={`status-badge health-${healthStatus.toLowerCase()}`}>
            {healthStatus}
          </span>
        );
      }
    },
    {
      header: "AGE",
      width: "10%",
      accessor: (application: ArgoCDApplication) => {
        if (!application.metadata.creationTimestamp) return <>N/A</>;
        const startTime = new Date(application.metadata.creationTimestamp);
        const now = new Date();
        const diff = now.getTime() - startTime.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
      }
    }
  ];

  return (
    <ResourceList 
      resources={props.applications} 
      columns={columns} 
      onItemClick={handleApplicationClick}
      detailRowRenderer={renderApplicationDetails}
      noSelectClass={true}
      rowKeyField="name"
    />
  );
} 