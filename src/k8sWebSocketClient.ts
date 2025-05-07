/**
 * K8sWebSocketClient handles communication with the Kubernetes proxy server
 * via WebSocket, allowing for efficient multiplexing of multiple resource watches.
 */
export class K8sWebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, (event: any) => void> = new Map();
  private connectionPromise: Promise<void> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private connected: boolean = false;
  
  /**
   * Creates a new K8sWebSocketClient
   * @param baseUrl The base URL of the Kubernetes proxy server (without /ws)
   */
  constructor() {
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
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
      console.log(`Connecting to WebSocket at ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connection established');
        this.reconnectAttempts = 0;
        this.connected = true;
        
        // Resubscribe to all paths
        for (const [path, callback] of this.subscribers.entries()) {
          this.sendSubscribeMessage(path);
        }
        
        resolve();
      };
      
      this.ws.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
        this.connected = false;
        this.connectionPromise = null;
        
        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = this.getReconnectDelay();
          console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
          setTimeout(() => this.connect(), delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('Maximum reconnection attempts reached');
          reject(new Error('Maximum reconnection attempts reached'));
        }
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'error') {
            console.error(`WebSocket error for path ${message.path}: ${message.error}`);
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
        // Don't reject here, let onclose handle reconnection
      };
    });
    
    return this.connectionPromise;
  }
  
  /**
   * Watches a Kubernetes resource
   * @param path The path to watch (e.g. "/api/v1/namespaces/default/pods")
   * @param callback The callback function to call when events are received
   * @returns A function that unsubscribes from the watch
   */
  async watchResource(path: string, callback: (event: any) => void): Promise<() => void> {    
    // Store the callback
    this.subscribers.set(path, callback);
    
    // Connect if not already connected
    try {
      await this.connect();
    } catch (err) {
      console.error('Failed to connect to WebSocket server:', err);
      // Remove subscriber if connection failed
      this.subscribers.delete(path);
      throw err;
    }
    
    // Send subscribe message if connected
    if (this.connected) {
      this.sendSubscribeMessage(path);
    }
    
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(path);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const requestId = Math.random().toString(36).substring(2, 15);
    this.ws.send(JSON.stringify({
      id: requestId,
      action: 'subscribe',
      path
    }));
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

// Singleton instance for use throughout the application
let instance: K8sWebSocketClient | null = null;

export function getWebSocketClient(): K8sWebSocketClient {
  if (!instance) {
    instance = new K8sWebSocketClient();
  }
  return instance;
}
