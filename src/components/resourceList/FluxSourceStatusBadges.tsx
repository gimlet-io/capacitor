// Shared status badge renderer for Flux source resources
// (GitRepository, HelmRepository, HelmChart, OCIRepository, Bucket)

import {
  ConditionReason,
  ConditionStatus,
  ConditionType,
  isDependencyNotReadyCondition,
} from "../../utils/conditions.ts";

// Minimal shape we need from any Flux source-like resource
export type FluxSourceLike = {
  spec?: {
    suspend?: boolean;
  } | null;
  status?: {
    conditions?: Array<{
      type: string;
      status: ConditionStatus | string;
      reason?: ConditionReason | string;
    }>;
  };
};

export interface FluxSourceStatusBadgesProps {
  resource: FluxSourceLike;
  artifactLabel: string;
}

export const FluxSourceStatusBadges = (props: FluxSourceStatusBadgesProps) => {
  const conditions = props.resource.status?.conditions ?? [];

  const readyCondition = conditions.find(
    (c) => c.type === ConditionType.Ready || c.type === "Ready",
  );
  const reconcilingCondition = conditions.find(
    (c) => c.type === ConditionType.Reconciling || c.type === "Reconciling",
  );
  const artifactCondition = conditions.find(
    (c) => c.type === "ArtifactInStorage",
  );

  const suspended = !!props.resource.spec?.suspend;

  const isReconciling =
    // Dependency not ready is a transient state; treat it as "in progress".
    isDependencyNotReadyCondition(readyCondition) ||
    // Generic Flux pattern: Ready = Unknown while reconciling
    (readyCondition?.status === ConditionStatus.Unknown &&
      readyCondition?.reason !== ConditionReason.TerraformPlannedWithChanges) ||
    // Explicit Reconciling condition, if the controller sets it
    reconcilingCondition?.status === ConditionStatus.True;

  return (
    <div class="status-badges">
      {readyCondition?.status === ConditionStatus.True && (
        <span class="status-badge ready">Ready</span>
      )}
      {readyCondition?.status === ConditionStatus.False &&
        !isDependencyNotReadyCondition(readyCondition) && (
        <span class="status-badge not-ready">NotReady</span>
      )}
      {isReconciling && (
        <span class="status-badge reconciling">Reconciling</span>
      )}
      {artifactCondition?.status === ConditionStatus.True && (
        <span class="status-badge artifact">{props.artifactLabel}</span>
      )}
      {suspended && (
        <span class="status-badge suspended">Suspended</span>
      )}
    </div>
  );
};

// Small helper so non-list views (like sourceDetails) can
// reuse the same Reconciling detection logic without duplicating it.
export const fluxSourceReconciling = (resource: FluxSourceLike): boolean => {
  const conditions = resource.status?.conditions ?? [];
  const readyCondition = conditions.find(
    (c) => c.type === ConditionType.Ready || c.type === "Ready",
  );
  const reconcilingCondition = conditions.find(
    (c) => c.type === ConditionType.Reconciling || c.type === "Reconciling",
  );
  return (
    isDependencyNotReadyCondition(readyCondition) ||
    (readyCondition?.status === ConditionStatus.Unknown &&
      readyCondition?.reason !== ConditionReason.TerraformPlannedWithChanges) ||
    reconcilingCondition?.status === ConditionStatus.True
  );
};
