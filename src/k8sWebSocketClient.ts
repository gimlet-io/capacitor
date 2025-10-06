/**
 * K8sWebSocketClient handles communication with the Kubernetes proxy server
 * via WebSocket, allowing for efficient multiplexing of multiple resource watches.
 */
export class K8sWebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, (event: any) => void> = new Map();
  private subscribeParams: Map<string, Record<string, string> | undefined> = new Map();
  private connectionPromise: Promise<void> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private connected: boolean = false;
  private serverReady: boolean = false;
  private contextName: string;
  
  /**
   * Creates a new K8sWebSocketClient
   * @param contextName The Kubernetes context name for this client
   */
  constructor(contextName?: string) {
    this.contextName = contextName || '';
    this.connect();
  }
  
  /**
   * Connects to the WebSocket server
   * @returns A promise that resolves when connected
   */
  private connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    
    this.connectionPromise = new Promise((resolve, reject) => {
      const wsPath = this.contextName ? `/ws/${encodeURIComponent(this.contextName)}` : '/ws';
      const wsUrl = `${globalThis.location.protocol === 'https:' ? 'wss' : 'ws'}://${globalThis.location.host}${wsPath}`;
      console.log(`Connecting to WebSocket at ${wsUrl}`);
      
      try {
        // Create WebSocket connection
        this.ws = new WebSocket(wsUrl);
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket connection timeout');
            if (this.ws) this.ws.close();
            // Reject the promise with a timeout error
            reject(new Error('WebSocket connection timeout - server may be unreachable'));
          }
        }, 10000); // 10 second timeout
        
        // Set up all event handlers
        this.ws.onopen = () => {
          console.log('WebSocket connection established, waiting for server ready signal');
          clearTimeout(connectionTimeout);
          this.reconnectAttempts = 0;
          this.connected = true;
          this.serverReady = false; // Reset server ready state
        };
        
        this.ws.onclose = (event) => {
          console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
          clearTimeout(connectionTimeout);
          this.connected = false;
          this.serverReady = false;
          this.connectionPromise = null;
          
          // Always attempt to reconnect with increasing delay
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = this.getReconnectDelay();
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), delay);
          } else {
            console.error('Maximum reconnection attempts reached, will try again in 30 seconds');
            // Reset attempts and try again after a longer delay
            this.reconnectAttempts = 0;
            setTimeout(() => this.connect(), 30000);
            reject(new Error('Maximum reconnection attempts reached'));
          }
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            // Handle server ready message
            if (message.type === 'ready') {
              console.log('Server ready signal received');
              this.serverReady = true;
              
              console.log(`[onready] Resubscribing to ${this.subscribers.size} paths`);
              
              // Resubscribe to all paths now that server is ready
              for (const [path, _callback] of this.subscribers.entries()) {
                console.log(`[onready] Resubscribing to: ${path}`);
                this.sendSubscribeMessage(path);
              }
              
              resolve();
              return;
            }

            // Handle periodic stats messages
            if (message.type === 'stats') {
              try {
                let stats: any = (message?.data && (message.data as any).object) ? (message.data as any).object : {};
                if (typeof stats === 'string') {
                  try { stats = JSON.parse(stats); } catch { stats = {}; }
                }
                const bytes = Number((stats as any).bytesSent) || 0;
                const kb = Math.round(bytes / 1024);
                console.log('[WS stats] objects=%s sent=%s KB interval=%ss', (stats as any).objects ?? 0, kb, (stats as any).intervalSeconds ?? 3);
              } catch (_e) {
                // noop
              }
              return;
            }
            
            if (message.type === 'error') {
              console.error(`WebSocket error for path ${message.path}: ${message.error}`);
              // Call the subscriber with error information if available
              const subscriber = this.subscribers.get(message.path);
              if (subscriber) {
                // This will cause the error to be propagated to the watch function
                subscriber({ type: 'ERROR', error: message.error, path: message.path });
              }
              return;
            }
            
            const subscriber = this.subscribers.get(message.path);
            if (subscriber && message.type === 'data') {
              subscriber(message.data);
            }
          } catch (err) {
            console.error('Error processing WebSocket message:', err);
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(connectionTimeout);
          // If we get an error before connection is established, reject immediately
          if (!this.connected) {
            reject(new Error('WebSocket connection failed - server may be down or unreachable'));
          }
          // Otherwise, let onclose handle reconnection
        };
      } catch (error) {
        console.error('Error creating WebSocket:', error);
        this.connectionPromise = null;
        reject(error);
      }
    });
    
    return this.connectionPromise;
  }
  
  /**
   * Watches a Kubernetes resource
   * @param path The path to watch (e.g. "/api/v1/namespaces/default/pods")
   * @param callback The callback function to call when events are received
   * @returns A function that unsubscribes from the watch
   */
  async watchResource(path: string, callback: (event: any) => void, params?: Record<string, string>): Promise<() => void> {    
    // Store the callback
    this.subscribers.set(path, callback);
    // Store optional subscribe params
    this.subscribeParams.set(path, params);
    
    // Connect if not already connected
    try {
      await this.connect();
    } catch (err) {
      console.error('Failed to connect to WebSocket server:', err);
      // Remove subscriber if connection failed
      this.subscribers.delete(path);
      
      // Enhanced error message for connection failures
      if (err instanceof Error) {
        if (err.message.includes('Maximum reconnection attempts reached')) {
          throw new Error(`Maximum reconnection attempts reached. Connection failed: ${err.message}`);
        }
        throw new Error(`Connection failed: ${err.message}`);
      }
      throw new Error('Failed to establish WebSocket connection to server');
    }
    
    // Send subscribe message if connected and server is ready
    if (this.connected && this.serverReady) {
      this.sendSubscribeMessage(path);
    }
    
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(path);
      this.subscribeParams.delete(path);
      if (this.connected && this.ws) {
        this.sendUnsubscribeMessage(path);
      }
    };
  }
  
  /**
   * Sends a subscribe message to the server
   * @param path The path to subscribe to
   */
  private sendSubscribeMessage(path: string): void {
    if (!this.ws) {
      console.error("[sendSubscribeMessage] WebSocket is null, cannot send message for path:", path);
      return;
    }
    
    const readyState = this.ws.readyState;
    const stateNames: Record<number, string> = {
      [WebSocket.CONNECTING]: "CONNECTING",
      [WebSocket.OPEN]: "OPEN",
      [WebSocket.CLOSING]: "CLOSING",
      [WebSocket.CLOSED]: "CLOSED"
    };
    
    if (readyState !== WebSocket.OPEN) {
      console.error(`[sendSubscribeMessage] WebSocket not open (state: ${stateNames[readyState]}), skipping message for path:`, path);
      return;
    }

    if (!this.serverReady) {
      console.error(`[sendSubscribeMessage] Server not ready, skipping message for path:`, path);
      return;
    }

    try {
      const requestId = Math.random().toString(36).substring(2, 15);
      const params = this.subscribeParams.get(path);
      const message = JSON.stringify({
        id: requestId,
        action: 'subscribe',
        path,
        params
      });
      
      this.ws.send(message);
    } catch (error) {
      console.error(`[sendSubscribeMessage] Error sending message for path ${path}:`, error);
    }
  }
  
  /**
   * Sends an unsubscribe message to the server
   * @param path The path to unsubscribe from
   */
  private sendUnsubscribeMessage(path: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const requestId = Math.random().toString(36).substring(2, 15);
    this.ws.send(JSON.stringify({
      id: requestId,
      action: 'unsubscribe',
      path
    }));
  }
  
  /**
   * Gets the delay for reconnection with exponential backoff
   * @returns The delay in milliseconds
   */
  private getReconnectDelay(): number {
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), maxDelay);
    this.reconnectAttempts++;
    return delay;
  }

  /**
   * Closes the WebSocket connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Singleton instances per context for use throughout the application
const instances: Map<string, K8sWebSocketClient> = new Map();

export function getWebSocketClient(contextName?: string): K8sWebSocketClient {
  const key = contextName || '';
  let existing = instances.get(key);
  if (!existing) {
    existing = new K8sWebSocketClient(contextName);
    instances.set(key, existing);
  }
  return existing;
}
