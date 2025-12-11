// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { GitRepository } from "../../types/k8s.ts";
import { ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByAge, sortByName } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";
import { FluxSourceStatusBadges } from "./FluxSourceStatusBadges.tsx";

export const renderGitRepositoryDetails = (gitRepository: GitRepository, columnCount = 4) => (
  <DetailRowCard columnCount={columnCount}>
    <div style="display: contents;">
      <strong>URL:</strong> {gitRepository.spec?.url} <br />
      {gitRepository.spec?.ref && (
        <>
          <strong>Ref:</strong>{" "}
          {gitRepository.spec?.ref.branch ? `Branch: ${gitRepository.spec.ref.branch}` : 
           gitRepository.spec?.ref.tag ? `Tag: ${gitRepository.spec.ref.tag}` : 
           gitRepository.spec?.ref.semver ? `Semver: ${gitRepository.spec.ref.semver}` : 
           gitRepository.spec?.ref.commit ? `Commit: ${gitRepository.spec.ref.commit}` : ""} <br />
        </>
      )}
      <strong>Secret:</strong> {gitRepository.spec?.secretRef?.name} <br />
      <strong>Interval:</strong> {gitRepository.spec?.interval} <br />
      <strong>Suspended:</strong>
      {gitRepository.spec && (
        <>
          {gitRepository.spec.suspend ? " True" : " False"} <br />
        </>
      )}
    </div>
  </DetailRowCard>
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
    accessor: (gitRepository: GitRepository) => (
      <FluxSourceStatusBadges resource={gitRepository} artifactLabel="Artifact" />
    ),
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