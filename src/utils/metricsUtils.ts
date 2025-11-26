// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// Shared helpers for parsing Kubernetes CPU/memory quantity strings into
// numeric units suitable for display and lightweight calculations.
// CPU is returned in milliCPU (m), memory in mebibytes (Mi).

export function parseCpuToMilli(qty: string | undefined): number {
  if (!qty) return 0;
  const v = qty.trim();
  if (v.endsWith("n")) {
    const n = parseFloat(v.slice(0, -1));
    return Number.isFinite(n) ? n / 1_000_000 : 0; // nano -> mCPU
  }
  if (v.endsWith("u")) {
    const n = parseFloat(v.slice(0, -1));
    return Number.isFinite(n) ? n / 1_000 : 0; // micro -> mCPU
  }
  if (v.endsWith("m")) {
    const n = parseFloat(v.slice(0, -1));
    return Number.isFinite(n) ? n : 0; // already mCPU
  }
  const n = parseFloat(v); // cores
  return Number.isFinite(n) ? n * 1000 : 0;
}

export function parseMemToMi(qty: string | undefined): number {
  if (!qty) return 0;
  const v = qty.trim();
  // Binary units
  const biUnits: Record<string, number> = {
    Ki: 1 / 1024,
    Mi: 1,
    Gi: 1024,
    Ti: 1024 * 1024,
    Pi: 1024 * 1024 * 1024,
  };
  for (const u of Object.keys(biUnits)) {
    if (v.endsWith(u)) {
      const n = parseFloat(v.slice(0, -u.length));
      return Number.isFinite(n) ? n * biUnits[u] : 0;
    }
  }
  // Decimal units
  const decUnits: Record<string, number> = {
    k: 1 / 1048.576,
    M: 1 / 1.048576,
    G: 953.674,
    T: 976_562.5,
  };
  for (const u of Object.keys(decUnits)) {
    if (v.endsWith(u)) {
      const n = parseFloat(v.slice(0, -u.length));
      return Number.isFinite(n) ? n * decUnits[u] : 0;
    }
  }
  // Assume bytes -> Mi
  const n = parseFloat(v);
  return Number.isFinite(n) ? n / (1024 * 1024) : 0;
}


