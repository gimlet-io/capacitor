import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { createStore } from "solid-js/store";

type LogHistoryOption = "5m" | "10m" | "60m" | "24h" | "all";
type LogEntry = { 
  timestamp: Date | null; 
  container: string; 
  line: string;
  rawTimestamp?: string; // Raw timestamp string from Kubernetes API
  parsedJson?: any; // Parsed JSON content if the log is valid JSON
};

function formatLogEntries(entries: LogEntry[]): string {
  return entries.map(entry => {
    const timestamp = formatTimestamp(entry.timestamp, entry.rawTimestamp);
    return `${timestamp} [${entry.container}] ${entry.line}`;
  }).join("\n");
}

function createContainerLogUrl(
  namespace: string, 
  podName: string, 
  container: string, 
  baseParams: URLSearchParams, 
  isFollow: boolean
): string {
  const containerParams = new URLSearchParams(baseParams);
  containerParams.append("container", container);
  
  // Request timestamps from Kubernetes API
  containerParams.append("timestamps", "true");
  
  if (isFollow) {
    containerParams.append("follow", "true");
  }
  
  return `/k8s/api/v1/namespaces/${namespace}/pods/${podName}/log?${containerParams.toString()}`;
}

export function LogsViewer(props: {
  resource: any;
  isOpen: boolean;
}) {
  const [logs, setLogs] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);
  const [containerColors, setContainerColors] = createStore<Record<string, string>>({});
  const [formattedLogEntries, setFormattedLogEntries] = createSignal<LogEntry[]>([]);
  const [processedEntries, setProcessedEntries] = createSignal<LogEntry[]>([]);

  const [availableContainers, setAvailableContainers] = createSignal<string[]>([]);
  const [selectedContainer, setSelectedContainer] = createSignal<string>("all");
  const [logHistoryOption, setLogHistoryOption] = createSignal<LogHistoryOption>("10m");
  const [followLogs, setFollowLogs] = createSignal<boolean>(false);
  const [logsAutoRefresh, setLogsAutoRefresh] = createSignal<boolean>(false);
  const [availableInitContainers, setAvailableInitContainers] = createSignal<string[]>([]);
  const [formatJsonLogs, setFormatJsonLogs] = createSignal<boolean>(false);
  const [jsonFilter, setJsonFilter] = createSignal<string>(".");
  const [wrapText, setWrapText] = createSignal<boolean>(true);

  let logsContentRef: HTMLPreElement | undefined;
  // Store a reference to control our polling mechanism
  let logsEventSource: { close: () => void } | null = null;

  // Extract containers and init containers from a pod resource
  const extractContainers = (resource: any) => {
    const containers = (resource.spec?.containers || []).map((c: any) =>
      c.name
    );
    const initContainers = (resource.spec?.initContainers || []).map((c: any) =>
      c.name
    );

    return { containers, initContainers };
  };

  // Get containers from a deployment's pods
  const getDeploymentContainers = async (
    namespace: string,
    labelSelector: any,
  ) => {
    if (!labelSelector) return { containers: [], initContainers: [] };

    // Convert labels to string format for the API
    const selectorString = Object.entries(labelSelector)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    // Find pods for this deployment
    const podsUrl =
      `/k8s/api/v1/namespaces/${namespace}/pods?labelSelector=${selectorString}`;
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

      // Keep the default "all" selection unless it was explicitly changed before
      if (selectedContainer() !== "all" && selectedContainer() === "") {
        // Only select a specific container if nothing is selected and "all" is not selected
        if (containerInfo.containers.length > 0) {
          setSelectedContainer(containerInfo.containers[0]);
        } else if (containerInfo.initContainers.length > 0) {
          setSelectedContainer(containerInfo.initContainers[0]);
        }
      }
    } catch (error) {
      console.error("Error fetching container information:", error);
    }
  };

  // Convert log history option to sinceSeconds parameter
  const getLogSinceSeconds = (option: LogHistoryOption): number | undefined => {
    switch (option) {
      case "5m":
        return 5 * 60;
      case "10m":
        return 10 * 60;
      case "60m":
        return 60 * 60;
      case "24h":
        return 24 * 60 * 60;
      default:
        return undefined;
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

      if (kind !== "Pod" && kind !== "Deployment") {
        setLogs("Logs are only available for Pod and Deployment resources");
        return;
      }

      let podName = name;
      // For deployments, we need to find a pod first
      if (kind === "Deployment") {
        podName = props.resource.pods[0].metadata.name;
      }

      const containerName = selectedContainer();

      // Prepare query parameters
      const params = new URLSearchParams();

      // Add container name if selected and not "all"
      if (containerName && containerName !== "all") {
        params.append("container", containerName);
      }

      // Add log history option
      const sinceSeconds = getLogSinceSeconds(logHistoryOption());
      if (sinceSeconds) {
        params.append("sinceSeconds", sinceSeconds.toString());
      }

      const containers = containerName === "all" ? [...availableContainers(), ...availableInitContainers()] : [containerName];
        
      // Update the logs display with sorted lines
      const updateLogsDisplay = (containerLogEntries: LogEntry[]) => {
        containerLogEntries = sortLogEntriesByTimestamp(containerLogEntries);
        setFormatJsonLogs(detectJsonLogs(containerLogEntries));
        
        // Store for HTML rendering
        setFormattedLogEntries(containerLogEntries);
        
        // Process entries with current formatting settings
        const processed = containerLogEntries.map(entry => 
          formatJsonLogs() ? processJsonLog(entry, formatJsonLogs(), jsonFilter()) : entry
        );
        setProcessedEntries(processed);
        
        // Plain text fallback
        const combinedLogs = formatLogEntries(containerLogEntries);
        setLogs(combinedLogs || "No logs available for any container");
        
        // Scroll to bottom if auto-refresh is enabled
        if (logsAutoRefresh() && logsContentRef) {
          logsContentRef.scrollTop = logsContentRef.scrollHeight;
        }
      };

      // For streaming multiple containers
      if (followLogs()) {
        // Set up streaming for multiple containers
        const abortController = new AbortController();
        let logBuffer = "Starting multiple container log streams...\n";
        setLogs(logBuffer);
        
        // Store container log lines with timestamps for sorting
        const containerLogEntries: LogEntry[] = [];
        // Keep track of active streams
        let activeStreams = containers.length;

        const streamContainerLogs = async (container: string) => {
          // Ensure container has an assigned color
          if (!containerColors[container]) {
            setContainerColors(container, getContainerColor(container));
          }
          
          try {
            // Create URL for this specific container
            const containerLogsUrl = createContainerLogUrl(
              namespace, 
              podName, 
              container, 
              params, 
              true
            );
            
            const response = await fetch(containerLogsUrl, {
              headers: {
                "Accept": "application/json",
              },
              signal: abortController.signal,
            });
            
            if (!response.ok) {
              logBuffer += `\n[Container ${container}: Error ${response.status} ${response.statusText}]\n`;
              setLogs(logBuffer);
              activeStreams--;
              return;
            }
            
            if (!response.body) {
              logBuffer += `\n[Container ${container}: No response body]\n`;
              setLogs(logBuffer);
              activeStreams--;
              return;
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let partialLine = "";
            
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // Process any remaining partial line
                if (partialLine) {
                  processLogLine(container, containerLogEntries, partialLine);
                  partialLine = "";
                }
                break;
              }
              
              const text = decoder.decode(value, { stream: true });
              const lines = (partialLine + text).split("\n");
              
              // Save the last partial line for the next chunk
              partialLine = lines.pop() || "";
              
              // Process complete lines
              for (const line of lines) {
                processLogLine(container, containerLogEntries, line);
              }
              
              updateLogsDisplay(containerLogEntries);
            }
            
            logBuffer += `\n[Container ${container}: Stream ended]\n`;
            setLogs(logBuffer);
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              logBuffer += `\n[Container ${container}: Error ${error instanceof Error ? error.message : String(error)}]\n`;
              setLogs(logBuffer);
            }
          } finally {
            activeStreams--;
            if (activeStreams === 0) {
              logBuffer += "\n[All container streams have ended]\n";
              setLogs(logBuffer);
            }
          }
        };
        
        // Start streaming for each container
        for (const container of containers) {
          streamContainerLogs(container);
        }
        
        // Store cleanup function
        logsEventSource = {
          close: () => {
            abortController.abort();
          },
        };
      } else { 
        const fetchAllLogs = async () => {
          const containerLogEntries: LogEntry[] = [];
          for (const container of containers) {
            try {
              const containerLogsUrl = createContainerLogUrl(
                namespace, 
                podName, 
                container, 
                params, 
                false
              );
              
              const response = await fetch(containerLogsUrl, {
                headers: {
                  "Accept": "application/json,",
                },
              });
              
              if (!response.ok) {
                containerLogEntries.push({
                  timestamp: new Date(),
                  container,
                  line: `[Error: ${response.status} ${response.statusText}]`
                });
                continue;
              }
              
              const containerLogs = await response.text();
              
              // Ensure container has an assigned color
              if (!containerColors[container]) {
                setContainerColors(container, getContainerColor(container));
              }
              
              if (!containerLogs.trim()) {
                containerLogEntries.push({
                  timestamp: new Date(),
                  container,
                  line: "[No logs available]"
                });
              } else {
                const lines = containerLogs.split("\n");
                for (const line of lines) {
                  processLogLine(container, containerLogEntries, line);
                }
              }
            } catch (error) {
              containerLogEntries.push({
                timestamp: new Date(),
                container,
                line: `[Error: ${error instanceof Error ? error.message : String(error)}]`
              });
            }
          }

          updateLogsDisplay(containerLogEntries);
        };
        fetchAllLogs();
      }
    } catch (error) {
      console.error("Error fetching resource logs:", error);
      setLogs(
        `Error fetching logs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
    if (newFollowState) {
      setLogsAutoRefresh(true);
    }

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

  const toggleWrapText = () => {
    setWrapText(!wrapText());
  };

  // Handle JSON formatting toggle
  const handleJsonFormattingToggle = () => {
    setFormatJsonLogs(!formatJsonLogs());
  };

  // Handle JSON filter change
  const handleJsonFilterChange = (filter: string) => {
    setJsonFilter(filter);
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

  // React to changes in JSON formatting settings
  createEffect(() => {
    // When formatting settings change, reprocess all entries
    const jsonFormatting = formatJsonLogs();
    const filter = jsonFilter();
    
    // Only reprocess if we have log entries
    if (formattedLogEntries().length > 0) {
      // Process all entries with current formatting settings
      const processed = formattedLogEntries().map(entry => 
        jsonFormatting ? processJsonLog(entry, jsonFormatting, filter) : entry
      );
      
      // Update the processed entries to trigger re-render
      setProcessedEntries(processed);
      
      // Update text logs as well
      const combinedLogs = formatLogEntries(processed);
      setLogs(combinedLogs || "No logs available for any container");
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
                <option value="all">All containers</option>

                <Show
                  when={availableContainers().length === 0 &&
                    availableInitContainers().length === 0}
                >
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
                onChange={(e) =>
                  handleLogHistoryChange(e.target.value as LogHistoryOption)}
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
              <label>
                <input
                  type="checkbox"
                  checked={logsAutoRefresh()}
                  onChange={toggleAutoRefresh}
                />
                Auto-scroll
              </label>
              <label title="Wrap log text to fit the container">
                <input
                  type="checkbox"
                  checked={wrapText()}
                  onChange={toggleWrapText}
                />
                Wrap text
              </label>
              <label title="Format log messages as JSON when possible">
                <input
                  type="checkbox"
                  checked={formatJsonLogs()}
                  onChange={handleJsonFormattingToggle}
                />
                Format JSON
              </label>
              <Show when={formatJsonLogs()}>
                <input
                  type="text"
                  value={jsonFilter()}
                  onInput={(e) => handleJsonFilterChange(e.target.value)}
                  placeholder="jq filter (e.g. .)"
                  title="Enter a jq-like filter (e.g. '.metadata.name')"
                  class="json-filter-input"
                />
              </Show>
            </div>
          </div>
        </div>

        <Show
          when={logs()}
          fallback={<div class="no-logs">No logs available</div>}
        >
          <pre
            class="logs-content"
            ref={logsContentRef}
            tabIndex={0}
            style="outline: none;"
          >
            <Show
              when={formattedLogEntries().length > 0}
              fallback={logs()}
            >
              <For each={processedEntries()}>
                {(entry) => (
                  <div class="log-line">
                    <span class="log-timestamp">
                      {formatTimestamp(entry.timestamp, entry.rawTimestamp)}
                    </span>
                    <span 
                      class="log-container"
                      style={`color: ${containerColors[entry.container] || "#fff"}`}
                    >
                      [{entry.container}]
                    </span>
                    <span class={`log-message ${entry.parsedJson ? "json-log" : ""} ${wrapText() ? "" : "nowrap"}`}>
                      {entry.line}
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </pre>
        </Show>
      </Show>
    </Show>
  );
}

// Process a log line, extract timestamp if possible and store it
const processLogLine = (
  container: string,
  containerLogLines: LogEntry[],
  line: string
) => {
  if (!line.trim()) return;
            
  // Split timestamp and log content
  // Kubernetes adds timestamps at the beginning when timestamps=true
  const timestampMatch = line.match(/^(\S+)\s+(.*)$/);
  
  let logEntry: LogEntry;
  
  if (timestampMatch) {
    const [_, rawTimestamp, logContent] = timestampMatch;

    logEntry = {
      timestamp: new Date(rawTimestamp),
      container,
      line: logContent,
      rawTimestamp
    };
  } else {
    logEntry = {
      timestamp: extractLogTimestamp(line),
      container,
      line
    };
  }
  
  // Try to detect and parse JSON in the log line
  try {
    // First, try to find JSON object or array in the log line
    const jsonMatch = logEntry.line.match(/(\{.*\}|\[.*\])/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];
      try {
        logEntry.parsedJson = JSON.parse(jsonStr);
      } catch (e) {
        // Not valid JSON in the matched pattern
      }
    }
    
    // If no JSON found in pattern match, try parsing the entire line
    if (!logEntry.parsedJson) {
      try {
        logEntry.parsedJson = JSON.parse(logEntry.line);
      } catch (e) {
        // Not valid JSON, continue without parsed content
      }
    }
  } catch (e) {
    // Error in JSON detection/parsing, continue
  }
  
  containerLogLines.push(logEntry);

  // Limit buffer size to prevent memory issues
  if (containerLogLines.length > 5000) {
    containerLogLines = containerLogLines.slice(-4000);
  }
};

function extractLogTimestamp(line: string): Date | null {
  if (!line.trim()) return null;
  
  // ISO timestamp: 2023-05-12T15:04:05.123Z
  const isoMatch = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/);
  if (isoMatch) {
    return new Date(isoMatch[0]);
  }
  
  // RFC3339 or similar: 2023/05/12 15:04:05
  const dateTimeMatch = line.match(/\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}/);
  if (dateTimeMatch) {
    return new Date(dateTimeMatch[0].replace(/[-/]/g, "-").replace(" ", "T"));
  }
  
  // Time only: 15:04:05
  const timeMatch = line.match(/\d{2}:\d{2}:\d{2}(\.\d+)?/);
  if (timeMatch) {
    const today = new Date();
    return new Date(today.toDateString() + " " + timeMatch[0]);
  }
  
  return null;
}

function sortLogEntriesByTimestamp(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
}

function formatTimestamp(timestamp: Date | null, rawTimestamp?: string): string {
  if (rawTimestamp) {
    try {
      const date = new Date(rawTimestamp);
      return date.toISOString().replace('T', ' ').substr(0, 23);
    } catch (e) {
      return rawTimestamp;
    }
  }
  
  if (!timestamp) return "";
  
  return timestamp.toISOString().replace('T', ' ').substr(0, 23);
}

function getContainerColor(container: string): string {
  const colors = [
    "#e6194B", "#3cb44b", "#ffe119", "#4363d8", 
    "#f58231", "#911eb4", "#42d4f4", "#f032e6", 
    "#bfef45", "#fabed4", "#469990", "#dcbeff", 
    "#9A6324", "#fffac8", "#800000", "#aaffc3", 
    "#808000", "#ffd8b1", "#000075", "#a9a9a9"
  ];
  
  // Simple hash function for container name
  let hash = 0;
  for (let i = 0; i < container.length; i++) {
    hash = ((hash << 5) - hash) + container.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Ensure positive index
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// Process a log entry for JSON formatting if needed
const processJsonLog = (entry: LogEntry, formatJsonLogs: boolean, jsonFilter: string): LogEntry => {
  // Create a new entry object to avoid mutating the original
  const processedEntry = { ...entry };
  
  // Check if JSON formatting is enabled
  if (!formatJsonLogs) return processedEntry;
  
  try {
    // Try to parse the log entry as JSON
    const jsonObject = processedEntry.parsedJson;
    
    // If not already parsed, try to parse it
    if (!jsonObject) {
      // Skip further processing if no JSON detected
      return processedEntry;
    }
    
    // Apply jq-like filter if we have a parsed JSON object
    const filter = jsonFilter;
    
    // Simple jq-like filter implementation
    // This is a basic implementation that only supports dot notation
    if (filter && filter !== ".") {
      const parts = filter.split('.').filter(p => p);
      let result = jsonObject;
      
      // Navigate the object using the filter path
      for (const part of parts) {
        if (result && typeof result === 'object' && part in result) {
          result = result[part];
        } else {
          // If path doesn't exist, return original entry
          return processedEntry;
        }
      }
      
      // Format the filtered result
      if (result !== null && result !== undefined) {
        processedEntry.line = typeof result === 'object' 
          ? JSON.stringify(result, null, 2) 
          : String(result);
      }
    } else {
      // Format the entire JSON object with indentation
      processedEntry.line = JSON.stringify(jsonObject, null, 2);
    }
    
    return processedEntry;
  } catch (e) {
    // Not valid JSON or filter error, return original entry
    return processedEntry;
  }
}

const detectJsonLogs = (entries: LogEntry[]): boolean => {
  if (entries.length === 0) return false;
  
  // Check a sample of log entries (first 5) to see if they're JSON
  const sampleSize = Math.min(5, entries.length);
  let jsonCount = 0;
  
  for (let i = 0; i < sampleSize; i++) {
    const entry = entries[i];
    // If the entry already has parsed JSON, count it
    if (entry.parsedJson) {
      jsonCount++;
    }
  }
  
  // If most of the sample entries are JSON, auto-enable JSON formatting
  return jsonCount >= Math.ceil(sampleSize / 2);
};
