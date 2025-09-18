import { getWebSocketClient } from './k8sWebSocketClient.ts';

// WebSocket-based implementation for watching K8s resources
export const watchResource = async (
  path: string,
  callback: (event: any) => void,
  controller: AbortController,
  setWatchStatus: (status: string) => void,
  onError?: (message: string, path: string) => void,
  contextNameOverride?: string
) => {
  // Determine context name using explicit override only
  const contextName = contextNameOverride || '';
  const wsClient = getWebSocketClient(contextName);

  // Strip leading /k8s and always remove the next segment as context
  if (path.startsWith("/k8s/")) {
    const rest = path.slice(5); // after "/k8s/"
    const firstSlash = rest.indexOf('/');
    if (firstSlash === -1) {
      path = '/';
    } else {
      path = `/${rest.slice(firstSlash + 1)}`;
    }
  }
  // If explicit context provided and path starts with /api/<context>/..., normalize to /api/...
  if (contextName && path.startsWith(`/api/${contextName}/`)) {
    path = `/api/${path.slice(6 + contextName.length)}`;
  }

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
