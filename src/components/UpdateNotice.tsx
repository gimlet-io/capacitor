import { createSignal, onMount, Show } from "solid-js";
import { isNewerVersion } from "../utils/version.ts";

type GithubRelease = {
  tag_name: string;
  html_url?: string;
};

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

