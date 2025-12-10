// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

export function normalizeVersion(v: string): string {
  if (!v) return "0.0.0";
  const trimmed = v.trim();
  if (trimmed.toLowerCase() === "dev") return "0.0.0";
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

function stripBuildMetadata(v: string): string {
  return v.split("+")[0];
}

export function parseSemver(v: string): [number, number, number] {
  const normalized = normalizeVersion(v);
  if (!normalized) return [0, 0, 0];

  const withoutBuild = stripBuildMetadata(normalized);
  const core = withoutBuild.split("-")[0]; // drop pre-release part
  const parts = core.split(".");
  if (parts.length !== 3) return [0, 0, 0];

  const [majorStr, minorStr, patchStr] = parts;
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    return [0, 0, 0];
  }

  return [major, minor, patch];
}

export function isStableSemver(v: string): boolean {
  const normalized = normalizeVersion(v);
  if (!normalized || normalized === "0.0.0") return false;

  const withoutBuild = stripBuildMetadata(normalized);
  // Stable semver has no pre-release part
  if (withoutBuild.includes("-")) return false;

  const parts = withoutBuild.split(".");
  if (parts.length !== 3) return false;

  return parts.every((p) => /^\d+$/.test(p));
}

export function isFeatureRelease(v: string): boolean {
  // For pure semver, "feature release" means a stable semver (no pre-release suffix)
  return isStableSemver(v);
}

export function isPreRelease(v: string): boolean {
  // Pre-releases are semver versions with a pre-release suffix (e.g., -rc1, -beta.1)
  const normalized = normalizeVersion(v);
  if (!normalized) return false;

  const withoutBuild = stripBuildMetadata(normalized);
  const dashIndex = withoutBuild.indexOf("-");
  if (dashIndex === -1) return false;

  const core = withoutBuild.slice(0, dashIndex);
  const parts = core.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) {
    return false;
  }

  return true;
}

// Backwards-compatible name, now parsing pure semver into [major, minor, patch]
export function parseCalendarVersion(v: string): [number, number, number] {
  return parseSemver(v);
}

export function isNewerVersion(latest: string, current: string): boolean {
  // Only compare if latest is a stable semver release
  if (!isStableSemver(latest)) {
    return false;
  }

  const [lMajor, lMinor, lPatch] = parseSemver(latest);
  const [cMajor, cMinor, cPatch] = parseSemver(current);

  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  if (lPatch !== cPatch) return lPatch > cPatch;

  // If versions are numerically equal, only show update if current is a pre-release
  // (e.g., 0.12.0-rc1 -> 0.12.0). Build metadata does not matter.
  if (lMajor === cMajor && lMinor === cMinor && lPatch === cPatch) {
    return isPreRelease(current);
  }

  return false;
}
