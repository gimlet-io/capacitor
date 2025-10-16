// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

export function normalizeVersion(v: string): string {
  if (!v) return "0.0.0";
  const trimmed = v.trim();
  if (trimmed.toLowerCase() === "dev") return "0.0.0";
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

export function isFeatureRelease(v: string): boolean {
  // Feature releases are in format: YYYY-MM.N (e.g., 2025-09.1)
  // Non-feature releases have suffixes: -patch*, -rc*, -debug*
  const normalized = normalizeVersion(v);
  if (!normalized || normalized === "0.0.0") return false;
  
  // Check for suffixes that indicate non-feature releases
  if (normalized.includes("-patch") || normalized.includes("-rc") || normalized.includes("-debug")) {
    return false;
  }
  
  // Check if it matches the calendar versioning pattern: YYYY-MM.N
  const pattern = /^\d{4}-\d{2}\.\d+$/;
  return pattern.test(normalized);
}

export function isPreRelease(v: string): boolean {
  // Pre-releases are rc or debug versions that come before the feature release
  const normalized = normalizeVersion(v);
  return normalized.includes("-rc") || normalized.includes("-debug");
}

export function parseCalendarVersion(v: string): [number, number, number] {
  const normalized = normalizeVersion(v);
  // Handle "next-" prefix for backwards compatibility
  let version = normalized;
  if (version.startsWith("next-")) {
    version = version.split("next-")[1];
  }
  
  // Remove any suffix (e.g., -patch1, -rc2, -debug1)
  // Calendar format is YYYY-MM.N, so we need to keep the first hyphen
  // and only remove suffixes that come after the version number
  const suffixPattern = /-(patch|rc|debug)\d+$/;
  const core = version.replace(suffixPattern, "");
  
  // Parse calendar version: YYYY-MM.N
  const match = core.match(/^(\d{4})-(\d{2})\.(\d+)$/);
  if (match) {
    return [
      parseInt(match[1], 10), // year
      parseInt(match[2], 10), // month
      parseInt(match[3], 10), // feature number
    ];
  }
  
  return [0, 0, 0];
}

export function isNewerVersion(latest: string, current: string): boolean {
  // Only compare if latest is a feature release
  if (!isFeatureRelease(latest)) {
    return false;
  }
  
  const [lYear, lMonth, lFeature] = parseCalendarVersion(latest);
  const [cYear, cMonth, cFeature] = parseCalendarVersion(current);
  
  if (lYear !== cYear) return lYear > cYear;
  if (lMonth !== cMonth) return lMonth > cMonth;
  if (lFeature !== cFeature) return lFeature > cFeature;
  
  // If versions are numerically equal, only show update if current is a pre-release
  // (rc or debug). Don't show update if current is a patch release.
  // Examples:
  // - User on v2025-09.2-rc1, latest v2025-09.2 -> show update (pre-release to final)
  // - User on v2025-09.1-patch1, latest v2025-09.1 -> don't show (already on patched version)
  if (lYear === cYear && lMonth === cMonth && lFeature === cFeature) {
    return isPreRelease(current);
  }
  
  return false;
}
