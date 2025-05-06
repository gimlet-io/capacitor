import { getWebSocketClient } from './k8sWebSocketClient.ts';

// Original implementation - keeping as fallback
export const watchResourceWithFetch = async (path: string, callback: (event: any) => void, controller: AbortController, setWatchStatus: (status: string) => void) => {
  try {
    const response = await fetch(path, { signal: controller.signal });
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    setWatchStatus("●");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            callback(event);
          } catch (e) {
            console.log(line);
            console.error('Error parsing watch event:', e);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Watch aborted:', path);
      return;
    }
    console.error('Watch error:', error);
    setWatchStatus("○");
    setTimeout(() => {
      console.log('Restarting watch:', path);
      watchResourceWithFetch(path, callback, controller, setWatchStatus);
    }, 5000);
  }
};

// WebSocket-based implementation for watching K8s resources
export const watchResource = async (path: string, callback: (event: any) => void, controller: AbortController, setWatchStatus: (status: string) => void) => {
  const wsClient = getWebSocketClient();

  path = path.startsWith("/k8s") ? path.slice(4) : path;

  console.log(path);
  try {
    // Set status to active
    setWatchStatus("●");
    
    // Start watching via WebSocket
    const unsubscribe = await wsClient.watchResource(path, callback);
    
    // Handle abort
    controller.signal.addEventListener('abort', () => {
      unsubscribe();
    });
  } catch (error) {
    console.error('WebSocket watch error:', error);
    setWatchStatus("○");
    
    // Try to reconnect or fall back to fetch-based implementation
    setTimeout(() => {
      console.log('Restarting watch:', path);
      
      // Check if WEBSOCKET_DISABLED environment variable is set
      if (process.env.WEBSOCKET_DISABLED === 'true') {
        console.log('Falling back to fetch-based watch implementation');
        watchResourceWithFetch(path, callback, controller, setWatchStatus);
      } else {
        watchResource(path, callback, controller, setWatchStatus);
      }
    }, 5000);
  }
};
