// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, onMount, onCleanup, Show, createEffect, For } from "solid-js";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";

export function TerminalViewer(props: {
  resource: any;
  isOpen: boolean;
}) {
  const apiResourceStore = useApiResourceStore();
  const [terminal, setTerminal] = createSignal<Terminal | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [isConnected, setIsConnected] = createSignal<boolean>(false);
  const [connectionError, setConnectionError] = createSignal<string>("");
  const [noShellAvailable, setNoShellAvailable] = createSignal<boolean>(false);
  const [availableContainers, setAvailableContainers] = createSignal<string[]>([]);
  const [availableInitContainers, setAvailableInitContainers] = createSignal<string[]>([]);
  const [selectedContainer, setSelectedContainer] = createSignal<string>("");
  const [manuallySelectedContainer, setManuallySelectedContainer] = createSignal<boolean>(false);
  const [triedContainers, setTriedContainers] = createSignal<Set<string>>(new Set());

  
  let terminalContainer: HTMLDivElement | undefined;
  let wsUnsubscribe: (() => void) | null = null;

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
    if (!props.resource || props.resource.kind !== "Pod") {
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

  const connectWebSocket = async () => {
    if (!props.resource || props.resource.kind !== "Pod" || !terminal()) {
      return;
    }
    
    // If already connected, don't reconnect
    if (isConnected()) {
      return;
    }
    
    // If we already know there's no shell available, don't try to reconnect
    if (noShellAvailable()) {
      return;
    }

    try {
      setConnectionError("");
      setIsConnected(false);

      const podName = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      const containerName = selectedContainer();
      
      // Create WebSocket URL for exec (direct connection) - backend will auto-select shell
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const contextSegment = ctxName ? `/${ctxName}` : '';
      let wsUrl = `${protocol}//${window.location.host}/api${contextSegment}/exec/${namespace}/${podName}`;
      if (containerName) {
        const params = new URLSearchParams();
        params.append("container", containerName);
        wsUrl = `${wsUrl}?${params.toString()}`;
      }
      
      console.log("Connecting to exec WebSocket:", wsUrl);
      
      // Create direct WebSocket connection
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log("Exec WebSocket connected");
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
            setIsConnected(true);
            terminal()?.write(`\r\n🎉 ${data.message || 'Connected'}\r\n\r\n`);
            // Scroll to bottom after connection message
            setTimeout(() => terminal()?.scrollToBottom(), 10);
          } else if (data.type === 'data' && data.data) {
            // Write received data to terminal
            terminal()?.write(data.data);
            // Auto-scroll to bottom when new data arrives
            setTimeout(() => terminal()?.scrollToBottom(), 10);
          } else if (data.type === 'error') {
            setConnectionError(data.error || 'Connection error');
            setIsConnected(false);
            
            // Check if error is about no suitable shell found
            if (data.error && data.error.includes('no suitable shell found')) {
              console.log("No shell available in container");
              
              // If this was an auto-selected container, try the next one
              if (!manuallySelectedContainer()) {
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
      };
      
      ws.onclose = () => {
        console.log("Exec WebSocket disconnected");
        setIsConnected(false);
        
        // Auto-reconnect if drawer is still open and we haven't determined that no shell is available
        if (props.isOpen && !noShellAvailable()) {
          console.log("Auto-reconnecting...");
          setTimeout(() => {
            if (props.isOpen && !isConnected() && !noShellAvailable()) {
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
    setConnectionError("");
  };

  const handleConnect = async () => {
    if (!terminal()) {
      setConnectionError("Terminal not initialized");
      return;
    }
    
    disconnect();
    console.log("Connecting to exec WebSocket");
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
    if (props.resource && props.resource.kind === "Pod") {
      setNoShellAvailable(false);
      updateAvailableContainers();
    } else if (props.resource) {
      setNoShellAvailable(false);
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
        
        // Auto-connect when tab becomes active (only if shell is available)
        if (!isConnected() && !connectionError() && !noShellAvailable()) {
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
        <Show when={props.resource?.kind !== "Pod"}>
          <div class="terminal-error">
            <p>Terminal exec is only available for Pod resources.</p>
          </div>
        </Show>
        
        <Show when={props.resource?.kind === "Pod"}>
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

          <Show when={connectionError()}>
            <div class="terminal-error">
              <p>Connection Error: {connectionError()}</p>
              <Show when={!noShellAvailable()}>
                <p class="terminal-retry-message">Retrying in 2 seconds...</p>
              </Show>
              <Show when={noShellAvailable()}>
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