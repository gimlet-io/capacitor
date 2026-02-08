// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// Based on FluxCD's condition management from:
// https://github.com/fluxcd/pkg/blob/main/runtime/conditions/getter.go
// https://github.com/fluxcd/kustomize-controller/blob/main/api/v1beta2/condition_types.go

export const enum ConditionType {
  Ready = "Ready",
  Healthy = "Healthy",
  Reconciling = "Reconciling",
  Stalled = "Stalled",
  Plan = "Plan"
}

export const enum ConditionStatus {
  True = "True",
  False = "False",
  Unknown = "Unknown"
}

export const enum ConditionReason {
  ReconciliationSucceeded = "ReconciliationSucceeded",
  ReconciliationFailed = "ReconciliationFailed",
  ProgressingWithRetry = "ProgressingWithRetry",
  Progressing = "Progressing",
  HealthCheckFailed = "HealthCheckFailed",
  DependencyNotReady = "DependencyNotReady",
  ArtifactFailed = "ArtifactFailed",
  BuildFailed = "BuildFailed",
  PruneFailed = "PruneFailed",
  TerraformPlannedWithChanges = "TerraformPlannedWithChanges"
}

export interface Condition {
  type: ConditionType;
  status: ConditionStatus;
  reason: ConditionReason;
  message: string;
  lastTransitionTime: string;
  observedGeneration?: number;
}

// Minimal shape used across the UI when looking at "Ready"-like conditions
// coming from untyped Kubernetes objects.
export type ReadyLikeCondition = {
  status?: ConditionStatus | string;
  reason?: ConditionReason | string;
} | null | undefined;

// Flux controllers commonly use Ready=False with reason DependencyNotReady
// to indicate a transient "waiting for dependencies" state.
export function isDependencyNotReadyCondition(condition: ReadyLikeCondition): boolean {
  return (
    condition?.status === ConditionStatus.False &&
    condition?.reason === ConditionReason.DependencyNotReady
  );
}

// Helper functions to check condition status
export function isConditionTrue(conditions: Condition[], type: ConditionType): boolean {
  const condition = conditions.find(c => c.type === type);
  return condition?.status === ConditionStatus.True;
}

export function isConditionFalse(conditions: Condition[], type: ConditionType): boolean {
  const condition = conditions.find(c => c.type === type);
  return condition?.status === ConditionStatus.False;
}

export function isConditionUnknown(conditions: Condition[], type: ConditionType): boolean {
  const condition = conditions.find(c => c.type === type);
  return !condition || condition.status === ConditionStatus.Unknown;
}

// Main rollup function that determines if a resource is ready
export function isReady(conditions: Condition[]): boolean {
  return !isConditionTrue(conditions, ConditionType.Stalled) && 
         !isConditionTrue(conditions, ConditionType.Reconciling) &&
         isConditionTrue(conditions, ConditionType.Ready);
}

// Get a human readable status from the conditions
export function getHumanReadableStatus(conditions: Condition[]): string {
  if (isConditionTrue(conditions, ConditionType.Stalled)) {
    const condition = conditions.find(c => c.type === ConditionType.Stalled);
    return `Stalled: ${condition?.reason || 'Unknown reason'}`;
  }
  
  if (isConditionTrue(conditions, ConditionType.Reconciling)) {
    return 'Reconciling';
  }

  if (isConditionTrue(conditions, ConditionType.Ready)) {
    return 'Ready';
  }

  const readyCondition = conditions.find(c => c.type === ConditionType.Ready);
  if (readyCondition) {
    return `Not Ready: ${readyCondition.reason}`;
  }

  return 'Unknown';
}
