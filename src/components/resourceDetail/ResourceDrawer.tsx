// deno-lint-ignore-file jsx-button-has-type
import { createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import { EventList } from "../EventList.tsx";
import type { Event } from "../../types/k8s.ts";
import { describeResource } from "../../utils/kubectlDescriber.ts";

type DrawerTab = "describe" | "yaml" | "events" | "logs";

export function ResourceDrawer(props: {
  resource: any;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: DrawerTab;
}) {
  const [activeTab, setActiveTab] = createSignal<DrawerTab>(props.initialTab || "describe");
  const [describeData, setDescribeData] = createSignal<string>("");
  const [yamlData, setYamlData] = createSignal<string>("");
  const [events, setEvents] = createSignal<Event[]>([]);
  const [logs, setLogs] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);

  // Fetch the describe data when the drawer opens
  const fetchDescribeData = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const kind = props.resource.kind || "unknown";
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      const apiVersion = props.resource.apiVersion || "";
      
      // Use kubectl proxy to get the resource
      const isNamespaced = namespace && namespace !== '';
      const resourcePath = apiVersion.includes('/') 
        ? `/k8s/apis/${apiVersion}` 
        : `/k8s/api/${apiVersion || 'v1'}`;
      
      const url = isNamespaced
        ? `${resourcePath}/namespaces/${namespace}/${kind.toLowerCase()}s/${name}`
        : `${resourcePath}/${kind.toLowerCase()}s/${name}`;
      
      // First get the resource to make sure it exists
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch resource: ${response.statusText}`);
      }
      
      // Format the resource using the kubectl-like formatter from the utility
      const resourceData = await response.json();
      const describeCmd = `kubectl describe ${kind.toLowerCase()} ${name}${isNamespaced ? ` -n ${namespace}` : ''}`;
      const formattedOutput = describeResource(resourceData);
      setDescribeData(`Command: ${describeCmd}\n\n${formattedOutput}`);
    } catch (error) {
      console.error("Error fetching describe data:", error);
      setDescribeData(`Error fetching describe data: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch the YAML data when the drawer opens
  const fetchYamlData = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const kind = props.resource.kind || "unknown";
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      const apiVersion = props.resource.apiVersion || "";
      
      // Use kubectl proxy to get the resource
      const isNamespaced = namespace && namespace !== '';
      const resourcePath = apiVersion.includes('/') 
        ? `/k8s/apis/${apiVersion}` 
        : `/k8s/api/${apiVersion || 'v1'}`;
      
      const url = isNamespaced
        ? `${resourcePath}/namespaces/${namespace}/${kind.toLowerCase()}s/${name}`
        : `${resourcePath}/${kind.toLowerCase()}s/${name}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch resource: ${response.statusText}`);
      }
      
      const data = await response.json();
      setYamlData(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error fetching YAML data:", error);
      setYamlData(`Error fetching YAML data: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch events for the selected resource
  const fetchResourceEvents = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const kind = props.resource.kind;
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      
      // Fetch events using the field selector
      const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
      const eventsUrl = namespace 
        ? `/k8s/api/v1/namespaces/${namespace}/events?fieldSelector=${fieldSelector}`
        : `/k8s/api/v1/events?fieldSelector=${fieldSelector}`;
      
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

  // Fetch logs for the selected resource
  const fetchResourceLogs = async () => {
    if (!props.resource) return;
    
    setLoading(true);
    try {
      const kind = props.resource.kind;
      const name = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      
      if (!namespace) {
        setLogs("Namespace is required to fetch logs");
        return;
      }
      
      // Only fetch logs for Pods or Deployments
      if (kind === "Pod") {
        // Directly fetch logs for the pod
        const logsUrl = `/k8s/api/v1/namespaces/${namespace}/pods/${name}/log`;
        const response = await fetch(logsUrl);
        const logsText = await response.text();
        setLogs(logsText);
      } else if (kind === "Deployment") {
        // For deployments, we need to find a pod first
        const labelSelector = props.resource.spec?.selector?.matchLabels;
        if (!labelSelector) {
          setLogs("No label selector found for this deployment");
          return;
        }
        
        // Convert labels to string format for the API
        const selectorString = Object.entries(labelSelector)
          .map(([key, value]) => `${key}=${value}`)
          .join(',');
        
        // Find pods for this deployment
        const podsUrl = `/k8s/api/v1/namespaces/${namespace}/pods?labelSelector=${selectorString}`;
        const podsResponse = await fetch(podsUrl);
        const podsData = await podsResponse.json();
        
        if (!podsData.items || podsData.items.length === 0) {
          setLogs("No pods found for this deployment");
          return;
        }
        
        // Get logs from the first pod
        const pod = podsData.items[0];
        const logsUrl = `/k8s/api/v1/namespaces/${namespace}/pods/${pod.metadata.name}/log`;
        const logsResponse = await fetch(logsUrl);
        const logsText = await logsResponse.text();
        setLogs(logsText);
      } else {
        setLogs("Logs are only available for Pod and Deployment resources");
      }
    } catch (error) {
      console.error("Error fetching resource logs:", error);
      setLogs(`Error fetching logs: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Load data when the drawer opens or the active tab changes
  createEffect(() => {
    if (props.isOpen) {
      if (activeTab() === "describe") {
        fetchDescribeData();
      } else if (activeTab() === "yaml") {
        fetchYamlData();
      } else if (activeTab() === "events") {
        fetchResourceEvents();
      } else if (activeTab() === "logs") {
        fetchResourceLogs();
      }
    }
  });

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen) return;
    
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  // Clean up event listener
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
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
          
          <div class="drawer-tabs">
            <button 
              class={`drawer-tab ${activeTab() === "describe" ? "active" : ""}`}
              onClick={() => setActiveTab("describe")}
            >
              Describe
            </button>
            <button 
              class={`drawer-tab ${activeTab() === "yaml" ? "active" : ""}`}
              onClick={() => setActiveTab("yaml")}
            >
              YAML
            </button>
            <button 
              class={`drawer-tab ${activeTab() === "events" ? "active" : ""}`}
              onClick={() => setActiveTab("events")}
            >
              Events
            </button>
            <Show when={props.resource?.kind === "Pod" || props.resource?.kind === "Deployment"}>
              <button 
                class={`drawer-tab ${activeTab() === "logs" ? "active" : ""}`}
                onClick={() => setActiveTab("logs")}
              >
                Logs
              </button>
            </Show>
          </div>
          
          <div class="drawer-content">
            <Show when={loading()}>
              <div class="drawer-loading">Loading...</div>
            </Show>
            
            <Show when={activeTab() === "describe" && !loading()}>
              <pre class="describe-content">{describeData()}</pre>
            </Show>
            
            <Show when={activeTab() === "yaml" && !loading()}>
              <pre class="yaml-content">{yamlData()}</pre>
            </Show>
            
            <Show when={activeTab() === "events" && !loading()}>
              <Show when={events().length > 0} fallback={<div class="no-events">No events found</div>}>
                <EventList events={events()} />
              </Show>
            </Show>
            
            <Show when={activeTab() === "logs" && !loading()}>
              <Show when={logs()} fallback={<div class="no-logs">No logs available</div>}>
                <pre class="logs-content">{logs()}</pre>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
} 