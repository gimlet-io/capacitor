import type { GitRepository } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByAge, sortByName } from "../../resourceTypeConfigs.tsx";

export const renderGitRepositoryDetails = (gitRepository: GitRepository, columnCount = 4) => (
  <td colSpan={columnCount}>
    <div class="second-row">
      <strong>URL:</strong> {gitRepository.spec.url} <br />
      {gitRepository.spec.ref && (
        <>
          <strong>Ref:</strong>{" "}
          {gitRepository.spec.ref.branch ? `Branch: ${gitRepository.spec.ref.branch}` : 
           gitRepository.spec.ref.tag ? `Tag: ${gitRepository.spec.ref.tag}` : 
           gitRepository.spec.ref.semver ? `Semver: ${gitRepository.spec.ref.semver}` : 
           gitRepository.spec.ref.commit ? `Commit: ${gitRepository.spec.ref.commit}` : ""} <br />
        </>
      )}
      {gitRepository.spec.secretRef && (
        <>
          <strong>Secret:</strong> {gitRepository.spec.secretRef.name} <br />
        </>
      )}
      <strong>Interval:</strong> {gitRepository.spec.interval} <br />
      <strong>Suspended:</strong>{" "}
      {gitRepository.spec.suspend ? "True" : "False"}
    </div>
  </td>
);

export const gitRepositoryColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (gitRepository: GitRepository) => (
      <>{gitRepository.metadata.name}</>
    ),
    title: (gitRepository: GitRepository) => gitRepository.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (gitRepository: GitRepository) =>
      useCalculateAge(gitRepository.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (gitRepository: GitRepository) => {
      const readyCondition = gitRepository.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const artifactCondition = gitRepository.status?.conditions?.find((c) =>
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
          {gitRepository.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (gitRepository: GitRepository) => {
      const readyCondition = gitRepository.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
]; 