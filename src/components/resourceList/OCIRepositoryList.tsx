import type { OCIRepository } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";

export const renderOCIRepositoryDetails = (ociRepository: OCIRepository, columnCount = 4) => (
  <td colSpan={columnCount}>
    <div class="second-row">
      <strong>URL:</strong> {ociRepository.spec.url} <br />
      {ociRepository.spec.secretRef && (
        <>
          <strong>Secret:</strong> {ociRepository.spec.secretRef.name} <br />
        </>
      )}
      {ociRepository.spec.provider && (
        <>
          <strong>Provider:</strong> {ociRepository.spec.provider} <br />
        </>
      )}
      {ociRepository.spec.serviceAccountName && (
        <>
          <strong>Service Account:</strong> {ociRepository.spec.serviceAccountName} <br />
        </>
      )}
      {ociRepository.spec.insecure !== undefined && (
        <>
          <strong>Insecure:</strong> {ociRepository.spec.insecure ? "True" : "False"} <br />
        </>
      )}
      <strong>Interval:</strong> {ociRepository.spec.interval} <br />
      <strong>Suspended:</strong>{" "}
      {ociRepository.spec.suspend ? "True" : "False"}
    </div>
  </td>
);

export const ociRepositoryColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (ociRepository: OCIRepository) => (
      <>{ociRepository.metadata.name}</>
    ),
    title: (ociRepository: OCIRepository) => ociRepository.metadata.name,
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (ociRepository: OCIRepository) =>
      useCalculateAge(ociRepository.metadata.creationTimestamp || "")(),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (ociRepository: OCIRepository) => {
      const readyCondition = ociRepository.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const artifactCondition = ociRepository.status?.conditions?.find((c) =>
        c.type === "ArtifactInStorage"
      );

      return (
        <div class="status-badges">
          {readyCondition?.status === ConditionStatus.True && (
            <span class="status-badge ready">Ready</span>
          )}
          {readyCondition?.status === ConditionStatus.False && (
            <span class="status-badge not-ready">NotReady</span>
          )}
          {artifactCondition?.status === ConditionStatus.True && (
            <span class="status-badge artifact">Artifact</span>
          )}
          {ociRepository.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (ociRepository: OCIRepository) => {
      const readyCondition = ociRepository.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
]; 