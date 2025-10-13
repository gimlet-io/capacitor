// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js";
import { EventList } from "../resourceList/EventList.tsx";
import { LogsViewer } from "./LogsViewer.tsx";
import { TerminalViewer } from "./TerminalViewer.tsx";
import type { Event } from "../../types/k8s.ts";
import { stringify } from "@std/yaml";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { Tabs } from "../Tabs.tsx";
import hljs from "highlight.js";

type DrawerTab = "describe" | "yaml" | "events" | "logs" | "exec";

export function ResourceDrawer(props: {
  resource: any;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: DrawerTab;
}) {
  const [activeTab, setActiveTab] = createSignal<DrawerTab>(props.initialTab || "describe");
  const [describeData, setDescribeData] = createSignal<string>("");
  const [yamlData, setYamlData] = createSignal<string>("");
  const [yamlHtml, setYamlHtml] = createSignal<string>("");
  const [events, setEvents] = createSignal<Event[]>([]);
  const [loading, setLoading] = createSignal<boolean>(true);
  const apiResourceStore = useApiResourceStore();
  
  let describeContentRef: HTMLPreElement | undefined;
  let yamlContentRef: HTMLPreElement | undefined;

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
  const getResourceName = (kind: string, apiVersion: string) => {
    // Find the matching API resource to get the correct plural form
    const apiResources = apiResourceStore.apiResources || [];
    const matchingResource = apiResources.find(resource => 
      resource.kind.toLowerCase() === kind.toLowerCase() && 
      (apiVersion.includes(resource.group || '') || (!resource.group && apiVersion === 'v1'))
    );
    
    // If we found a matching resource, use its name (which is the plural form)
    if (matchingResource) {
      return matchingResource.name;
    }
    
    // Fallback to adding 's' for plural if we can't find the resource
    // This is not ideal but maintains backward compatibility
    return `${kind.toLowerCase()}s`;
  };

  // Fetch the YAML data when the drawer opens
  const fetchYamlData = async () => {
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
      const resourceName = getResourceName(kind, apiVersion);
      
      const url = isNamespaced
        ? `${resourcePath}/namespaces/${namespace}/${resourceName}/${name}`
        : `${resourcePath}/${resourceName}/${name}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch resource: ${response.statusText}`);
      }
      
      const data = await response.json();
      const yamlText = stringify(data);
      setYamlData(yamlText);
      try {
        const { value } = hljs.highlight(yamlText, { language: "yaml" });
        setYamlHtml(value);
      } catch (_) {
        setYamlHtml("");
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
        fetchYamlData();
      } else if (activeTab() === "events") {
        fetchResourceEvents();
      }
    }
  });

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
                <Show when={yamlHtml()} fallback={<pre class="yaml-content" ref={yamlContentRef} tabIndex={0} style="outline: none;">{yamlData()}</pre>}>
                  <pre class="yaml-content" ref={yamlContentRef} tabIndex={0} style="outline: none;"><code class="hljs language-yaml" innerHTML={yamlHtml()!}></code></pre>
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
            
            <Show when={activeTab() === "exec"}>
              <TerminalViewer resource={props.resource} isOpen={props.isOpen && activeTab() === "exec"} />
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
} 