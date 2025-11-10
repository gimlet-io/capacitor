// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

/**
 * K8sWebSocketClient handles communication with the Kubernetes proxy server
 * via WebSocket, allowing for efficient multiplexing of multiple resource watches.
 */
export class K8sWebSocketClient {
  private ws: WebSocket | null = null;
  // Track subscribers by server subscription id to allow multiple streams per path with different params
  private callbacksById: Map<string, Set<(event: any) => void>> = new Map();
  // Map composite key (path + canonical params) to subscription metadata
  private subscriptionByKey: Map<string, { id: string; path: string; params?: Record<string, string> }> = new Map();
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
              
              console.log(`[onready] Resubscribing to ${this.subscriptionByKey.size} subscriptions`);
              
              // Resubscribe to all paths now that server is ready
          for (const [, sub] of this.subscriptionByKey.entries()) {
                console.log(`[onready] Resubscribing to: ${sub.path}`);
                this.sendSubscribeMessage(sub.path, sub.id, sub.params);
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
              const callbacks = this.callbacksById.get(message.id);
              if (callbacks) {
                for (const cb of callbacks) {
                  try {
                    cb({ type: 'ERROR', error: message.error, path: message.path });
                  } catch (e) {
                    console.error('Subscriber callback error:', e);
                  }
                }
              }
              return;
            }
            
          if (message.type === 'data') {
            const callbacks = this.callbacksById.get(message.id);
            if (!callbacks) return;
            for (const cb of callbacks) {
              try {
                cb(message.data);
              } catch (e) {
                console.error('Subscriber callback error:', e);
              }
            }
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
    const subKey = this.makeSubscriptionKey(path, params);
    const existing = this.subscriptionByKey.get(subKey);
    if (existing) {
      let set = this.callbacksById.get(existing.id);
      if (!set) {
        set = new Set<(event: any) => void>();
        this.callbacksById.set(existing.id, set);
      }
      set.add(callback);
      return () => {
        const cur = this.callbacksById.get(existing!.id);
        if (!cur) return;
        cur.delete(callback);
        if (cur.size === 0) {
          this.callbacksById.delete(existing!.id);
          this.subscriptionByKey.delete(subKey);
          if (this.connected && this.ws) {
            this.sendUnsubscribeMessage(existing!.path, existing!.id, existing!.params);
          }
        }
      };
    }
    // Create new subscription
    const id = Math.random().toString(36).substring(2, 15);
    this.subscriptionByKey.set(subKey, { id, path, params });
    let set = this.callbacksById.get(id);
    if (!set) {
      set = new Set<(event: any) => void>();
      this.callbacksById.set(id, set);
    }
    set.add(callback);
    
    // Connect if not already connected
    try {
      await this.connect();
    } catch (err) {
      console.error('Failed to connect to WebSocket server:', err);
      // Remove subscriber if connection failed
      const cur = this.callbacksById.get(id);
      if (cur) {
        cur.delete(callback);
        if (cur.size === 0) {
          this.callbacksById.delete(id);
        }
      }
      this.subscriptionByKey.delete(subKey);
      
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
      this.sendSubscribeMessage(path, id, params);
    }
    
    // Return unsubscribe function
    return () => {
      const current = this.callbacksById.get(id);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) {
        this.callbacksById.delete(id);
        this.subscriptionByKey.delete(subKey);
        if (this.connected && this.ws) {
          this.sendUnsubscribeMessage(path, id, params);
        }
      }
    };
  }
  
  /**
   * Sends a subscribe message to the server
   * @param path The path to subscribe to
   */
  private sendSubscribeMessage(path: string, id: string, params?: Record<string, string>): void {
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
      const requestId = id;
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
   * Shallow equality check for params objects
   */
  private shallowEqualParams(a?: Record<string, string>, b?: Record<string, string>): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
  
  /**
   * Sends an unsubscribe message to the server
   * @param path The path to unsubscribe from
   */
  private sendUnsubscribeMessage(path: string, id: string, params?: Record<string, string>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const requestId = id;
    this.ws.send(JSON.stringify({
      id: requestId,
      action: 'unsubscribe',
      path,
      params
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
  
  /**
   * Build a stable subscription key from path and params
   */
  private makeSubscriptionKey(path: string, params?: Record<string, string>): string {
    if (!params || Object.keys(params).length === 0) return path;
    const keys = Object.keys(params).sort();
    const enc = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? '')}`).join('&');
    return `${path}?${enc}`;
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
