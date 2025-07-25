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
    
    // If already connected, don't reconnect
    if (isConnected()) {
      return;
    }

    try {
      setConnectionError("");
      setIsConnected(false);

      const podName = props.resource.metadata.name;
      const namespace = props.resource.metadata.namespace;
      
      // Create WebSocket URL for exec (direct connection) - backend will auto-select shell
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/exec/${namespace}/${podName}`;
      
      console.log("Connecting to exec WebSocket:", wsUrl);
      
      // Create direct WebSocket connection
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log("Exec WebSocket connected");
        setIsConnected(true);
        
        // Focus terminal on connect
        setTimeout(() => terminal()?.focus(), 100);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Exec WebSocket message:", data);

          if (data.type === 'connected') {
            setIsConnected(true);
            terminal()?.write(`\r\n🎉 ${data.message || 'Connected'}\r\n\r\n`);
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
        
        // Auto-reconnect if drawer is still open
        if (props.isOpen) {
          console.log("Auto-reconnecting...");
          setTimeout(() => {
            if (props.isOpen && !isConnected()) {
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
      setTimeout(() => {
        fitAddon()?.fit();
        
        // Auto-connect when tab becomes active
        if (!isConnected() && !connectionError()) {
          handleConnect();
        }
        
        // Auto-focus terminal
        if (isConnected()) {
          terminal()?.focus();
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
      setTimeout(() => terminal()?.focus(), 100);
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


          <Show when={connectionError()}>
            <div class="terminal-error">
              <p>Connection Error: {connectionError()}</p>
              <p class="terminal-retry-message">Retrying in 2 seconds...</p>
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