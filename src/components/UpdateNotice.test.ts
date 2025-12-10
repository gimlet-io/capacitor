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
  assertEquals(normalizeVersion("v0.12.0"), "0.12.0");
  assertEquals(normalizeVersion("v0.12.0-rc1"), "0.12.0-rc1");
});

Deno.test("normalizeVersion - handles version without v prefix", () => {
  assertEquals(normalizeVersion("0.12.0"), "0.12.0");
});

// Tests for isFeatureRelease
Deno.test("isFeatureRelease - identifies stable semver releases", () => {
  assertEquals(isFeatureRelease("v0.12.0"), true);
  assertEquals(isFeatureRelease("0.12.0"), true);
  assertEquals(isFeatureRelease("1.0.0"), true);
});

Deno.test("isFeatureRelease - rejects pre-releases and invalid formats", () => {
  assertEquals(isFeatureRelease("0.12.0-rc1"), false);
  assertEquals(isFeatureRelease("0.12.0-beta.1"), false);
  assertEquals(isFeatureRelease(""), false);
  assertEquals(isFeatureRelease("dev"), false);
  assertEquals(isFeatureRelease("2025-09.1"), false);
});

// Tests for parseCalendarVersion (now backed by semver parsing)
Deno.test("parseCalendarVersion (semver) - parses valid semver", () => {
  assertEquals(parseCalendarVersion("v0.12.0"), [0, 12, 0]);
  assertEquals(parseCalendarVersion("0.12.1"), [0, 12, 1]);
  assertEquals(parseCalendarVersion("1.2.3"), [1, 2, 3]);
});

Deno.test("parseCalendarVersion (semver) - ignores pre-release and build metadata", () => {
  assertEquals(parseCalendarVersion("0.12.0-rc1"), [0, 12, 0]);
  assertEquals(parseCalendarVersion("1.2.3+build.10"), [1, 2, 3]);
  assertEquals(parseCalendarVersion("1.2.3-rc1+build.10"), [1, 2, 3]);
});

Deno.test("parseCalendarVersion (semver) - returns [0,0,0] for invalid formats", () => {
  assertEquals(parseCalendarVersion(""), [0, 0, 0]);
  assertEquals(parseCalendarVersion("dev"), [0, 0, 0]);
  assertEquals(parseCalendarVersion("2025-09.1"), [0, 0, 0]);
});

// Tests for isNewerVersion with pure semver
Deno.test("isNewerVersion - detects newer major", () => {
  assertEquals(isNewerVersion("1.0.0", "0.12.0"), true);
  assertEquals(isNewerVersion("0.12.0", "1.0.0"), false);
});

Deno.test("isNewerVersion - detects newer minor", () => {
  assertEquals(isNewerVersion("0.13.0", "0.12.0"), true);
  assertEquals(isNewerVersion("0.12.0", "0.13.0"), false);
});

Deno.test("isNewerVersion - detects newer patch", () => {
  assertEquals(isNewerVersion("0.12.1", "0.12.0"), true);
  assertEquals(isNewerVersion("0.12.0", "0.12.1"), false);
});

Deno.test("isNewerVersion - returns false for same stable version", () => {
  assertEquals(isNewerVersion("0.12.0", "0.12.0"), false);
  assertEquals(isNewerVersion("1.2.3", "1.2.3"), false);
});

Deno.test("isNewerVersion - ignores pre-release latest", () => {
  assertEquals(isNewerVersion("0.12.0-rc1", "0.11.0"), false);
});

Deno.test("isNewerVersion - stable newer than pre-release of same version", () => {
  assertEquals(isNewerVersion("0.12.0", "0.12.0-rc1"), true);
});
