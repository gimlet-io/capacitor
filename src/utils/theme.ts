// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

export type ThemeName = "light" | "dark" | "mallow";

export function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  if (theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("ui.theme", theme);
    } catch {
      // Ignore storage errors (e.g., private mode)
    }
  }
}

export function loadInitialTheme(): ThemeName {
  try {
    const stored = localStorage.getItem("ui.theme");
    if (stored === "light" || stored === "dark" || stored === "mallow") {
      return stored;
    }
  } catch {
    // Ignore storage errors
  }
  return "light";
}

