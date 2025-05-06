import { getWebSocketClient } from './k8sWebSocketClient.ts';

// WebSocket-based implementation for watching K8s resources
export const watchResource = async (path: string, callback: (event: any) => void, controller: AbortController, setWatchStatus: (status: string) => void) => {
  const wsClient = getWebSocketClient();

  path = path.startsWith("/k8s") ? path.slice(4) : path;

  try {
    // Set status to active
    setWatchStatus("●");
    
    // Start watching via WebSocket
    const unsubscribe = await wsClient.watchResource(path, callback);
    
    // Handle abort
    controller.signal.addEventListener('abort', () => {
      console.log('Aborting watch:', path);
      unsubscribe();
    });
  } catch (error) {
    console.error('WebSocket watch error:', error);
    setWatchStatus("○");
    
    // Try to reconnect or fall back to fetch-based implementation
    setTimeout(() => {
      console.log('Restarting watch:', path);
      // watchResourceWithFetch(path, callback, controller, setWatchStatus);
      watchResource(path, callback, controller, setWatchStatus);
    }, 5000);
  }
};
