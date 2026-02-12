// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, onMount, onCleanup, Show, createEffect, For } from "solid-js";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { createTerminalNewlineState, normalizeTerminalNewlines } from "../../utils/terminal.ts";

export function TerminalViewer(props: {
  resource: any;
  isOpen: boolean;
}) {
  const apiResourceStore = useApiResourceStore();
  const [terminal, setTerminal] = createSignal<Terminal | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [isConnected, setIsConnected] = createSignal<boolean>(false);
  const [isConnecting, setIsConnecting] = createSignal<boolean>(false);
  const [connectionError, setConnectionError] = createSignal<string>("");
  const [noShellAvailable, setNoShellAvailable] = createSignal<boolean>(false);
  const [availableContainers, setAvailableContainers] = createSignal<string[]>([]);
  const [availableInitContainers, setAvailableInitContainers] = createSignal<string[]>([]);
  const [selectedContainer, setSelectedContainer] = createSignal<string>("");
  const [manuallySelectedContainer, setManuallySelectedContainer] = createSignal<boolean>(false);
  const [triedContainers, setTriedContainers] = createSignal<Set<string>>(new Set());

  // Check if resource is a Node
  const resourceIsNode = () => props.resource?.kind === "Node";
  // Check if resource is a Pod
  const resourceIsPod = () => props.resource?.kind === "Pod";

  
  let terminalContainer: HTMLDivElement | undefined;
  let wsUnsubscribe: (() => void) | null = null;
  let newlineState = createTerminalNewlineState();

  const initializeTerminal = () => {
    if (!terminalContainer) return;

    // Create terminal with options
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      allowTransparency: false, // Disable transparency to avoid rendering issues
      convertEol: true,
      scrollback: 1000,
      rows: 24,
      cols: 80,
      macOptionIsMeta: true
    });

    // Create fit addon
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Open terminal in container
    term.open(terminalContainer);
    
    // Wait a moment then fit and force a refresh
    setTimeout(() => {
      fit.fit();
      term.refresh(0, term.rows - 1);
      term.focus();
      term.scrollToBottom();
    }, 10);

    // Store references
    setTerminal(term);
    setFitAddon(fit);

    // Handle terminal resize
    const handleResize = () => {
      if (fit && props.isOpen) {
        setTimeout(() => {
          fit.fit();
          // Scroll to bottom after resize to maintain proper viewport
          if (terminal()) {
            terminal()?.scrollToBottom();
          }
        }, 10);
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  };

  const updateAvailableContainers = () => {
    // For Nodes, we don't need container selection
    if (resourceIsNode()) {
      setAvailableContainers([]);
      setAvailableInitContainers([]);
      setSelectedContainer("");
      setManuallySelectedContainer(false);
      setTriedContainers(new Set<string>());
      return;
    }

    if (!props.resource || !resourceIsPod()) {
      setAvailableContainers([]);
      setAvailableInitContainers([]);
      setSelectedContainer("");
      setManuallySelectedContainer(false);
      setTriedContainers(new Set<string>());
      return;
    }

    const containers = (props.resource.spec?.containers || []).map((c: any) => c.name);
    const initContainers = (props.resource.spec?.initContainers || []).map((c: any) => c.name);

    setAvailableContainers(containers);
    setAvailableInitContainers(initContainers);

    // Reset manual selection and tried containers when pod changes
    setManuallySelectedContainer(false);
    setTriedContainers(new Set<string>());

    // Default to the first regular container if present, otherwise first init container
    if (containers.length > 0) {
      setSelectedContainer(containers[0]);
    } else if (initContainers.length > 0) {
      setSelectedContainer(initContainers[0]);
    } else {
      setSelectedContainer("");
    }
  };

  // Track the debug pod name for cleanup
  let debugPodName: string | null = null;
  let debugPodNamespace: string | null = null;

  // Create debug pod for a Node, wait for it, then exec into it
  const createNodeDebugPod = async () => {
    if (!props.resource || !resourceIsNode() || !terminal()) {
      return;
    }

    setConnectionError("");
    setIsConnecting(true);

    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
    const contextSegment = ctxName ? `/${ctxName}` : '';
    const nodeName = props.resource.metadata.name;
    const createUrl = `/api${contextSegment}/node-debug/${nodeName}`;

    terminal()?.write(`Creating privileged debug pod on node ${nodeName}...\r\n`);

    try {
      // Step 1: Create the debug pod
      const response = await fetch(createUrl, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create debug pod');
      }

      debugPodName = data.pod;
      debugPodNamespace = data.namespace;

      terminal()?.write(`Debug pod ${data.pod} created, waiting for it to be ready...\r\n`);

      // Step 2: Poll until pod is running
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const podUrl = `${k8sPrefix}/api/v1/namespaces/${data.namespace}/pods/${data.pod}`;
      
      let podReady = false;
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes max

      while (!podReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;

        try {
          const podResponse = await fetch(podUrl);
          if (podResponse.ok) {
            const podData = await podResponse.json();
            if (podData.status?.phase === 'Running') {
              podReady = true;
              terminal()?.write(`Debug pod is running!\r\n`);
            } else if (podData.status?.phase === 'Failed') {
              throw new Error(`Debug pod failed: ${podData.status?.message || 'Unknown error'}`);
            }
          }
        } catch (_pollError) {
          // Ignore poll errors, keep trying
        }
      }

      if (!podReady) {
        throw new Error('Timeout waiting for debug pod to be ready');
      }

      terminal()?.write(`Connecting to debug pod...\r\n\r\n`);

      // Step 3: Connect via WebSocket to exec into the debug pod
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api${contextSegment}/exec/${data.namespace}/${data.pod}?container=debugger`;

      newlineState = createTerminalNewlineState();
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);
        setTimeout(() => {
          terminal()?.focus();
          terminal()?.scrollToBottom();
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const msgData = JSON.parse(event.data);
          if (msgData.type === 'connected') {
            setIsConnecting(false);
            setIsConnected(true);
            terminal()?.write(`\r\n🎉 ${msgData.message || 'Connected to debug pod'}\r\n`);
            terminal()?.write(`Host filesystem is mounted at /host\r\n\r\n`);
            setTimeout(() => terminal()?.scrollToBottom(), 10);
          } else if (msgData.type === 'data' && msgData.data) {
            terminal()?.write(normalizeTerminalNewlines(msgData.data, newlineState));
            setTimeout(() => terminal()?.scrollToBottom(), 10);
          } else if (msgData.type === 'error') {
            setConnectionError(msgData.error || 'Connection error');
            setIsConnected(false);
            setIsConnecting(false);
          }
        } catch (parseError) {
          console.error("Error parsing WebSocket message:", parseError);
        }
      };

      ws.onerror = () => {
        setConnectionError("WebSocket connection error");
        setIsConnected(false);
        setIsConnecting(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        // Clean up the debug pod when connection closes
        if (debugPodName && debugPodNamespace) {
          cleanupDebugPod(debugPodNamespace, debugPodName, contextSegment);
        }
      };

      // Store WebSocket reference for cleanup
      wsUnsubscribe = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      // Handle terminal input
      terminal()?.onData((inputData) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: inputData }));
          setTimeout(() => terminal()?.scrollToBottom(), 10);
        }
      });

      // Handle terminal resize
      terminal()?.onResize((size) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
        }
      });

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      terminal()?.write(`\r\n❌ Error: ${errMsg}\r\n`);
      setConnectionError(errMsg);
      setIsConnecting(false);
      // Clean up the debug pod on error
      if (debugPodName && debugPodNamespace) {
        cleanupDebugPod(debugPodNamespace, debugPodName, contextSegment);
      }
    }
  };

  // Clean up the debug pod
  const cleanupDebugPod = async (namespace: string, podName: string, contextSegment: string) => {
    try {
      terminal()?.write(`\r\nCleaning up debug pod ${podName}...\r\n`);
      const k8sPrefix = contextSegment ? `/k8s${contextSegment}` : '/k8s';
      const deleteUrl = `${k8sPrefix}/api/v1/namespaces/${namespace}/pods/${podName}`;
      await fetch(deleteUrl, { method: 'DELETE' });
      terminal()?.write(`Debug pod deleted.\r\n`);
    } catch (error) {
      console.error("Failed to clean up debug pod:", error);
    }
    debugPodName = null;
    debugPodNamespace = null;
  };

  const connectWebSocket = async () => {
    // For Node resources, use POST endpoint instead of WebSocket
    if (resourceIsNode()) {
      return createNodeDebugPod();
    }

    // For Pod resources, use WebSocket exec
    if (!props.resource || !resourceIsPod() || !terminal()) {
      return;
    }
    
    // If already connected or connecting, don't start another connection
    if (isConnected() || isConnecting()) {
      return;
    }
    
    // If we already know there's no shell available, don't try to reconnect
    if (noShellAvailable()) {
      return;
    }

    try {
      setConnectionError("");
      setIsConnected(false);
      setIsConnecting(true);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const contextSegment = ctxName ? `/${ctxName}` : '';
      
      const podName = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      const containerName = selectedContainer();
      
      let wsUrl = `${protocol}//${window.location.host}/api${contextSegment}/exec/${namespace}/${podName}`;
      if (containerName) {
        const params = new URLSearchParams();
        params.append("container", containerName);
        wsUrl = `${wsUrl}?${params.toString()}`;
      }
      
      // Create direct WebSocket connection
      newlineState = createTerminalNewlineState();
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log("Exec WebSocket connected");
        setIsConnecting(false);
        setIsConnected(true);
        
        // Focus terminal on connect and scroll to bottom
        setTimeout(() => {
          terminal()?.focus();
          terminal()?.scrollToBottom();
        }, 100);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'connected') {
            setIsConnecting(false);
            setIsConnected(true);
            terminal()?.write(`\r\n🎉 ${data.message || 'Connected'}\r\n\r\n`);
            // Scroll to bottom after connection message
            setTimeout(() => terminal()?.scrollToBottom(), 10);
          } else if (data.type === 'data' && data.data) {
            // Write received data to terminal
            terminal()?.write(normalizeTerminalNewlines(data.data, newlineState));
            // Auto-scroll to bottom when new data arrives
            setTimeout(() => terminal()?.scrollToBottom(), 10);
          } else if (data.type === 'error') {
            setConnectionError(data.error || 'Connection error');
            setIsConnected(false);
            setIsConnecting(false);
            
            // Check if error is about no suitable shell found
            if (data.error && data.error.includes('no suitable shell found')) {
              console.log("No shell available in container/pod");
              
              // For Nodes, we can't try other containers, just mark as unavailable
              if (resourceIsNode()) {
                setNoShellAvailable(true);
              } else if (!manuallySelectedContainer()) {
                // If this was an auto-selected container, try the next one
                const hasMoreToTry = tryNextContainer();
                if (hasMoreToTry && props.isOpen) {
                  // Try connecting to the next container
                  setTimeout(() => {
                    handleConnect();
                  }, 500);
                }
              } else {
                // User manually selected this container, respect their choice
                setNoShellAvailable(true);
              }
            }
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };
      
      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnectionError("WebSocket connection error");
        setIsConnected(false);
        setIsConnecting(false);
      };
      
      ws.onclose = () => {
        console.log("Exec WebSocket disconnected");
        setIsConnected(false);
        setIsConnecting(false);
        
        // Auto-reconnect if drawer is still open and we haven't determined that no shell is available
        // Don't auto-reconnect for Nodes since it creates new debug pods each time
        if (props.isOpen && !noShellAvailable() && !resourceIsNode()) {
          console.log("Auto-reconnecting...");
          setTimeout(() => {
            if (props.isOpen && !isConnected() && !isConnecting() && !noShellAvailable()) {
              handleConnect();
            }
          }, 2000);
        }
      };

      // Store WebSocket reference for cleanup
      wsUnsubscribe = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      // Handle terminal input
      terminal()?.onData((data) => {
        if (isConnected() && ws.readyState === WebSocket.OPEN) {
          // Send input to backend via websocket
          ws.send(JSON.stringify({ type: 'input', data }));
          // Scroll to bottom after user input to show cursor position
          setTimeout(() => terminal()?.scrollToBottom(), 10);
        }
      });

      // Handle terminal resize
      terminal()?.onResize((size) => {
        if (isConnected() && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'resize', 
            cols: size.cols, 
            rows: size.rows 
          }));
        }
      });

    } catch (error) {
      console.error("Error connecting to exec websocket:", error);
      setConnectionError(error instanceof Error ? error.message : 'Unknown error');
      setIsConnected(false);
    }
  };

  const tryNextContainer = () => {
    // Get all containers in order (regular containers first, then init containers)
    const allContainers = [...availableContainers(), ...availableInitContainers()];
    const currentContainer = selectedContainer();
    
    // Mark current container as tried
    const tried = new Set<string>(triedContainers());
    tried.add(currentContainer);
    setTriedContainers(tried);
    
    // Find the next container that hasn't been tried
    const nextContainer = allContainers.find(c => !tried.has(c));
    
    if (nextContainer) {
      console.log(`No shell in ${currentContainer}, trying next container: ${nextContainer}`);
      setSelectedContainer(nextContainer);
      setNoShellAvailable(false);
      // Don't set manuallySelectedContainer to true here - this is still auto-selection
      return true;
    } else {
      // We've tried all containers
      console.log("No suitable shell found in any container");
      setNoShellAvailable(true);
      return false;
    }
  };

  const disconnect = () => {
    if (wsUnsubscribe) {
      wsUnsubscribe();
      wsUnsubscribe = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setConnectionError("");
  };

  const handleConnect = async () => {
    if (!terminal()) {
      setConnectionError("Terminal not initialized");
      return;
    }
    
    // Don't start a new connection if already connecting or connected
    if (isConnecting() || isConnected()) {
      return;
    }
    
    // For Nodes, use POST request (no disconnect needed)
    if (resourceIsNode()) {
      await createNodeDebugPod();
      return;
    }
    
    disconnect();
    await connectWebSocket();
  };

  const handleContainerChange = (containerName: string) => {
    setSelectedContainer(containerName);
    // Mark this as a manual selection
    setManuallySelectedContainer(true);
    // Reset shell availability state when switching containers
    setNoShellAvailable(false);
    // Reset tried containers since user is explicitly selecting one
    setTriedContainers(new Set<string>());
    // Reconnect to use the newly selected container
    if (props.isOpen) {
      handleConnect();
    }
  };

  // Initialize terminal when component mounts
  onMount(() => {
    const cleanup = initializeTerminal();
    onCleanup(() => {
      disconnect();
      if (cleanup) cleanup();
    });
  });

  // Reset state and available containers when the resource changes
  createEffect(() => {
    if (props.resource && (resourceIsPod() || resourceIsNode())) {
      setNoShellAvailable(false);
      setConnectionError("");
      updateAvailableContainers();
    } else if (props.resource) {
      setNoShellAvailable(false);
      setConnectionError("");
      setIsConnecting(false);
      setAvailableContainers([]);
      setAvailableInitContainers([]);
      setSelectedContainer("");
    }
  });

  // Watch for isOpen prop changes using createEffect
  createEffect(() => {
    if (props.isOpen && terminal() && fitAddon()) {
      // Fit terminal when tab becomes active
      setTimeout(() => {
        fitAddon()?.fit();
        
        // Auto-connect when tab becomes active (only if not already connecting/connected and shell might be available)
        if (!isConnected() && !isConnecting() && !noShellAvailable()) {
          handleConnect();
        }
        
        // Auto-focus terminal and scroll to bottom
        if (isConnected()) {
          terminal()?.focus();
          terminal()?.scrollToBottom();
        }
      }, 50);
    } else if (!props.isOpen) {
      // Disconnect when drawer is closed
      disconnect();
    }
  });
  
  // Auto-focus terminal when connected
  createEffect(() => {
    if (isConnected() && terminal()) {
      setTimeout(() => {
        terminal()?.focus();
        terminal()?.scrollToBottom();
      }, 100);
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="terminal-viewer">
        <Show when={!resourceIsPod() && !resourceIsNode()}>
          <div class="terminal-error">
            <p>Terminal exec is only available for Pod and Node resources.</p>
          </div>
        </Show>
        
        <Show when={resourceIsPod() || resourceIsNode()}>
          {/* Container selection only for Pods */}
          <Show when={resourceIsPod()}>
            <div class="terminal-controls">
              <div class="terminal-options-row">
                <div class="logs-select-container">
                  <label>Container:</label>
                  <select
                    value={selectedContainer()}
                    onChange={(e) => handleContainerChange(e.target.value)}
                    class="container-select"
                  >
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
              </div>
            </div>
          </Show>

          <Show when={connectionError()}>
            <div class="terminal-error">
              <p>Connection Error: {connectionError()}</p>
              <Show when={!noShellAvailable() && resourceIsPod()}>
                <p class="terminal-retry-message">Retrying in 2 seconds...</p>
              </Show>
              <Show when={noShellAvailable()}>
                <Show when={resourceIsNode()}>
                  <p class="terminal-no-shell-message">
                    Failed to start debug session on node {props.resource?.metadata?.name}.
                  </p>
                </Show>
                <Show when={resourceIsPod()}>
                  <Show 
                    when={manuallySelectedContainer()}
                    fallback={
                      <p class="terminal-no-shell-message">
                        No shell available in any container in this pod.
                        {triedContainers().size > 0 && ` Tried: ${Array.from(triedContainers()).join(', ')}`}
                      </p>
                    }
                  >
                    <p class="terminal-no-shell-message">
                      No shell available in the selected container ({selectedContainer()}).
                    </p>
                  </Show>
                </Show>
              </Show>
            </div>
          </Show>

          <div 
            ref={terminalContainer}
            class="terminal-container"
            style={{ display: props.isOpen ? 'block' : 'none' }}
          />
        </Show>
      </div>
    </Show>
  );
} 