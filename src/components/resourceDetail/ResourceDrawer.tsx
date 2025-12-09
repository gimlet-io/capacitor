// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createEffect, Show, onMount, onCleanup, For, type JSX } from "solid-js";
import { EventList } from "../resourceList/EventList.tsx";
import { LogsViewer } from "./LogsViewer.tsx";
import { TerminalViewer } from "./TerminalViewer.tsx";
import type { Event } from "../../types/k8s.ts";
import { stringify, parse } from "@std/yaml";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { getResourceName } from "../../utils/k8s.ts";
import { Tabs } from "../Tabs.tsx";
import hljs from "highlight.js";
import { MetricsViewer } from "./MetricsViewer.tsx";
import { useCheckPermissionSSAR, type MinimalK8sResource } from "../../utils/permissions.ts";
import { doesEventMatchShortcut } from "../../utils/shortcuts.ts";
import { generateDiffHunks, type DiffHunk } from "../../utils/diffUtils.ts";

type DrawerTab = "describe" | "yaml" | "events" | "logs" | "exec" | "metrics" | "edit";

export function ResourceDrawer(props: {
  resource: any;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: DrawerTab;
}) {
  const [activeTab, setActiveTab] = createSignal<DrawerTab>(props.initialTab || "describe");
  const [describeData, setDescribeData] = createSignal<string>("");
  const [yamlData, setYamlData] = createSignal<string>("");
  const [yamlDataWithManaged, setYamlDataWithManaged] = createSignal<string>("");
  const [yamlHtml, setYamlHtml] = createSignal<string>("");
  const [events, setEvents] = createSignal<Event[]>([]);
  const [loading, setLoading] = createSignal<boolean>(true);
  const [showManagedFields, setShowManagedFields] = createSignal<boolean>(false);
  const [canEditResource, setCanEditResource] = createSignal<boolean | undefined>(undefined);

  const [editYamlText, setEditYamlText] = createSignal<string>("");
  const [editInitialYaml, setEditInitialYaml] = createSignal<string>("");
  const [editDirty, setEditDirty] = createSignal<boolean>(false);
  const [editSaving, setEditSaving] = createSignal<boolean>(false);
  const [editError, setEditError] = createSignal<string | null>(null);
  const [editDiffHunks, setEditDiffHunks] = createSignal<DiffHunk[]>([]);

  const apiResourceStore = useApiResourceStore();
  const checkPermission = useCheckPermissionSSAR();
  let lastResourceKey: string | undefined;
  
  let describeContentRef: HTMLPreElement | undefined;
  let yamlContentRef: HTMLPreElement | undefined;
  let editContentRef: HTMLTextAreaElement | undefined;

  // Keep syntax highlighting in sync with YAML content and toggle state
  createEffect(() => {
    const includeManaged = showManagedFields();
    const baseYaml = includeManaged && yamlDataWithManaged()
      ? yamlDataWithManaged()
      : yamlData();

    if (!baseYaml) {
      setYamlHtml("");
      return;
    }

    try {
      const { value } = hljs.highlight(baseYaml, { language: "yaml" });
      setYamlHtml(value);
    } catch (_) {
      setYamlHtml("");
    }
  });

  // Reset YAML/edit state when the selected resource changes
  createEffect(() => {
    const res = props.resource as MinimalK8sResource | undefined;
    if (!res || !res.metadata) {
      lastResourceKey = undefined;
      return;
    }
    const key = `${res.apiVersion || "v1"}|${res.kind}|${res.metadata.namespace || ""}|${res.metadata.name || ""}`;
    if (key === lastResourceKey) return;
    lastResourceKey = key;

    setYamlData("");
    setYamlDataWithManaged("");
    setYamlHtml("");
    setShowManagedFields(false);

    setEditYamlText("");
    setEditInitialYaml("");
    setEditDirty(false);
    setEditError(null);
    setEditDiffHunks([]);
  });

  // Recompute inline diff when content changes
  createEffect(() => {
    const original = (editInitialYaml() || "").split("\n");
    const edited = (editYamlText() || "").split("\n");
    const hunks = generateDiffHunks(original, edited);
    setEditDiffHunks(hunks);
  });

  // Watch for changes to initialTab prop
  createEffect(() => {
    if (props.initialTab) {
      setActiveTab(props.initialTab);
    }
  });

  // Fetch the describe data when the drawer opens
  const fetchDescribeData = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const kind = props.resource.kind || "unknown";
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace || "";
      const apiVersion = props.resource.apiVersion || "";
      
      // Construct the URL with apiVersion as a query parameter if available
      let url = `${apiPrefix}/describe/${namespace}/${kind}/${name}`;
      if (apiVersion) {
        url += `?apiVersion=${encodeURIComponent(apiVersion)}`;
      }
      
      // Call the backend API for describe data
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch describe data: ${response.statusText}`);
      }
      
      const data = await response.json();
      const describeCmd = `kubectl describe ${kind.toLowerCase()} ${name}${namespace ? ` -n ${namespace}` : ''}`;
      setDescribeData(`Command: ${describeCmd}\n\n${data.output}`);
    } catch (error) {
      console.error("Error fetching describe data:", error);
      setDescribeData(`Error fetching describe data: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
      // Focus the describe content after loading
      if (activeTab() === "describe") {
        setTimeout(() => describeContentRef?.focus(), 50);
      }
    }
  };

  // Helper function to get the correct plural resource name

  // Fetch the YAML data when the drawer opens
  const fetchYamlData = async (includeManagedFields: boolean = false) => {
    if (!props.resource) return;

    setLoading(true);
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const kind = props.resource.kind || "unknown";
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      const apiVersion = props.resource.apiVersion || "";
      
      // Use kubectl proxy to get the resource
      const isNamespaced = namespace && namespace !== '';
      const resourcePath = apiVersion.includes('/') 
        ? `${k8sPrefix}/apis/${apiVersion}` 
        : `${k8sPrefix}/api/${apiVersion || 'v1'}`;
      
      // Get the correct plural resource name
      const apiResources = apiResourceStore.apiResources || [];
      const resourceName = getResourceName(kind, apiVersion, apiResources);
      
      let url = isNamespaced
        ? `${resourcePath}/namespaces/${namespace}/${resourceName}/${name}`
        : `${resourcePath}/${resourceName}/${name}`;

      // When explicitly requested, tell the backend proxy not to strip managedFields
      if (includeManagedFields) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}includeManagedFields=true`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch resource: ${response.statusText}`);
      }
      
      const data = await response.json();
      const yamlText = stringify(data);

      if (includeManagedFields) {
        setYamlDataWithManaged(yamlText);
      } else {
        setYamlData(yamlText);
      }
    } catch (error) {
      console.error("Error fetching YAML data:", error);
      setYamlData(`Error fetching YAML data: ${error instanceof Error ? error.message : String(error)}`);
      setYamlHtml("");
    } finally {
      setLoading(false);
      // Focus the yaml content after loading
      if (activeTab() === "yaml") {
        setTimeout(() => yamlContentRef?.focus(), 50);
      }
    }
  };

  // Check whether the current user can edit (patch) this resource
  createEffect(() => {
    const res = props.resource as MinimalK8sResource | undefined;
    if (!props.isOpen || !res || !res.metadata) {
      setCanEditResource(undefined);
      return;
    }

    const key = `${res.apiVersion || "v1"}|${res.kind}|${res.metadata.namespace || ""}|${res.metadata.name || ""}`;
    let cancelled = false;

    (async () => {
      try {
        const allowed = await checkPermission(
          {
            apiVersion: res.apiVersion,
            kind: res.kind,
            metadata: {
              name: res.metadata.name,
              namespace: res.metadata.namespace,
            },
          },
          { verb: "patch" }
        );
        if (!cancelled) {
          // Only apply if resource is still the same
          const current = props.resource as MinimalK8sResource | undefined;
          const currentKey = current
            ? `${current.apiVersion || "v1"}|${current.kind}|${current.metadata.namespace || ""}|${current.metadata.name || ""}`
            : "";
          if (currentKey === key) {
            setCanEditResource(allowed);
          }
        }
      } catch (_) {
        if (!cancelled) {
          setCanEditResource(undefined);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  // Fetch events for the selected resource
  const fetchResourceEvents = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const kind = props.resource.kind;
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      
      // Fetch events using the field selector
      const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
      const eventsUrl = namespace 
        ? `${k8sPrefix}/api/v1/namespaces/${namespace}/events?fieldSelector=${fieldSelector}`
        : `${k8sPrefix}/api/v1/events?fieldSelector=${fieldSelector}`;
      
      const response = await fetch(eventsUrl);
      const eventsData = await response.json();
      setEvents(eventsData.items || []);
    } catch (error) {
      console.error("Error fetching resource events:", error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  // Focus appropriate content when tab changes
  createEffect(() => {
    const tab = activeTab();
    
    if (!loading() && props.isOpen) {
      setTimeout(() => {
        if (tab === "describe" && describeContentRef) {
          describeContentRef.focus();
        } else if (tab === "yaml" && yamlContentRef) {
          yamlContentRef.focus();
        } else if (tab === "edit" && editContentRef) {
          editContentRef.focus();
        }
      }, 50);
    }
  });

  // Load data when the drawer opens or the active tab changes
  createEffect(() => {
    if (props.isOpen) {
      // Reset loading state whenever the tab changes
      // Only set loading for non-logs tabs, as LogsViewer manages its own loading state
      if (activeTab() !== "logs") {
        setLoading(true);
      }
      
      if (activeTab() === "describe") {
        fetchDescribeData();
      } else if (activeTab() === "yaml") {
        // Default YAML view hides managedFields; reset toggle and cached full YAML
        setShowManagedFields(false);
        setYamlDataWithManaged("");
        fetchYamlData(false);
      } else if (activeTab() === "events") {
        fetchResourceEvents();
      } else if (activeTab() === "edit") {
        // Initialize edit view from the latest YAML (without managedFields)
        const init = async () => {
          try {
            if (!yamlData()) {
              await fetchYamlData(false);
            }
            const baseYaml = yamlData();
            setEditYamlText(baseYaml);
            setEditInitialYaml(baseYaml);
            setEditDirty(false);
            setEditError(null);
          } finally {
            setLoading(false);
          }
        };
        init();
      }
    }
  });

  const saveEditedResource = async () => {
    if (!props.resource) return;

    const original: any = props.resource;
    const text = editYamlText();

    let parsed: any;
    try {
      parsed = parse(text);
    } catch (e) {
      setEditError(e instanceof Error ? `YAML parse error: ${e.message}` : "YAML parse error");
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      setEditError("Edited YAML must define a Kubernetes object");
      return;
    }

    const origNs = original.metadata?.namespace || "";
    const origName = original.metadata?.name || "";
    const newNs = parsed?.metadata?.namespace || "";
    const newName = parsed?.metadata?.name || "";

    if (
      String(parsed.apiVersion || "") !== String(original.apiVersion || "") ||
      String(parsed.kind || "") !== String(original.kind || "") ||
      String(newName || "") !== String(origName || "") ||
      String(newNs || "") !== String(origNs || "")
    ) {
      setEditError("apiVersion, kind, metadata.name and metadata.namespace must remain unchanged");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const ctxName = apiResourceStore.contextInfo?.current
        ? encodeURIComponent(apiResourceStore.contextInfo.current)
        : "";
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
      const apiVersion = original.apiVersion || "v1";
      const isNamespaced = !!origNs;
      const resourcePath = apiVersion.includes("/")
        ? `${k8sPrefix}/apis/${apiVersion}`
        : `${k8sPrefix}/api/${apiVersion}`;

      const apiResources = apiResourceStore.apiResources || [];
      const resourceName = getResourceName(original.kind || "unknown", apiVersion, apiResources);

      const url = isNamespaced
        ? `${resourcePath}/namespaces/${origNs}/${resourceName}/${origName}`
        : `${resourcePath}/${resourceName}/${origName}`;

      const resp = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
        body: JSON.stringify(parsed),
      });

      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        throw new Error(bodyText || `Failed to save resource (HTTP ${resp.status})`);
      }

      const updated = await resp.json();
      const updatedYaml = stringify(updated);
      setEditYamlText(updatedYaml);
      setEditInitialYaml(updatedYaml);
      setEditDirty(false);
      setEditError(null);
      setYamlData(updatedYaml);
      setYamlDataWithManaged("");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  };

  const resetEditedResource = () => {
    const initial = editInitialYaml();
    setEditYamlText(initial);
    setEditDirty(false);
    setEditError(null);
  };

  const renderEditDiffHunk = (hunk: DiffHunk): JSX.Element[] => {
    const lines: JSX.Element[] = [];
    let oldLineNum = hunk.startOldLine + 1;
    let newLineNum = hunk.startNewLine + 1;

    hunk.changes.forEach((change) => {
      let className = "";
      let lineContent = "";
      let oldNum = "";
      let newNum = "";

      if (change.type === "add") {
        className = "diff-line-added";
        lineContent = `+${change.value}`;
        newNum = String(newLineNum++);
      } else if (change.type === "remove") {
        className = "diff-line-removed";
        lineContent = `-${change.value}`;
        oldNum = String(oldLineNum++);
      } else {
        className = "diff-line-context";
        lineContent = ` ${change.value}`;
        oldNum = String(oldLineNum++);
        newNum = String(newLineNum++);
      }

      lines.push(
        <div class={className}>
          <span class="line-number old">{oldNum}</span>
          <span class="line-number new">{newNum}</span>
          <span class="line-content">{lineContent}</span>
        </div>,
      );
    });

    return lines;
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen) return;
    
    // Don't handle shortcuts if any input is focused
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }
    
    // Allow certain keys to pass through to LogsViewer when on logs tab
    if (activeTab() === "logs") {
      const logsKeys = ['/', 'n', 'N'];
      if (logsKeys.includes(e.key) || (e.key === 'n' && e.shiftKey)) {
        // Don't stop propagation for these keys when on logs tab
        return;
      }
    }
    
    // Stop propagation to prevent ResourceList from handling these events
    e.stopPropagation();
    
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }

    // Edit tab shortcut (mod+e) when drawer is open
    if (doesEventMatchShortcut(e, "mod+e")) {
      e.preventDefault();
      if (canEditResource()) {
        setActiveTab("edit");
      }
      return;
    }
    
    // Tab shortcuts
    if (e.key === "1" || e.key === "d") {
      e.preventDefault();
      setActiveTab("describe");
    } else if (e.key === "2" || e.key === "y") {
      e.preventDefault();
      setActiveTab("yaml");
    } else if (e.key === "3" || e.key === "e") {
      e.preventDefault();
      setActiveTab("events");
    } else if (e.key === "4" || e.key === "l") {
      // Only switch to logs tab if it's available
      if (["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"].includes(props.resource?.kind)) {
        e.preventDefault();
        setActiveTab("logs");
      }
    } else if (e.key === "5" || e.key === "x") {
      // x shortcut for exec tab (only available for Pods)
      if (props.resource?.kind === "Pod") {
        e.preventDefault();
        setActiveTab("exec");
      }
    } else if (e.key === "6" || e.key === "m") {
      // m shortcut for metrics tab (available for common workload kinds)
      if (["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet", "CronJob"].includes(props.resource?.kind)) {
        e.preventDefault();
        setActiveTab("metrics");
      }
    }
  };

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    
    // Prevent body scrolling when drawer is open
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
    }
  });

  // Clean up event listener
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown, true);
    
    // Restore body scrolling when drawer is closed or unmounted
    document.body.style.overflow = '';
  });

  // Watch for changes to the isOpen prop
  createEffect(() => {
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="resource-drawer-backdrop" onClick={props.onClose}>
        <div class="resource-drawer" onClick={(e) => e.stopPropagation()}>
          <div class="resource-drawer-header">
            <div class="drawer-title">
              {props.resource?.kind} Details: {props.resource?.metadata.name}
            </div>
            <button class="drawer-close" onClick={props.onClose}>×</button>
          </div>
          
          <Tabs
            class="drawer-tabs"
            tabs={[
              { key: "describe", label: <span>Describe <span class="shortcut-key">d</span></span> },
              { key: "yaml", label: <span>YAML <span class="shortcut-key">y</span></span> },
              { key: "events", label: <span>Events <span class="shortcut-key">e</span></span> },
              ...(canEditResource() ? [{ key: "edit", label: <span>Edit <span class="shortcut-key">{`mod+e`}</span></span> }] : []),
              ...( ["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet", "CronJob"].includes(props.resource?.kind)
                ? [{ key: "metrics", label: <span>Metrics <span class="shortcut-key">m</span></span> }]
                : []),
              ...( ["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"].includes(props.resource?.kind)
                ? [{ key: "logs", label: <span>Logs <span class="shortcut-key">l</span></span> }]
                : []),
              ...( props.resource?.kind === "Pod"
                ? [{ key: "exec", label: <span>Exec <span class="shortcut-key">x</span></span> }]
                : []),
            ]}
            activeKey={activeTab()}
            onChange={(k) => setActiveTab(k as DrawerTab)}
            buttonClass="drawer-tab"
            activeClass="active"
          />
          
          <div class="drawer-content">
            <Show when={activeTab() === "describe"}>
              <Show when={loading()}>
                <div class="drawer-loading">Loading...</div>
              </Show>
              <Show when={!loading()}>
                <pre class="describe-content" ref={describeContentRef} tabIndex={0} style="outline: none;">{describeData()}</pre>
              </Show>
            </Show>
            
            <Show when={activeTab() === "yaml"}>
              <Show when={loading()}>
                <div class="drawer-loading">Loading...</div>
              </Show>
              <Show when={!loading()}>
                <div class="yaml-controls">
                  <label class="yaml-managed-fields-toggle">
                    <input
                      type="checkbox"
                      checked={showManagedFields()}
                      onChange={(e) => {
                        const checked = (e.currentTarget as HTMLInputElement).checked;
                        setShowManagedFields(checked);
                        // Lazily fetch full YAML (with managedFields) the first time it is requested
                        if (checked && !yamlDataWithManaged()) {
                          fetchYamlData(true);
                        }
                      }}
                    />
                    Show managedFields
                  </label>
                </div>
                <Show
                  when={yamlHtml()}
                  fallback={
                    <pre
                      class="yaml-content"
                      ref={yamlContentRef}
                      tabIndex={0}
                      style="outline: none;"
                    >
                      {showManagedFields() && yamlDataWithManaged()
                        ? yamlDataWithManaged()
                        : yamlData()}
                    </pre>
                  }
                >
                  <pre
                    class="yaml-content"
                    ref={yamlContentRef}
                    tabIndex={0}
                    style="outline: none;"
                  >
                    <code
                      class="hljs language-yaml"
                      innerHTML={yamlHtml()!}
                    ></code>
                  </pre>
                </Show>
              </Show>
            </Show>
            
            <Show when={activeTab() === "events"}>
              <Show when={loading()}>
                <div class="drawer-loading">Loading...</div>
              </Show>
              <Show when={!loading()}>
                <Show when={events().length > 0} fallback={<div class="no-events">No events found</div>}>
                  <EventList events={events()} />
                </Show>
              </Show>
            </Show>
            
            <Show when={activeTab() === "logs"}>
              <LogsViewer resource={props.resource} isOpen={props.isOpen && activeTab() === "logs"} />
            </Show>
            
            <Show when={activeTab() === "metrics"}>
              <MetricsViewer resource={props.resource} isOpen={props.isOpen && activeTab() === "metrics"} />
            </Show>
            
            <Show when={activeTab() === "exec"}>
              <TerminalViewer resource={props.resource} isOpen={props.isOpen && activeTab() === "exec"} />
            </Show>

            <Show when={activeTab() === "edit"}>
              <Show when={loading()}>
                <div class="drawer-loading">Loading...</div>
              </Show>
              <Show when={!loading()}>
                <div class="yaml-edit-controls">
                  <button
                    class="drawer-button"
                    disabled={!editDirty() || editSaving() || !canEditResource()}
                    onClick={saveEditedResource}
                    title={canEditResource() === false ? "Not permitted" : undefined}
                  >
                    {editSaving() ? "Saving..." : "Save"}
                  </button>
                  <button
                    class="drawer-button secondary"
                    disabled={!editDirty() || editSaving()}
                    onClick={resetEditedResource}
                  >
                    Reset
                  </button>
                  <Show when={editError()}>
                    {(err) => <div class="form-error">{err()}</div>}
                  </Show>
                </div>
                <textarea
                  ref={editContentRef}
                  class="yaml-edit-textarea"
                  value={editYamlText()}
                  onInput={(e) => {
                    const val = (e.currentTarget as HTMLTextAreaElement).value;
                    setEditYamlText(val);
                    setEditDirty(val !== editInitialYaml());
                  }}
                  rows={24}
                  spellcheck={false}
                />
                <div class="diff-content yaml-edit-diff">
                  <Show
                    when={editDiffHunks().length > 0}
                    fallback={<div class="no-data">No differences from last saved version</div>}
                  >
                    <For each={editDiffHunks()}>
                      {(hunk) => (
                        <div class="diff-hunk">
                          {renderEditDiffHunk(hunk)}
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
} 