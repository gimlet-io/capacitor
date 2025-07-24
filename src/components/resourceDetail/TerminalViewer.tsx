import { createSignal, onMount, onCleanup, Show, createEffect } from "solid-js";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

export function TerminalViewer(props: {
  resource: any;
  isOpen: boolean;
}) {
  const [terminal, setTerminal] = createSignal<Terminal | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [isConnected, setIsConnected] = createSignal<boolean>(false);
  const [connectionError, setConnectionError] = createSignal<string>("");
  const [shells] = createSignal<string[]>(["bash", "sh", "ash"]);
  const [selectedShell, setSelectedShell] = createSignal<string>("bash");
  
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
        selectionBackground: '#ffffff40',
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
      allowTransparency: true,
      convertEol: true,
      scrollback: 1000,
      rows: 24,
      cols: 80
    });

    // Create fit addon
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Open terminal in container
    term.open(terminalContainer);
    fit.fit();

    // Store references
    setTerminal(term);
    setFitAddon(fit);

    // Handle terminal resize
    const handleResize = () => {
      if (fit && props.isOpen) {
        setTimeout(() => fit.fit(), 10);
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  };

  const connectWebSocket = async () => {
    if (!props.resource || props.resource.kind !== "Pod" || !terminal()) {
      return;
    }

    try {
      setConnectionError("");
      setIsConnected(false);

      const podName = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      const shell = selectedShell();
      
      // Create WebSocket URL for exec (direct connection)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/exec/${namespace}/${podName}?shell=${shell}`;
      
      console.log("Connecting to exec WebSocket:", wsUrl);
      
      // Create direct WebSocket connection
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log("Exec WebSocket connected");
        setIsConnected(true);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Exec WebSocket message:", data);

          if (data.type === 'connected') {
            setIsConnected(true);
            terminal()?.write(`\r\n🎉 Connected to ${podName} (${shell})\r\n\r\n`);
          } else if (data.type === 'data' && data.data) {
            // Write received data to terminal
            terminal()?.write(data.data);
          } else if (data.type === 'error') {
            setConnectionError(data.error || 'Connection error');
            setIsConnected(false);
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

  // Initialize terminal when component mounts
  onMount(() => {
    const cleanup = initializeTerminal();
    onCleanup(() => {
      disconnect();
      if (cleanup) cleanup();
    });
  });

  // Watch for isOpen prop changes using createEffect
  createEffect(() => {
    if (props.isOpen && terminal() && fitAddon()) {
      // Fit terminal when tab becomes active
      setTimeout(() => fitAddon()?.fit(), 50);
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
            <div class="terminal-connection-info">
              <span class="terminal-pod-info">
                Pod: {props.resource?.metadata?.name} | Namespace: {props.resource?.metadata?.namespace}
              </span>
              <Show when={isConnected()}>
                <span class="terminal-status connected">● Connected</span>
              </Show>
              <Show when={!isConnected() && !connectionError()}>
                <span class="terminal-status disconnected">○ Disconnected</span>
              </Show>
              <Show when={connectionError()}>
                <span class="terminal-status error">✗ Error</span>
              </Show>
            </div>

            <div class="terminal-shell-controls">
              <label for="shell-select">Shell:</label>
              <select 
                id="shell-select"
                value={selectedShell()} 
                onChange={(e) => setSelectedShell(e.target.value)}
                disabled={isConnected()}
              >
                {shells().map(shell => (
                  <option value={shell}>{shell}</option>
                ))}
              </select>
              
              <Show when={!isConnected()}>
                <button onClick={handleConnect} class="terminal-connect-btn">
                  Connect
                </button>
              </Show>
              
              <Show when={isConnected()}>
                <button onClick={disconnect} class="terminal-disconnect-btn">
                  Disconnect
                </button>
              </Show>
            </div>
          </div>

          <Show when={connectionError()}>
            <div class="terminal-error">
              <p>Connection Error: {connectionError()}</p>
              <button onClick={handleConnect} class="terminal-retry-btn">
                Retry
              </button>
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