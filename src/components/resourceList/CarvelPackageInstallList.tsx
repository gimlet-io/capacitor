// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { CarvelPackageInstall, Event } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";
import { StatusBadges } from "./KustomizationList.tsx";

export const renderCarvelPackageInstallDetails = (pkgi: CarvelPackageInstall & { events?: Event [] }, columnCount = 4) => {
  // Helper to truncate long text
  const truncate = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '…';
  };

  const packageRef = pkgi.spec?.packageRef;
  const packageInfo = packageRef 
    ? truncate(`${packageRef.refName}${packageRef.versionSelection?.constraints ? ` (${packageRef.versionSelection.constraints})` : ''}`)
    : 'N/A';
  
  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="overflow: hidden;">
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>Package Ref:</strong> {packageInfo}
        </div>
      </div>
    </DetailRowCard>
  );
};

export const carvelPackageInstallColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (pkgi: CarvelPackageInstall) => (
      <>{pkgi.metadata.name}</>
    ),
    title: (pkgi: CarvelPackageInstall) => pkgi.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "8%",
    accessor: (pkgi: CarvelPackageInstall) =>
      useCalculateAge(pkgi.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "PACKAGE",
    width: "20%",
    accessor: (pkgi: CarvelPackageInstall) => {
      const packageRef = pkgi.spec?.packageRef;
      if (packageRef) {
        return <div>{packageRef.refName}</div>;
      }
      return <div>—</div>;
    },
  },
  {
    header: "VERSION",
    width: "10%",
    accessor: (pkgi: CarvelPackageInstall) => {
      const version = pkgi.status?.version;
      const lastAttempted = pkgi.status?.lastAttemptedVersion;
      
      if (version) {
        if (lastAttempted && lastAttempted !== version) {
          return (
            <div>
              <div>{version}</div>
              <div style="font-size: 0.85em; color: #f59e0b;" title={`Last attempted: ${lastAttempted}`}>
                ⚠ {lastAttempted}
              </div>
            </div>
          );
        }
        return <div>{version}</div>;
      }
      return <div>—</div>;
    },
  },
  {
    header: "STATE",
    width: "10%",
    accessor: (pkgi: CarvelPackageInstall) => {
      const badges: string[] = [];
      
      if (pkgi.spec?.paused) {
        badges.push('Paused');
      }
      if (pkgi.spec?.canceled) {
        badges.push('Canceled');
      }
      
      const readyCondition = pkgi.status?.conditions?.find((c) => c.type === ConditionType.Ready || c.type === 'ReconcileSucceeded');
      if (readyCondition) {
        if (readyCondition.status === ConditionStatus.True) {
          badges.push('Ready');
        } else if (readyCondition.status === ConditionStatus.False) {
          badges.push('NotReady');
        }
      }
      
      return (
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          {badges.map(badge => (
            <span class={`badge badge-${badge.toLowerCase()}`}>{badge}</span>
          ))}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "27%",
    accessor: (pkgi: CarvelPackageInstall) => {
      const friendlyDesc = pkgi.status?.friendlyDescription;
      const usefulErrorMessage = pkgi.status?.usefulErrorMessage;
      const readyCondition = pkgi.status?.conditions?.find((c) => c.type === ConditionType.Ready || c.type === 'ReconcileSucceeded');
      const reconcilingCondition = pkgi.status?.conditions?.find((c) => c.type === 'Reconciling');
      const stalledCondition = pkgi.status?.conditions?.find((c) => c.type === ConditionType.Stalled);
      const hasFailures = (pkgi.status?.consecutiveReconcileFailures || 0) > 0;
      
      const parts: string[] = [];
      
      if (friendlyDesc) {
        parts.push(friendlyDesc);
      }
      
      // Show usefulErrorMessage when there are failures
      if (hasFailures && usefulErrorMessage) {
        parts.push(usefulErrorMessage);
      }
      
      if (stalledCondition?.status === ConditionStatus.True && stalledCondition?.message) {
        parts.push(`Stalled: ${stalledCondition.message}`);
      }
      
      if (reconcilingCondition?.status === ConditionStatus.True && reconcilingCondition?.message) {
        parts.push(reconcilingCondition.message);
      }
      
      if (readyCondition?.message && !friendlyDesc) {
        parts.push(readyCondition.message);
      }
      
      const combined = parts.join(" | ");
      return <div class="message-cell">{combined || '—'}</div>;
    },
  },
];
