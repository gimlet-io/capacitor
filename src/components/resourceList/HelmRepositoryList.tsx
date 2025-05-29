import type { HelmRepository } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";

export const renderHelmRepositoryDetails = (helmRepository: HelmRepository, columnCount = 4) => (
  <td colSpan={columnCount}>
    <div class="second-row">
      <strong>URL:</strong> {helmRepository.spec.url} <br />
      {helmRepository.spec.secretRef && (
        <>
          <strong>Secret:</strong> {helmRepository.spec.secretRef.name} <br />
        </>
      )}
      <strong>Pass Credentials:</strong> {helmRepository.spec.passCredentials ? "True" : "False"} <br />
      <strong>Interval:</strong> {helmRepository.spec.interval} <br />
      <strong>Suspended:</strong>{" "}
      {helmRepository.spec.suspend ? "True" : "False"}
    </div>
  </td>
);

export const helmRepositoryColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (helmRepository: HelmRepository) => (
      <>{helmRepository.metadata.name}</>
    ),
    title: (helmRepository: HelmRepository) => helmRepository.metadata.name,
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (helmRepository: HelmRepository) =>
      useCalculateAge(helmRepository.metadata.creationTimestamp || "")(),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (helmRepository: HelmRepository) => {
      const readyCondition = helmRepository.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const artifactCondition = helmRepository.status?.conditions?.find((c) =>
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
            <span class="status-badge artifact">Indexed</span>
          )}
          {helmRepository.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (helmRepository: HelmRepository) => {
      const readyCondition = helmRepository.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
]; 