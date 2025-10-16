// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { OCIRepository } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";

export const renderOCIRepositoryDetails = (ociRepository: OCIRepository, columnCount = 4) => (
  <DetailRowCard columnCount={columnCount}>
    <div style="display: contents;">
      <strong>URL:</strong> {ociRepository.spec?.url} <br />
      <strong>Secret:</strong> {ociRepository.spec?.secretRef?.name} <br />
      <strong>Service Account:</strong> {ociRepository.spec?.serviceAccountName} <br />
      <strong>Insecure:</strong> {ociRepository.spec?.insecure ? "True" : "False"} <br />
      <strong>Interval:</strong> {ociRepository.spec?.interval} <br />
      <strong>Suspended:</strong>
      {ociRepository.spec && (
        <>
          {ociRepository.spec.suspend ? " True" : " False"} <br />
        </>
      )}
    </div>
  </DetailRowCard>
);

export const ociRepositoryColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (ociRepository: OCIRepository) => (
      <>{ociRepository.metadata.name}</>
    ),
    title: (ociRepository: OCIRepository) => ociRepository.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (ociRepository: OCIRepository) =>
      useCalculateAge(ociRepository.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
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
          {ociRepository.spec?.suspend && (
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