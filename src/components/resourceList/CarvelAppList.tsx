// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { CarvelApp, Event } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";
import { StatusBadges } from "./KustomizationList.tsx";

export const renderCarvelAppDetails = (app: CarvelApp & { events?: Event[] }, columnCount = 4) => {
  // Helper to truncate long text
  const truncate = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '…';
  };

  // Helper to extract fetch source info
  const getFetchInfo = () => {
    const fetchSources = app.spec?.fetch;
    if (!fetchSources || !Array.isArray(fetchSources) || fetchSources.length === 0) return 'N/A';
    
    const parts: string[] = [];
    for (const fetch of fetchSources) {
      if (!fetch) continue;
      
      if (fetch.inline) {
        parts.push('inline');
      } else if (fetch.image && fetch.image.url) {
        parts.push(`image: ${truncate(fetch.image.url)}`);
      } else if (fetch.imgpkgBundle && fetch.imgpkgBundle.image) {
        parts.push(`imgpkgBundle: ${truncate(fetch.imgpkgBundle.image)}`);
      } else if (fetch.http && fetch.http.url) {
        parts.push(`http: ${truncate(fetch.http.url)}`);
      } else if (fetch.git && fetch.git.url) {
        parts.push(`git: ${truncate(fetch.git.url)}`);
      } else if (fetch.helmChart) {
        const chart = fetch.helmChart;
        if (chart && chart.name) {
          let chartInfo = chart.name;
          if (chart.version) chartInfo += `@${chart.version}`;
          if (chart.repository?.url) chartInfo += ` (${chart.repository.url})`;
          parts.push(`helmChart: ${truncate(chartInfo)}`);
        }
      }
    }
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };

  // Helper to extract template info
  const getTemplateInfo = () => {
    const templates = app.spec?.template;
    if (!templates || !Array.isArray(templates) || templates.length === 0) return 'N/A';
    
    const parts: string[] = [];
    for (const tmpl of templates) {
      if (!tmpl) continue;
      
      if (tmpl.ytt) parts.push('ytt');
      else if (tmpl.kbld) parts.push('kbld');
      else if (tmpl.helmTemplate) parts.push('helmTemplate');
      else if (tmpl.cue) parts.push('cue');
      else if (tmpl.sops) parts.push('sops');
    }
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };

  const syncPeriod = app.spec?.syncPeriod || '30s';
  const clusterInfo = app.spec?.cluster?.kubeconfigSecretRef?.name 
    ? `Remote (${truncate(app.spec.cluster.kubeconfigSecretRef.name, 50)})` 
    : 'in-cluster';
  
  return (
    <DetailRowCard columnCount={columnCount}>
      <div style="overflow: hidden;">
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>Sync Period:</strong> {syncPeriod}
        </div>
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>Fetch:</strong> {getFetchInfo()}
        </div>
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>Template:</strong> {getTemplateInfo()}
        </div>
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>Cluster:</strong> {clusterInfo}
        </div>
      </div>
    </DetailRowCard>
  );
};

export const carvelAppColumns = [
  {
    header: "NAME",
    width: "25%",
    accessor: (app: CarvelApp) => (
      <>{app.metadata.name}</>
    ),
    title: (app: CarvelApp) => app.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "8%",
    accessor: (app: CarvelApp) =>
      useCalculateAge(app.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "STATE",
    width: "12%",
    accessor: (app: CarvelApp) => {
      const badges: string[] = [];
      
      if (app.spec?.paused) {
        badges.push('Paused');
      }
      if (app.spec?.canceled) {
        badges.push('Canceled');
      }
      
      const readyCondition = app.status?.conditions?.find((c) => c.type === ConditionType.Ready || c.type === 'ReconcileSucceeded');
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
    header: "RECONCILE",
    width: "10%",
    accessor: (app: CarvelApp) => {
      const successes = app.status?.consecutiveReconcileSuccesses || 0;
      const failures = app.status?.consecutiveReconcileFailures || 0;
      
      if (failures > 0) {
        return <span style="color: #ef4444;">{failures} failures</span>;
      } else if (successes > 0) {
        return <span style="color: #10b981;">{successes} successes</span>;
      }
      return <span>—</span>;
    },
  },
  {
    header: "STATUS",
    width: "45%",
    accessor: (app: CarvelApp) => {
      const friendlyDesc = app.status?.friendlyDescription;
      const usefulErrorMessage = app.status?.usefulErrorMessage;
      const readyCondition = app.status?.conditions?.find((c) => c.type === ConditionType.Ready || c.type === 'ReconcileSucceeded');
      const reconcilingCondition = app.status?.conditions?.find((c) => c.type === 'Reconciling');
      const stalledCondition = app.status?.conditions?.find((c) => c.type === ConditionType.Stalled);
      const hasFailures = (app.status?.consecutiveReconcileFailures || 0) > 0;
      
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
