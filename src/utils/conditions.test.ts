// Copyright 2026 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import {
  ConditionReason,
  ConditionStatus,
  isDependencyNotReadyCondition,
} from "./conditions.ts";

Deno.test("isDependencyNotReadyCondition - true only for Ready=False with DependencyNotReady", () => {
  assertEquals(
    isDependencyNotReadyCondition({
      status: ConditionStatus.False,
      reason: ConditionReason.DependencyNotReady,
    }),
    true,
  );

  // status mismatch
  assertEquals(
    isDependencyNotReadyCondition({
      status: ConditionStatus.Unknown,
      reason: ConditionReason.DependencyNotReady,
    }),
    false,
  );

  // reason mismatch
  assertEquals(
    isDependencyNotReadyCondition({
      status: ConditionStatus.False,
      reason: ConditionReason.ReconciliationFailed,
    }),
    false,
  );

  // undefined/null safety
  assertEquals(isDependencyNotReadyCondition(undefined), false);
  assertEquals(isDependencyNotReadyCondition(null), false);
});
