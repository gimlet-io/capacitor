// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import {
  normalizeVersion,
  isFeatureRelease,
  parseCalendarVersion,
  isNewerVersion,
} from "../utils/version.ts";

// Tests for normalizeVersion
Deno.test("normalizeVersion - handles empty string", () => {
  assertEquals(normalizeVersion(""), "0.0.0");
});

Deno.test("normalizeVersion - handles dev version", () => {
  assertEquals(normalizeVersion("dev"), "0.0.0");
  assertEquals(normalizeVersion("DEV"), "0.0.0");
});

Deno.test("normalizeVersion - removes v prefix", () => {
  assertEquals(normalizeVersion("v2025-09.1"), "2025-09.1");
  assertEquals(normalizeVersion("v2025-09.1-patch1"), "2025-09.1-patch1");
});

Deno.test("normalizeVersion - handles version without v prefix", () => {
  assertEquals(normalizeVersion("2025-09.1"), "2025-09.1");
});

// Tests for isFeatureRelease
Deno.test("isFeatureRelease - identifies valid feature releases", () => {
  assertEquals(isFeatureRelease("v2025-09.1"), true);
  assertEquals(isFeatureRelease("v2025-09.2"), true);
  assertEquals(isFeatureRelease("v2025-10.1"), true);
  assertEquals(isFeatureRelease("v2024-12.3"), true);
  assertEquals(isFeatureRelease("2025-09.1"), true); // without v prefix
});

Deno.test("isFeatureRelease - rejects patch releases", () => {
  assertEquals(isFeatureRelease("v2025-09.1-patch1"), false);
  assertEquals(isFeatureRelease("v2025-09.1-patch2"), false);
});

Deno.test("isFeatureRelease - rejects rc releases", () => {
  assertEquals(isFeatureRelease("v2025-09.2-rc1"), false);
  assertEquals(isFeatureRelease("v2025-09.2-rc2"), false);
});

Deno.test("isFeatureRelease - rejects debug releases", () => {
  assertEquals(isFeatureRelease("v2025-09.2-debug1"), false);
  assertEquals(isFeatureRelease("v2025-09.2-debug2"), false);
});

Deno.test("isFeatureRelease - rejects invalid formats", () => {
  assertEquals(isFeatureRelease(""), false);
  assertEquals(isFeatureRelease("dev"), false);
  assertEquals(isFeatureRelease("0.0.0"), false);
  assertEquals(isFeatureRelease("v1.0.0"), false); // semantic version
  assertEquals(isFeatureRelease("v2025.09.1"), false); // wrong separator
  assertEquals(isFeatureRelease("v25-09.1"), false); // short year
});

// Tests for parseCalendarVersion
Deno.test("parseCalendarVersion - parses valid calendar versions", () => {
  assertEquals(parseCalendarVersion("v2025-09.1"), [2025, 9, 1]);
  assertEquals(parseCalendarVersion("v2025-09.2"), [2025, 9, 2]);
  assertEquals(parseCalendarVersion("v2024-12.3"), [2024, 12, 3]);
  assertEquals(parseCalendarVersion("2025-10.1"), [2025, 10, 1]); // without v prefix
});

Deno.test("parseCalendarVersion - handles next- prefix", () => {
  assertEquals(parseCalendarVersion("next-2025-09.1"), [2025, 9, 1]);
});

Deno.test("parseCalendarVersion - parses version with suffix (extracts core)", () => {
  assertEquals(parseCalendarVersion("v2025-09.1-patch1"), [2025, 9, 1]);
  assertEquals(parseCalendarVersion("v2025-09.2-rc2"), [2025, 9, 2]);
  assertEquals(parseCalendarVersion("v2025-09.2-debug1"), [2025, 9, 2]);
});

Deno.test("parseCalendarVersion - returns [0,0,0] for invalid formats", () => {
  assertEquals(parseCalendarVersion(""), [0, 0, 0]);
  assertEquals(parseCalendarVersion("dev"), [0, 0, 0]);
  assertEquals(parseCalendarVersion("v1.0.0"), [0, 0, 0]);
  assertEquals(parseCalendarVersion("invalid"), [0, 0, 0]);
});

// Tests for isNewerVersion
Deno.test("isNewerVersion - detects newer year", () => {
  assertEquals(isNewerVersion("v2026-01.1", "v2025-12.2"), true);
  assertEquals(isNewerVersion("v2025-01.1", "v2026-12.2"), false);
});

Deno.test("isNewerVersion - detects newer month", () => {
  assertEquals(isNewerVersion("v2025-10.1", "v2025-09.2"), true);
  assertEquals(isNewerVersion("v2025-09.1", "v2025-10.2"), false);
});

Deno.test("isNewerVersion - detects newer feature number", () => {
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.1"), true);
  assertEquals(isNewerVersion("v2025-09.1", "v2025-09.2"), false);
});

Deno.test("isNewerVersion - returns false for same version", () => {
  assertEquals(isNewerVersion("v2025-09.1", "v2025-09.1"), false);
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.2"), false);
});

Deno.test("isNewerVersion - does NOT trigger on patch releases", () => {
  // Patch releases should not be considered as updates
  assertEquals(isNewerVersion("v2025-09.1-patch1", "v2025-09.1"), false);
  assertEquals(isNewerVersion("v2025-09.1-patch2", "v2025-09.1-patch1"), false);
});

Deno.test("isNewerVersion - does NOT trigger on rc releases", () => {
  // RC releases should not be considered as updates
  assertEquals(isNewerVersion("v2025-09.2-rc1", "v2025-09.1"), false);
  assertEquals(isNewerVersion("v2025-09.2-rc2", "v2025-09.2-rc1"), false);
});

Deno.test("isNewerVersion - does NOT trigger on debug releases", () => {
  // Debug releases should not be considered as updates
  assertEquals(isNewerVersion("v2025-09.2-debug1", "v2025-09.1"), false);
  assertEquals(isNewerVersion("v2025-09.2-debug2", "v2025-09.2-debug1"), false);
});

Deno.test("isNewerVersion - feature release is newer than patch of previous feature", () => {
  // v2025-09.2 is newer than v2025-09.1-patch1
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.1-patch1"), true);
  assertEquals(isNewerVersion("v2025-10.1", "v2025-09.2-patch5"), true);
});

Deno.test("isNewerVersion - handles current version being a patch", () => {
  // If current is v2025-09.1-patch1 and latest is v2025-09.2, should show update
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.1-patch1"), true);
  // If current is v2025-09.1-patch1 and latest is v2025-09.1, should not show update
  assertEquals(isNewerVersion("v2025-09.1", "v2025-09.1-patch1"), false);
});

Deno.test("isNewerVersion - complex real-world scenarios", () => {
  // Current: v2025-09.1, Latest: v2025-09.2 (feature) -> show update
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.1"), true);
  
  // Current: v2025-09.1-patch1, Latest: v2025-09.2 (feature) -> show update
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.1-patch1"), true);
  
  // Current: v2025-09.1, Latest: v2025-09.1-patch1 -> do NOT show update
  assertEquals(isNewerVersion("v2025-09.1-patch1", "v2025-09.1"), false);
  
  // Current: v2025-09.1, Latest: v2025-09.2-rc1 -> do NOT show update
  assertEquals(isNewerVersion("v2025-09.2-rc1", "v2025-09.1"), false);
  
  // Current: v2025-09.2-rc1, Latest: v2025-09.2 (feature) -> show update
  assertEquals(isNewerVersion("v2025-09.2", "v2025-09.2-rc1"), true);
});
