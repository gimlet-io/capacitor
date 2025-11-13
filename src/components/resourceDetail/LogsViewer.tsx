// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { createStore } from "solid-js/store";

type LogHistoryOption = "5m" | "10m" | "60m" | "24h" | "all" | "previous";
type LogEntry = { 
  timestamp: Date | null; 
  container: string; 
  pod?: string; // Add pod name to log entries
  line: string;
  rawTimestamp?: string; // Raw timestamp string from Kubernetes API
  parsedJson?: any; // Parsed JSON content if the log is valid JSON
};

function formatLogEntries(entries: LogEntry[], showPods: boolean = false): string {
  return entries.map(entry => {
    const timestamp = formatTimestamp(entry.timestamp, entry.rawTimestamp);
    const podContainer = (showPods && entry.pod) ? `[${entry.pod}/${entry.container}]` : `[${entry.container}]`;
    return `${timestamp} ${podContainer} ${entry.line}`;
  }).join("\n");
}

function createContainerLogUrl(
  namespace: string, 
  podName: string, 
  container: string, 
  baseParams: URLSearchParams, 
  isFollow: boolean,
  isPrevious: boolean = false,
  k8sPrefix?: string
): string {
  const containerParams = new URLSearchParams(baseParams);
  containerParams.append("container", container);
  
  // Request timestamps from Kubernetes API
  containerParams.append("timestamps", "true");
  
  if (isFollow) {
    containerParams.append("follow", "true");
  }
  
  if (isPrevious) {
    containerParams.append("previous", "true");
  }
  
  const base = k8sPrefix || '/k8s';
  return `${base}/api/v1/namespaces/${namespace}/pods/${podName}/log?${containerParams.toString()}`;
}

export function LogsViewer(props: {
  resource: any;
  isOpen: boolean;
}) {
  const apiResourceStore = useApiResourceStore();
  const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
  const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
  const [logs, setLogs] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);
  const [containerColors, setContainerColors] = createStore<Record<string, string>>({});
  const [formattedLogEntries, setFormattedLogEntries] = createSignal<LogEntry[]>([]);
  const [processedEntries, setProcessedEntries] = createSignal<LogEntry[]>([]);

  const [availableContainers, setAvailableContainers] = createSignal<string[]>([]);
  const [selectedContainer, setSelectedContainer] = createSignal<string>("all");
  const [availablePods, setAvailablePods] = createSignal<string[]>([]);
  const [selectedPod, setSelectedPod] = createSignal<string>("all");
  const [logHistoryOption, setLogHistoryOption] = createSignal<LogHistoryOption>("10m");
  const [followLogs, setFollowLogs] = createSignal<boolean>(true);
  const [logsAutoRefresh, setLogsAutoRefresh] = createSignal<boolean>(true);
  const [availableInitContainers, setAvailableInitContainers] = createSignal<string[]>([]);
  const [formatJsonLogs, setFormatJsonLogs] = createSignal<boolean>(false);
  const [jsonFilter, setJsonFilter] = createSignal<string>(".");
  const [wrapText, setWrapText] = createSignal<boolean>(true);
  const [showMetadata, setShowMetadata] = createSignal<boolean>(true);
  const [showPodNames, setShowPodNames] = createSignal<boolean>(false);
  const [jsonFormatUserOverride, setJsonFormatUserOverride] = createSignal<boolean>(false);
  const [sinceTimeOverride, setSinceTimeOverride] = createSignal<string | null>(null);
  
  // Search functionality
  const [searchQuery, setSearchQuery] = createSignal<string>("");
  const [currentMatchIndex, setCurrentMatchIndex] = createSignal<number>(-1);
  const [searchMatches, setSearchMatches] = createSignal<Array<{entryIndex: number, matchStart: number, matchEnd: number}>>([]);
  const [searchFocused, setSearchFocused] = createSignal<boolean>(false);
  const [searchExpanded, setSearchExpanded] = createSignal<boolean>(false);
  const [searchMode, setSearchMode] = createSignal<"text" | "regex" | "case-sensitive">("text");

  let logsContentRef: HTMLPreElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
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

  // Get containers from pods managed by a resource (Deployment, StatefulSet, DaemonSet, Job)
  const getResourcePodContainers = async (
    namespace: string,
    labelSelector: any,
  ): Promise<{ containers: string[], initContainers: string[], pods: string[] }> => {
    if (!labelSelector) return { containers: [], initContainers: [], pods: [] };

    // Convert labels to string format for the API
    const selectorString = Object.entries(labelSelector)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    // Find pods for this deployment
    const podsUrl =
      `${k8sPrefix}/api/v1/namespaces/${namespace}/pods?labelSelector=${selectorString}`;
    const podsResponse = await fetch(podsUrl);
    const podsData = await podsResponse.json();

    if (!podsData.items || podsData.items.length === 0) {
      return { containers: [], initContainers: [], pods: [] };
    }

    // Get all unique containers from all pods
    const allContainers = new Set<string>();
    const allInitContainers = new Set<string>();
    const pods: string[] = podsData.items.map((pod: any) => pod.metadata.name);

    podsData.items.forEach((pod: any) => {
      const { containers, initContainers } = extractContainers(pod);
      containers.forEach((c: string) => allContainers.add(c));
      initContainers.forEach((c: string) => allInitContainers.add(c));
    });

    return { 
      containers: Array.from(allContainers), 
      initContainers: Array.from(allInitContainers),
      pods
    };
  };

  // Update available containers and pods for log selection
  const updateAvailableContainers = async () => {
    if (!props.resource) return;

    const kind = props.resource.kind;
    const namespace = props.resource.metadata.namespace;

    if (!namespace) return;

    try {
      let containerInfo: { containers: string[], initContainers: string[], pods: string[] } = { 
        containers: [], 
        initContainers: [], 
        pods: [] 
      };

      if (kind === "Pod") {
        const extractedContainers = extractContainers(props.resource);
        containerInfo = { 
          containers: extractedContainers.containers,
          initContainers: extractedContainers.initContainers,
          pods: [props.resource.metadata.name] 
        };
      } else if (["Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"].includes(kind)) {
        const labelSelector = props.resource.spec?.selector?.matchLabels;
        containerInfo = await getResourcePodContainers(namespace, labelSelector);
      }

      setAvailableContainers(containerInfo.containers);
      setAvailableInitContainers(containerInfo.initContainers);
      setAvailablePods(containerInfo.pods);

      // Keep the default "all" selection unless it was explicitly changed before
      if (selectedContainer() !== "all" && selectedContainer() === "") {
        // Only select a specific container if nothing is selected and "all" is not selected
        if (containerInfo.containers.length > 0) {
          setSelectedContainer(containerInfo.containers[0]);
        } else if (containerInfo.initContainers.length > 0) {
          setSelectedContainer(containerInfo.initContainers[0]);
        }
      }

      // Reset pod selection to "all" when switching resources
      if (selectedPod() !== "all" && selectedPod() === "") {
        setSelectedPod("all");
      }
      
      // Set showPodNames based on whether there are multiple pods and if they're selectable
      setShowPodNames(containerInfo.pods.length > 1);
      
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
      case "previous":
      case "all":
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

      if (!["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"].includes(kind)) {
        setLogs("Logs are only available for Pod, Deployment, StatefulSet, DaemonSet, Job, and ReplicaSet resources");
        return;
      }

      // Determine which pods to fetch logs from
      let podsToFetch: string[] = [];
      if (kind === "Pod") {
        podsToFetch = [name];
      } else if (["Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"].includes(kind)) {
        if (selectedPod() === "all") {
          podsToFetch = availablePods();
        } else {
          podsToFetch = [selectedPod()];
        }
      }

      const containerName = selectedContainer();

      // Prepare query parameters
      const params = new URLSearchParams();

      // Add log history option or sinceTime override
      const sinceOverride = sinceTimeOverride();
      if (sinceOverride) {
        params.append("sinceTime", new Date(sinceOverride).toISOString());
      } else {
        const sinceSeconds = getLogSinceSeconds(logHistoryOption());
        if (sinceSeconds) {
          params.append("sinceSeconds", sinceSeconds.toString());
        }
      }

      const containers = containerName === "all" ? [...availableContainers(), ...availableInitContainers()] : [containerName];
      const usePrevious = sinceTimeOverride() ? false : logHistoryOption() === "previous";
        
      // Update the logs display with sorted lines
      const updateLogsDisplay = (containerLogEntries: LogEntry[]) => {
        containerLogEntries = sortLogEntriesByTimestamp(containerLogEntries);
        if (!jsonFormatUserOverride()) {
          setFormatJsonLogs(detectJsonLogs(containerLogEntries));
        }
        
        // Store for HTML rendering
        setFormattedLogEntries(containerLogEntries);
        
        // Process entries with current formatting settings
        const processed = containerLogEntries.map(entry => 
          formatJsonLogs() ? processJsonLog(entry, formatJsonLogs(), jsonFilter()) : entry
        );
        setProcessedEntries(processed);
        
        // Plain text fallback
        const combinedLogs = formatLogEntries(containerLogEntries, showPodNames());
        setLogs(combinedLogs || "No logs available for any container");
        
        // Scroll to bottom if auto-refresh is enabled
        if (logsAutoRefresh() && logsContentRef) {
          logsContentRef.scrollTop = logsContentRef.scrollHeight;
        }
      };

      // For streaming multiple containers and pods
      if (followLogs()) {
        // Set up streaming for multiple containers across multiple pods
        const abortController = new AbortController();
        let logBuffer = "Starting log streams...\n";
        setLogs(logBuffer);
        
        // Store container log lines with timestamps for sorting
        const containerLogEntries: LogEntry[] = [];
        // Keep track of active streams
        let activeStreams = podsToFetch.length * containers.length;

        const streamPodContainerLogs = async (podName: string, container: string) => {
          // Ensure pod-container combination has an assigned color
          const colorKey = `${podName}/${container}`;
          if (!containerColors[colorKey]) {
            setContainerColors(colorKey, getPodContainerColor(podName, container));
          }
          
          try {
            // Create URL for this specific pod-container combination
            const containerLogsUrl = createContainerLogUrl(
              namespace, 
              podName, 
              container, 
              params, 
              true,
              usePrevious,
              k8sPrefix
            );
            
            const response = await fetch(containerLogsUrl, {
              headers: {
                "Accept": "application/json",
              },
              signal: abortController.signal,
            });
            
            if (!response.ok) {
              logBuffer += `\n[Pod ${podName}/Container ${container}: Error ${response.status} ${response.statusText}]\n`;
              setLogs(logBuffer);
              activeStreams--;
              return;
            }
            
            if (!response.body) {
              logBuffer += `\n[Pod ${podName}/Container ${container}: No response body]\n`;
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
                  processLogLine(container, containerLogEntries, partialLine, podName);
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
                processLogLine(container, containerLogEntries, line, podName);
              }
              
              updateLogsDisplay(containerLogEntries);
            }
            
            logBuffer += `\n[Pod ${podName}/Container ${container}: Stream ended]\n`;
            setLogs(logBuffer);
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              logBuffer += `\n[Pod ${podName}/Container ${container}: Error ${error instanceof Error ? error.message : String(error)}]\n`;
              setLogs(logBuffer);
            }
          } finally {
            activeStreams--;
            if (activeStreams === 0) {
              logBuffer += "\n[All log streams have ended]\n";
              setLogs(logBuffer);
            }
          }
        };
        
        // Start streaming for each pod-container combination
        for (const podName of podsToFetch) {
          for (const container of containers) {
            streamPodContainerLogs(podName, container);
          }
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
          for (const podName of podsToFetch) {
            for (const container of containers) {
              try {
                const containerLogsUrl = createContainerLogUrl(
                  namespace, 
                  podName, 
                  container, 
                  params, 
                  false,
                  usePrevious,
                  k8sPrefix
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
                    pod: podName,
                    line: `[Error: ${response.status} ${response.statusText}]`
                  });
                  continue;
                }
                
                const containerLogs = await response.text();
                
                // Ensure pod-container combination has an assigned color
                const colorKey = `${podName}/${container}`;
                if (!containerColors[colorKey]) {
                  setContainerColors(colorKey, getPodContainerColor(podName, container));
                }
                
                if (!containerLogs.trim()) {
                  containerLogEntries.push({
                    timestamp: new Date(),
                    container,
                    pod: podName,
                    line: "[No logs available]"
                  });
                } else {
                  const lines = containerLogs.split("\n");
                  for (const line of lines) {
                    processLogLine(container, containerLogEntries, line, podName);
                  }
                }
              } catch (error) {
                containerLogEntries.push({
                  timestamp: new Date(),
                  container,
                  pod: podName,
                  line: `[Error: ${error instanceof Error ? error.message : String(error)}]`
                });
              }
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

  // Handle pod selection change
  const handlePodChange = (podName: string) => {
    setSelectedPod(podName);

    // Refetch logs with new pod selection
    if (!loading()) {
      fetchResourceLogs();
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

    // Previous logs cannot be followed, so disable follow mode if enabled
    if (option === "previous" && followLogs()) {
      setFollowLogs(false);
    }

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
    setJsonFormatUserOverride(true);
    setFormatJsonLogs(!formatJsonLogs());
  };

  // Handle JSON filter change
  const handleJsonFilterChange = (filter: string) => {
    setJsonFilter(filter);
  };

  const toggleShowMetadata = () => {
    setShowMetadata(!showMetadata());
  };

  // Clear logs and restart streaming from current timestamp
  const clearLogs = () => {
    if (logsEventSource) {
      logsEventSource.close();
      logsEventSource = null;
    }
    setLogs("");
    setFormattedLogEntries([]);
    setProcessedEntries([]);
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
    setSinceTimeOverride(new Date().toISOString());
    if (!followLogs()) {
      setFollowLogs(true);
    }
    if (!loading()) {
      fetchResourceLogs();
    } else {
      setTimeout(() => fetchResourceLogs(), 0);
    }
  };



  // Search functionality
  const performSearch = () => {
    const query = searchQuery().trim();
    if (!query) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const entries = processedEntries();
    const matches: Array<{entryIndex: number, matchStart: number, matchEnd: number}> = [];
    
    try {
      let searchRegex: RegExp;
      const mode = searchMode();
      
      if (mode === "regex") {
        // Use raw regex pattern
        searchRegex = new RegExp(query, "gi");
      } else {
        // Escape special regex characters for text search
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use case sensitive flag if in case-sensitive mode
        const flags = mode === "case-sensitive" ? "g" : "gi";
        searchRegex = new RegExp(escapedQuery, flags);
      }

      entries.forEach((entry, entryIndex) => {
        const text = entry.line;
        let match;
        
        // Reset regex lastIndex for global search
        searchRegex.lastIndex = 0;
        
        while ((match = searchRegex.exec(text)) !== null) {
          matches.push({
            entryIndex,
            matchStart: match.index,
            matchEnd: match.index + match[0].length
          });
          
          // Prevent infinite loop on zero-length matches
          if (match[0].length === 0) {
            searchRegex.lastIndex++;
          }
        }
      });
      
      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
      
      // Scroll to first match if found
      if (matches.length > 0) {
        scrollToMatch(0);
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
    }
  };

  const navigateToNextMatch = () => {
    const matches = searchMatches();
    if (matches.length === 0) return;
    
    const newIndex = (currentMatchIndex() + 1) % matches.length;
    setCurrentMatchIndex(newIndex);
    scrollToMatch(newIndex);
  };

  const navigateToPreviousMatch = () => {
    const matches = searchMatches();
    if (matches.length === 0) return;
    
    const newIndex = currentMatchIndex() <= 0 ? matches.length - 1 : currentMatchIndex() - 1;
    setCurrentMatchIndex(newIndex);
    scrollToMatch(newIndex);
  };

  const scrollToMatch = (matchIndex: number) => {
    const matches = searchMatches();
    if (matchIndex < 0 || matchIndex >= matches.length || !logsContentRef) return;
    
    const match = matches[matchIndex];
    const logLines = logsContentRef.querySelectorAll('.log-line');
    const targetLine = logLines[match.entryIndex];
    
    if (targetLine) {
      targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  };

  const toggleSearch = () => {
    const newExpanded = !searchExpanded();
    setSearchExpanded(newExpanded);
    if (newExpanded) {
      // Focus search input after a brief delay to ensure it's rendered
      setTimeout(() => searchInputRef?.focus(), 50);
    }
  };

  const openSearchAndFocus = () => {
    setSearchExpanded(true);
    setTimeout(() => searchInputRef?.focus(), 50);
  };

  const highlightMatches = (text: string, entryIndex: number): string => {
    const query = searchQuery().trim();
    if (!query || searchMatches().length === 0) {
      return text;
    }

    const matches = searchMatches().filter(m => m.entryIndex === entryIndex);
    if (matches.length === 0) {
      return text;
    }

    // Sort matches by start position in reverse order to avoid offset issues
    const sortedMatches = [...matches].sort((a, b) => b.matchStart - a.matchStart);
    
    let result = text;
    sortedMatches.forEach((match, index) => {
      const isCurrentMatch = searchMatches().findIndex(m => 
        m.entryIndex === match.entryIndex && 
        m.matchStart === match.matchStart && 
        m.matchEnd === match.matchEnd
      ) === currentMatchIndex();
      
      const beforeMatch = result.substring(0, match.matchStart);
      const matchText = result.substring(match.matchStart, match.matchEnd);
      const afterMatch = result.substring(match.matchEnd);
      
      const highlightClass = isCurrentMatch ? 'search-match-current' : 'search-match';
      result = beforeMatch + `<span class="${highlightClass}">${matchText}</span>` + afterMatch;
    });

    return result;
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
      const combinedLogs = formatLogEntries(processed, showPodNames());
      setLogs(combinedLogs || "No logs available for any container");
    }
  });

  // Perform search when query or mode changes
  createEffect(() => {
    const query = searchQuery();
    const mode = searchMode();
    // Only perform search if we have processed entries
    if (processedEntries().length > 0) {
      performSearch();
    }
  });

  // Keyboard event handler for VIM-style navigation
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!props.isOpen) return;

    // Don't handle shortcuts if search input is focused or any input is focused
    if (searchFocused() || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
      // Only handle Enter and Escape when search is focused
      if (searchFocused()) {
        if (event.key === 'Escape') {
          searchInputRef?.blur();
          setSearchFocused(false);
          event.preventDefault();
          event.stopPropagation();
        } else if (event.key === 'Enter') {
          if (event.shiftKey) {
            navigateToPreviousMatch();
          } else {
            navigateToNextMatch();
          }
          event.preventDefault();
          event.stopPropagation();
        }
      }
      return;
    }

    // Global keyboard shortcuts (only when logs tab is active and no input is focused)
    if (event.key === '/') {
      openSearchAndFocus();
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'n' && !event.shiftKey) {
      navigateToNextMatch();
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'N' || (event.key === 'n' && event.shiftKey)) {
      navigateToPreviousMatch();
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // Add keyboard event listener when logs tab is active
  createEffect(() => {
    if (props.isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
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
      <div class="logs-viewer-container">
        <Show when={loading()}>
          <div class="drawer-loading">Loading...</div>
        </Show>

        <Show when={!loading()}>
        <div class="logs-controls">
          <div class="logs-options-row">
            <div class="logs-filter-group">
              <Show when={["Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"].includes(props.resource?.kind) && availablePods().length > 0}>
                <div class="logs-select-container">
                  <label>Pod:</label>
                  <select
                    value={selectedPod()}
                    onChange={(e) => handlePodChange(e.target.value)}
                    disabled={loading()}
                    class="pod-select"
                    title={selectedPod() === "all" ? "All pods" : selectedPod()}
                  >
                    <option value="all">All pods</option>
                    <For each={availablePods()}>
                      {(pod) => (
                        <option value={pod} title={pod}>{pod}</option>
                      )}
                    </For>
                  </select>
                </div>
              </Show>

              <div class="logs-select-container">
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

              <div class="logs-select-container">
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
                  <option value="previous">Previous logs</option>
                </select>
              </div>
            </div>

            <div class="logs-follow-controls">
              <label title="Stream logs in real-time">
                <input
                  type="checkbox"
                  checked={followLogs()}
                  onChange={toggleFollowLogs}
                  disabled={loading()}
                />
                <span>Follow</span>
              </label>
              <label title="Auto-scroll to bottom of logs">
                <input
                  type="checkbox"
                  checked={logsAutoRefresh()}
                  onChange={toggleAutoRefresh}
                />
                <span>Auto-scroll</span>
              </label>
              <label title="Wrap log text to fit the container">
                <input
                  type="checkbox"
                  checked={wrapText()}
                  onChange={toggleWrapText}
                />
                <span>Wrap</span>
              </label>
              <label title="Show timestamp and container columns">
                <input
                  type="checkbox"
                  checked={showMetadata()}
                  onChange={toggleShowMetadata}
                />
                <span>Metadata</span>
              </label>
              <label title="Format log messages as JSON when possible">
                <input
                  type="checkbox"
                  checked={formatJsonLogs()}
                  onChange={handleJsonFormattingToggle}
                />
                <span>JSON</span>
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
              <button
                class="clear-logs-button"
                onClick={clearLogs}
                title="Clear logs and stream from current time"
              >
                Clear
              </button>
              <button
                class="search-toggle-button"
                onClick={toggleSearch}
                title="Toggle search (/ to open and focus)"
              >
                Search
              </button>
            </div>
          </div>
          
          <Show when={searchExpanded()}>
            <div class="logs-search-row">
              <div class="logs-search-container">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder="Search logs... (/ to focus, Esc to clear)"
                  class="logs-search-input"
                />
                <div class="search-controls">
                  <button
                    class={`search-type-button ${searchMode() === "text" ? "active" : ""}`}
                    onClick={() => setSearchMode("text")}
                    title="Text search (case insensitive)"
                  >
                    Text
                  </button>
                  <button
                    class={`search-type-button ${searchMode() === "case-sensitive" ? "active" : ""}`}
                    onClick={() => setSearchMode("case-sensitive")}
                    title="Case sensitive text search"
                  >
                    Aa
                  </button>
                  <button
                    class={`search-type-button ${searchMode() === "regex" ? "active" : ""}`}
                    onClick={() => setSearchMode("regex")}
                    title="Regular expression search"
                  >
                    .*
                  </button>
                </div>
                <div class="search-navigation">
                  <Show when={searchMatches().length > 0}>
                    <span class="search-results">
                      {currentMatchIndex() + 1} of {searchMatches().length}
                    </span>
                  </Show>
                  <button
                    class="search-nav-button"
                    onClick={navigateToPreviousMatch}
                    disabled={searchMatches().length === 0}
                    title="Previous match (Shift+N)"
                  >
                    ↑
                  </button>
                  <button
                    class="search-nav-button"
                    onClick={navigateToNextMatch}
                    disabled={searchMatches().length === 0}
                    title="Next match (n)"
                  >
                    ↓
                  </button>
                  <button
                    class="search-clear-button"
                    onClick={clearSearch}
                    title="Clear search"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </Show>
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
                    <Show when={showMetadata()}>
                      <span class="log-timestamp">
                        {formatTimestamp(entry.timestamp, entry.rawTimestamp)}
                      </span>
                      <span 
                        class="log-container"
                        style={`color: ${containerColors[entry.pod ? `${entry.pod}/${entry.container}` : entry.container] || "#fff"}`}
                      >
                        {showPodNames() && entry.pod ? `[${entry.pod}/${entry.container}]` : `[${entry.container}]`}
                      </span>
                    </Show>
                    <span 
                      class={`log-message ${entry.parsedJson ? "json-log" : ""} ${wrapText() ? "" : "nowrap"}`}
                      tabIndex={0}
                      innerHTML={highlightMatches(entry.line, processedEntries().indexOf(entry))}
                    ></span>
                  </div>
                )}
              </For>
            </Show>
          </pre>
        </Show>
      </Show>
      </div>
    </Show>
  );
}

// Process a log line, extract timestamp if possible and store it
const processLogLine = (
  container: string,
  containerLogLines: LogEntry[],
  line: string,
  pod?: string
) => {
  if (!line.trim()) return;
            
  // Split timestamp and log content
  // Kubernetes adds timestamps at the beginning when timestamps=true
  const timestampMatch = line.match(/^(\S+)\s(.*)$/);
  let logEntry: LogEntry;

  if (timestampMatch) {
    const [_, rawTimestamp, logContent] = timestampMatch;

    logEntry = {
      timestamp: new Date(rawTimestamp),
      container,
      pod,
      line: logContent,
      rawTimestamp
    };
  } else {
    logEntry = {
      timestamp: extractLogTimestamp(line),
      container,
      pod,
      line
    };
  }
  
  // Try to detect and parse JSON in the log line
  try {
    // Only treat as JSON if the entire trimmed line is a JSON object or array
    const trimmed = logEntry.line.trim();
    const looksLikeWholeJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));

    if (looksLikeWholeJson) {
      try {
        logEntry.parsedJson = JSON.parse(trimmed);
      } catch (_e) {
        // Not valid JSON, continue without parsed content
      }
    }
  } catch (e) {
    // Error in JSON detection/parsing, continue
  }
  
  containerLogLines.push(logEntry);

  // Limit buffer size to prevent memory issues
  if (containerLogLines.length > 5000) {
    containerLogLines.splice(0, containerLogLines.length - 4000);
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

function getPodContainerColor(pod: string, container: string): string {
  const colors = [
    "#e6194B", "#3cb44b", "#ffe119", "#4363d8", 
    "#f58231", "#911eb4", "#42d4f4", "#f032e6", 
    "#bfef45", "#fabed4", "#469990", "#dcbeff", 
    "#9A6324", "#fffac8", "#800000", "#aaffc3", 
    "#808000", "#ffd8b1", "#000075", "#a9a9a9"
  ];
  
  // Simple hash function for pod-container combination
  let hash = 0;
  const combinedString = `${pod}/${container}`;
  for (let i = 0; i < combinedString.length; i++) {
    hash = ((hash << 5) - hash) + combinedString.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Ensure positive index
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// Using existing styles from main.css
