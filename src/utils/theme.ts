export type ThemeName = "light" | "dark" | "mallow";

export async function fetchDefaultTheme(): Promise<ThemeName | null> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return null;
    const data = await res.json();
    const theme = (data?.theme ?? "light") as string;
    if (theme === "light" || theme === "dark" || theme === "mallow") {
      return theme;
    }
    return "light";
  } catch {
    // Ignore network errors; fall back to defaults
    return null;
  }
}

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

