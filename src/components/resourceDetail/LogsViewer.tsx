import { createSignal, createEffect, Show, For, onCleanup } from "solid-js";

type LogHistoryOption = "5m" | "10m" | "60m" | "24h" | "all";

export function LogsViewer(props: {
  resource: any;
  isOpen: boolean;
}) {
  const [logs, setLogs] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);
  
  // State variables for logs
  const [availableContainers, setAvailableContainers] = createSignal<string[]>([]);
  const [selectedContainer, setSelectedContainer] = createSignal<string>("");
  const [logHistoryOption, setLogHistoryOption] = createSignal<LogHistoryOption>("10m");
  const [followLogs, setFollowLogs] = createSignal<boolean>(false);
  const [logsAutoRefresh, setLogsAutoRefresh] = createSignal<boolean>(false);
  const [availableInitContainers, setAvailableInitContainers] = createSignal<string[]>([]);
  
  let logsContentRef: HTMLPreElement | undefined;
  // Store a reference to control our polling mechanism
  let logsEventSource: { close: () => void } | null = null;

  // Extract containers and init containers from a pod resource
  const extractContainers = (resource: any) => {
    if (!resource || resource.kind !== "Pod") return { containers: [], initContainers: [] };
    
    const containers = (resource.spec?.containers || []).map((c: any) => c.name);
    const initContainers = (resource.spec?.initContainers || []).map((c: any) => c.name);
    
    return { containers, initContainers };
  };

  // Get containers from a deployment's pods
  const getDeploymentContainers = async (namespace: string, labelSelector: any) => {
    if (!labelSelector) return { containers: [], initContainers: [] };
    
    // Convert labels to string format for the API
    const selectorString = Object.entries(labelSelector)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    
    // Find pods for this deployment
    const podsUrl = `/k8s/api/v1/namespaces/${namespace}/pods?labelSelector=${selectorString}`;
    const podsResponse = await fetch(podsUrl);
    const podsData = await podsResponse.json();
    
    if (!podsData.items || podsData.items.length === 0) {
      return { containers: [], initContainers: [] };
    }
    
    // Use the first pod to identify containers
    return extractContainers(podsData.items[0]);
  };

  // Update available containers for log selection
  const updateAvailableContainers = async () => {
    if (!props.resource) return;
    
    const kind = props.resource.kind;
    const namespace = props.resource.metadata.namespace;
    
    if (!namespace) return;
    
    try {
      let containerInfo = { containers: [], initContainers: [] };
      
      if (kind === "Pod") {
        containerInfo = extractContainers(props.resource);
      } else if (kind === "Deployment") {
        const labelSelector = props.resource.spec?.selector?.matchLabels;
        containerInfo = await getDeploymentContainers(namespace, labelSelector);
      }
      
      setAvailableContainers(containerInfo.containers);
      setAvailableInitContainers(containerInfo.initContainers);
      
      // Select the first available container by default
      if (containerInfo.containers.length > 0) {
        setSelectedContainer(containerInfo.containers[0]);
      } else if (containerInfo.initContainers.length > 0) {
        setSelectedContainer(containerInfo.initContainers[0]);
      }
    } catch (error) {
      console.error("Error fetching container information:", error);
    }
  };

  // Convert log history option to sinceSeconds parameter
  const getLogSinceSeconds = (option: LogHistoryOption): number | undefined => {
    switch (option) {
      case "5m": return 5 * 60;
      case "10m": return 10 * 60;
      case "60m": return 60 * 60;
      case "24h": return 24 * 60 * 60;
      default: return undefined;
    }
  };

  // Fetch logs for the selected resource
  const fetchResourceLogs = async () => {
    if (!props.resource) return;
    
    // Close any existing EventSource
    if (logsEventSource) {
      logsEventSource.close();
      logsEventSource = null;
    }
    
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
      if (kind === "Pod" || kind === "Deployment") {
        let podName = name;
        const containerName = selectedContainer();
        
        // For deployments, we need to find a pod first
        if (kind === "Deployment") {
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
          
          // Use the first pod
          podName = podsData.items[0].metadata.name;
        }
        
        // Prepare query parameters
        const params = new URLSearchParams();
        
        // Add container name if selected
        if (containerName) {
          params.append('container', containerName);
        }
        
        // Add log history option
        const sinceSeconds = getLogSinceSeconds(logHistoryOption());
        if (sinceSeconds) {
          params.append('sinceSeconds', sinceSeconds.toString());
        }
        
        // Base URL for logs
        let logsUrl = `/k8s/api/v1/namespaces/${namespace}/pods/${podName}/log`;
        
        // Add parameters if any
        if (params.toString()) {
          logsUrl += `?${params.toString()}`;
        }
        
        // If following logs, set up streaming with fetch
        if (followLogs()) {
          // Add follow=true parameter
          logsUrl += logsUrl.includes('?') ? '&follow=true' : '?follow=true';
          
          setLogs("Connecting to log stream...");
          let logBuffer = "";
          
          // Use fetch with a reader to handle streaming response
          const abortController = new AbortController();
          
          const streamLogs = async () => {
            try {
              const response = await fetch(logsUrl, {
                headers: {
                  'Accept': 'application/json'
                },
                signal: abortController.signal
              });
              
              if (!response.ok) {
                throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
              }
              
              if (!response.body) {
                throw new Error("Response body is null");
              }
              
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const text = decoder.decode(value, { stream: true });
                logBuffer += text;
                setLogs(logBuffer);
                
                // Scroll to bottom of logs if auto-refresh is enabled
                if (logsAutoRefresh() && logsContentRef) {
                  logsContentRef.scrollTop = logsContentRef.scrollHeight;
                }
              }
            } catch (error) {
              // Only log error if it's not an AbortError (which is expected when stopping)
              if (!(error instanceof DOMException && error.name === 'AbortError')) {
                console.error("Error in log streaming:", error);
                setLogs((prev) => prev + "\n[Log streaming error: " + 
                  (error instanceof Error ? error.message : String(error)) + "]");
              }
            }
          };
          
          // Start streaming
          streamLogs();
          
          // Store cleanup function
          logsEventSource = {
            close: () => {
              abortController.abort();
            }
          };
        } else {
          // Regular non-streaming logs fetch
          const logsResponse = await fetch(logsUrl, {
            headers: {
              'Accept': 'application/json,'
            }
          });
          const logsText = await logsResponse.text();
          setLogs(logsText || "No logs available");
        }
      } else {
        setLogs("Logs are only available for Pod and Deployment resources");
      }
    } catch (error) {
      console.error("Error fetching resource logs:", error);
      setLogs(`Error fetching logs: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
      // Focus the logs content after loading
      setTimeout(() => logsContentRef?.focus(), 50);
    }
  };

  // Handle container selection change
  const handleContainerChange = (containerName: string) => {
    setSelectedContainer(containerName);
    
    // Refetch logs with new container
    if (!loading()) {
      fetchResourceLogs();
    }
  };

  // Handle log history option change
  const handleLogHistoryChange = (option: LogHistoryOption) => {
    setLogHistoryOption(option);
    
    // Refetch logs with new history option
    if (!loading()) {
      fetchResourceLogs();
    }
  };

  // Toggle follow logs mode
  const toggleFollowLogs = () => {
    const newFollowState = !followLogs();
    setFollowLogs(newFollowState);
    setLogsAutoRefresh(newFollowState);
    
    // If turning off follow mode, close the EventSource
    if (!newFollowState && logsEventSource) {
      logsEventSource.close();
      logsEventSource = null;
    }
    
    // Refetch logs with updated follow setting
    if (!loading()) {
      fetchResourceLogs();
    }
  };

  // Toggle auto-refresh for logs
  const toggleAutoRefresh = () => {
    setLogsAutoRefresh(!logsAutoRefresh());
  };

  // Load data when viewer becomes visible
  createEffect(() => {
    if (props.isOpen) {
      // When switching to logs tab, update available containers first
      updateAvailableContainers().then(() => {
        fetchResourceLogs();
      });
    }
  });

  // Clean up log stream when component unmounts
  onCleanup(() => {
    if (logsEventSource) {
      logsEventSource.close();
      logsEventSource = null;
    }
  });

  return (
    <Show when={props.isOpen}>
      <Show when={loading()}>
        <div class="drawer-loading">Loading...</div>
      </Show>
      
      <Show when={!loading()}>
        <div class="logs-controls">
          <div class="logs-options-row">
            <div>
              <label>Container:</label>
              <select 
                value={selectedContainer()} 
                onChange={(e) => handleContainerChange(e.target.value)}
                disabled={loading()}
                class="container-select"
              >
                <Show when={availableContainers().length === 0 && availableInitContainers().length === 0}>
                  <option value="">No containers available</option>
                </Show>
                
                <Show when={availableContainers().length > 0}>
                  <optgroup label="Containers">
                    <For each={availableContainers()}>
                      {(container) => (
                        <option value={container}>{container}</option>
                      )}
                    </For>
                  </optgroup>
                </Show>
                
                <Show when={availableInitContainers().length > 0}>
                  <optgroup label="Init Containers">
                    <For each={availableInitContainers()}>
                      {(container) => (
                        <option value={container}>{container}</option>
                      )}
                    </For>
                  </optgroup>
                </Show>
              </select>
            </div>

            <div>
              <label>History:</label>
              <select 
                value={logHistoryOption()} 
                onChange={(e) => handleLogHistoryChange(e.target.value as LogHistoryOption)}
                disabled={loading()}
              >
                <option value="5m">5 minutes</option>
                <option value="10m">10 minutes</option>
                <option value="60m">1 hour</option>
                <option value="24h">24 hours</option>
                <option value="all">All logs</option>
              </select>
            </div>

            <div class="logs-follow-controls">
              <label>
                <input 
                  type="checkbox" 
                  checked={followLogs()} 
                  onChange={toggleFollowLogs}
                  disabled={loading()}
                />
                Follow logs
              </label>
              <Show when={followLogs()}>
                <label>
                  <input 
                    type="checkbox" 
                    checked={logsAutoRefresh()} 
                    onChange={toggleAutoRefresh}
                  />
                  Auto-scroll
                </label>
              </Show>
            </div>
          </div>
        </div>

        <Show when={logs()} fallback={<div class="no-logs">No logs available</div>}>
          <pre class="logs-content" ref={logsContentRef} tabIndex={0} style="outline: none;">{logs()}</pre>
        </Show>
      </Show>
    </Show>
  );
} 