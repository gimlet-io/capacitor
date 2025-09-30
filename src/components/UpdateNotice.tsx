import { createSignal, onMount, Show } from "solid-js";

type GithubRelease = {
  tag_name: string;
  html_url?: string;
};

function normalizeVersion(v: string): string {
  if (!v) return "0.0.0";
  const trimmed = v.trim();
  if (trimmed.toLowerCase() === "dev") return "0.0.0";
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

function isFeatureRelease(v: string): boolean {
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

function parseCalendarVersion(v: string): [number, number, number] {
  const normalized = normalizeVersion(v);
  // Handle "next-" prefix for backwards compatibility
  let version = normalized;
  if (version.startsWith("next-")) {
    version = version.split("next-")[1];
  }
  
  // Remove any suffix (e.g., -patch1, -rc2, -debug1)
  const core = version.split("-")[0];
  
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

function isNewerVersion(latest: string, current: string): boolean {
  // Only compare if latest is a feature release
  if (!isFeatureRelease(latest)) {
    return false;
  }
  
  const [lYear, lMonth, lFeature] = parseCalendarVersion(latest);
  const [cYear, cMonth, cFeature] = parseCalendarVersion(current);
  
  if (lYear !== cYear) return lYear > cYear;
  if (lMonth !== cMonth) return lMonth > cMonth;
  if (lFeature !== cFeature) return lFeature > cFeature;
  
  return false;
}

export function UpdateNotice() {
  const [show, setShow] = createSignal(false);
  const [latestTag, setLatestTag] = createSignal<string>("");
  const [releaseUrl, setReleaseUrl] = createSignal<string>("https://github.com/gimlet-io/capacitor/releases");

  onMount(async () => {
    try {
      const ctx = (window as any).apiResourceContext || undefined;
      const apiPrefix = ctx ? `/api/${encodeURIComponent(ctx)}` : '/api';
      const versionResp = await fetch(`${apiPrefix}/version`);
      const versionData = (await versionResp.json()) as { version: string };
      const current = versionData?.version ?? "0.0.0";

      const ghResp = await fetch("https://api.github.com/repos/gimlet-io/capacitor/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!ghResp.ok) return;
      const latest = (await ghResp.json()) as GithubRelease;
      const tag = latest?.tag_name ?? "";
      if (!tag) return;

      const dismissedFor = localStorage.getItem("updateDismissedVersion");
      if (dismissedFor && dismissedFor === tag) return;

      if (isNewerVersion(tag, current)) {
        setLatestTag(tag);
        setReleaseUrl(latest.html_url || `https://github.com/gimlet-io/capacitor/releases/tag/${tag}`);
        setShow(true);
      }
    } catch (_) {
      // Silent fail
    }
  });

  const handleInstall = () => {
    const url = releaseUrl();
    globalThis.open(url, "_blank", "noopener,noreferrer");
    // Do not dismiss automatically; user may come back and still want banner hidden this session
    setShow(false);
  };

  const handleLater = () => {
    // Remember choice for this version only
    const tag = latestTag();
    if (tag) localStorage.setItem("updateDismissedVersion", tag);
    setShow(false);
  };

  return (
    <Show when={show()}>
      <div class="update-notice" role="status" aria-live="polite">
        <span style={{ display: "inline-flex", gap: "10px", "align-items": "center" }}>
          <span>New update available</span>
        </span>
        <div class="update-notice__actions">
          <button type="button" class="update-notice__btn update-notice__btn--ghost" onClick={handleLater}>
            Later
          </button>
          <button type="button" class="update-notice__btn update-notice__btn--primary" onClick={handleInstall}>
            Install Now
          </button>
        </div>
      </div>
    </Show>
  );
}

export default UpdateNotice;

