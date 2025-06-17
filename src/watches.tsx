import { getWebSocketClient } from './k8sWebSocketClient.ts';

// WebSocket-based implementation for watching K8s resources
export const watchResource = async (
  path: string, 
  callback: (event: any) => void, 
  controller: AbortController, 
  setWatchStatus: (status: string) => void,
  onError?: (message: string, path: string) => void
) => {
  const wsClient = getWebSocketClient();

  path = path.startsWith("/k8s") ? path.slice(4) : path;

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
    
    // Call error handler if provided immediately
    if (onError) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error';
      onError(`Failed to watch resource: ${errorMessage}`, path);
    }
    
    // Try to reconnect with exponential backoff
    const retryDelay = Math.min(5000 + Math.random() * 2000, 30000);
    setTimeout(() => {
      // Only retry if the controller is not aborted
      if (!controller.signal.aborted) {
        watchResource(path, callback, controller, setWatchStatus, onError);
      }
    }, retryDelay);
  }
};
