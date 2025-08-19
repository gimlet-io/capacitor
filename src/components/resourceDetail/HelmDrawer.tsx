// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { HelmRelease } from "../resourceList/HelmReleaseList.tsx";
import { Tabs } from "../Tabs.tsx";
import { HelmValues } from "./HelmValues.tsx";
import { HelmManifest } from "./HelmManifest.tsx";
import { HelmHistory } from "./HelmHistory.tsx";

export function HelmDrawer(props: {
  resource: HelmRelease;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "history" | "values" | "manifest";
}) {
  const [activeTab, setActiveTab] = createSignal<
    "history" | "values" | "manifest"
  >(props.initialTab || "history");
  const [selectedRevisionNumber, setSelectedRevisionNumber] = createSignal<number | undefined>(undefined);

  let contentRef: HTMLDivElement | undefined;
  

  createEffect(() => {});

  // Watch for changes to initialTab prop
  createEffect(() => {
    if (props.initialTab) {
      setActiveTab(props.initialTab);
    }
  });

  // History handled inside HelmHistory component

  // Values fetching moved to HelmValues component

  // Diff expansion handled in HelmHistory

  // Manifest diff handled in HelmHistory

  // Parsing helpers moved to child components

  // Diff expansion handled in child components

  // Diff rendering handled in HelmHistory

  // Removed inline diff views

  // Removed inline manifest diff view

  // Rollback handled by HelmHistory component

  // Helper function to refresh data based on the current tab
  const refreshTabData = () => {};

  // Load data when the drawer opens or active tab changes
  createEffect(() => {
    // no-op; children manage their own loading
  });

  // Values tab fetch handled inside HelmValues component

  // Manifest fetching handled by HelmManifest component

  // History keyboard handling is owned by HelmHistory

  // Handle keyboard shortcuts (tab switching and close)
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen) return;

    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      props.onClose();
    }

    // Tab shortcuts
    if (e.key === "1" || e.key === "h") {
      e.stopPropagation();
      e.preventDefault();
      setActiveTab("history");
    } else if (e.key === "2" || e.key === "v") {
      e.stopPropagation();
      e.preventDefault();
      setActiveTab("values");
    } else if (e.key === "3" || e.key === "m") {
      e.stopPropagation();
      e.preventDefault();
      setActiveTab("manifest");
    }
  };

  // Set up keyboard event listener
  onMount(() => {
    globalThis.addEventListener('keydown', handleKeyDown as EventListener, true);
    refreshTabData();
    if (props.isOpen) document.body.style.overflow = 'hidden';
  });

  onCleanup(() => {
    globalThis.removeEventListener('keydown', handleKeyDown as EventListener, true);
    
    // Restore body scrolling when drawer is closed or unmounted
    document.body.style.overflow = '';
  });

  // Watch for changes to the isOpen prop
  createEffect(() => {
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
      // Fetch data when the drawer opens
      refreshTabData();
    } else {
      document.body.style.overflow = '';
    }
  });

  // Status color handled inside HelmHistory if needed

  // Values tab controlled inside HelmValues component

  return (
    <Show when={props.isOpen}>
      <div class="resource-drawer-backdrop" onClick={props.onClose}>
        <div class="resource-drawer" onClick={(e) => e.stopPropagation()}>
          <div class="resource-drawer-header">
            <div class="drawer-title">
              Helm Release: {props.resource?.metadata.name}
            </div>
            <button class="drawer-close" onClick={props.onClose}>×</button>
          </div>

          <Tabs
            class="drawer-tabs"
            tabs={[
              { key: "history", label: "Release History" },
              { key: "values", label: "Values" },
              { key: "manifest", label: "Manifest" },
            ]}
            activeKey={activeTab()}
            onChange={(k) => setActiveTab(k as "history" | "values" | "manifest")}
            buttonClass="drawer-tab"
            activeClass="active"
          />

          <div
            class="drawer-content"
            ref={contentRef}
            tabIndex={0}
            style="outline: none;"
          >
            {/* Child components manage their own loading states */}

            <Show when={activeTab() === "history"}>
              <HelmHistory
                namespace={props.resource?.metadata.namespace || ""}
                name={props.resource?.metadata.name || ""}
                apiVersion={(props.resource as unknown as { apiVersion?: string }).apiVersion || ""}
                kind={(props.resource as unknown as { kind?: string }).kind || ""}
                onSelectedRevisionChange={(rev) => {
                  setSelectedRevisionNumber(rev);
                }}
              />
            </Show>

            <Show when={activeTab() === "values"}>
              <HelmValues namespace={props.resource?.metadata.namespace || ""} name={props.resource?.metadata.name || ""} />
            </Show>

            <Show when={activeTab() === "manifest"}>
              <HelmManifest namespace={props.resource?.metadata.namespace || ""} name={props.resource?.metadata.name || ""} revision={selectedRevisionNumber()} />
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
