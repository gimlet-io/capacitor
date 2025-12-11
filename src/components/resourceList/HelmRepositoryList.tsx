// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { HelmRepository } from "../../types/k8s.ts";
import { ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";
import { FluxSourceStatusBadges } from "./FluxSourceStatusBadges.tsx";

export const renderHelmRepositoryDetails = (helmRepository: HelmRepository, columnCount = 4) => (
  <DetailRowCard columnCount={columnCount}>
    <div style="display: contents;">
      <strong>URL:</strong> {helmRepository?.spec?.url} <br />
      {helmRepository?.spec?.secretRef && (
        <>
          <strong>Secret:</strong> {helmRepository.spec?.secretRef?.name} <br />
        </>
      )}
      <strong>Pass Credentials:</strong> {helmRepository?.spec?.passCredentials ? "True" : "False"} <br />
      <strong>Interval:</strong> {helmRepository?.spec?.interval} <br />
      <strong>Suspended:</strong>{" "}
      {helmRepository?.spec?.suspend ? "True" : "False"}
    </div>
  </DetailRowCard>
);

export const helmRepositoryColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (helmRepository: HelmRepository) => (
      <>{helmRepository.metadata.name}</>
    ),
    title: (helmRepository: HelmRepository) => helmRepository.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (helmRepository: HelmRepository) =>
      useCalculateAge(helmRepository.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (helmRepository: HelmRepository) => (
      <FluxSourceStatusBadges resource={helmRepository} artifactLabel="Indexed" />
    ),
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