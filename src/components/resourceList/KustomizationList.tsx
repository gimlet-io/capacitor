import type { Kustomization, ExtendedKustomization } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";

export const renderKustomizationDetails = (kustomization: ExtendedKustomization, columnCount = 4) => {
  return(
  <td colSpan={columnCount}>
    <div class="second-row" style="display: flex; gap: 50px;">
      <div>
        <strong>Source:</strong> {kustomization.spec.sourceRef.kind}/{kustomization.spec.sourceRef.namespace ? kustomization.spec.sourceRef.namespace : kustomization.metadata.namespace}/{kustomization.spec.sourceRef.name} <br />
        <strong>Path:</strong> {kustomization.spec.path} <br />
        <strong>Prune:</strong> {kustomization.spec.prune ? "True" : "False"}{" "}
        <br />
        <strong>Interval:</strong> {kustomization.spec.interval}
      </div>
      <div>
        <strong>Events:</strong>
        <ul>
          {kustomization.events.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
            <li><span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: {event.message}</li>
          ))} 
        </ul>
      </div>
    </div>
  </td>
)}

export const KustomizationColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (kustomization: Kustomization) => (
      <>{kustomization.metadata.name}</>
    ),
    title: (kustomization: Kustomization) => kustomization.metadata.name,
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByName(items, ascending),
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (kustomization: Kustomization) =>
      useCalculateAge(kustomization.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: any[], ascending: boolean) => sortByAge(items, ascending),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (kustomization: ExtendedKustomization) => StatusBadges(kustomization),
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (kustomization: Kustomization) => {
      const readyCondition = kustomization.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
];

export const StatusBadges = (kustomization: ExtendedKustomization) => {
  const readyCondition = kustomization.status?.conditions?.find((c) =>
    c.type === ConditionType.Ready
  );
  const reconcilingCondition = kustomization.status?.conditions?.find((c) =>
    c.type === ConditionType.Reconciling
  );
  const sourceReadyCondition = kustomization.source?.status?.conditions?.find((c) =>
    c.type === ConditionType.Ready
  );
  const sourceReconcilingCondition = kustomization.source?.status?.conditions?.find((c) =>
    c.type === ConditionType.Reconciling
  );

  return (
    <div class="status-badges">
      {readyCondition?.status === ConditionStatus.True && (
        <span class="status-badge ready">Ready</span>
      )}
      {readyCondition?.status === ConditionStatus.False && (
        <span class="status-badge not-ready">NotReady</span>
      )}
      {reconcilingCondition?.status === ConditionStatus.True && (
        <span class="status-badge reconciling">Reconciling</span>
      )}
      {kustomization.spec.suspend && (
        <span class="status-badge suspended">Suspended</span>
      )}
      {sourceReadyCondition?.status === ConditionStatus.True && (
        <span class="status-badge ready">Source: Ready</span>
      )}
      {sourceReadyCondition?.status === ConditionStatus.False && (
        <span class="status-badge not-ready">Source: NotReady</span>
      )}
      {sourceReconcilingCondition?.status === ConditionStatus.True && (
        <span class="status-badge reconciling">Source: Reconciling</span>
      )}
    </div>
  );
};