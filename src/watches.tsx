// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { getWebSocketClient } from './k8sWebSocketClient.ts';

// WebSocket-based implementation for watching K8s resources
export const watchResource = async (
  path: string,
  callback: (event: any) => void,
  controller: AbortController,
  setWatchStatus: (status: string) => void,
  onError?: (message: string, path: string) => void,
  contextNameOverride?: string,
  params?: Record<string, string>
) => {
  // Determine context name using explicit override only
  const contextName = contextNameOverride || '';
  const wsClient = getWebSocketClient(contextName);

  // Normalize paths that start with /k8s[/<context>]/...
  // We need to strip the /k8s prefix and optional context segment,
  // but preserve the API root segment ("api" or "apis").
  if (path.startsWith("/k8s/")) {
    const rest = path.slice(5); // after "/k8s/"
    // Case 1: already "/k8s/api/..." or "/k8s/apis/..." → keep as-is minus "/k8s"
    if (rest.startsWith("api/") || rest.startsWith("apis/")) {
      path = `/${rest}`;
    } else {
      // Case 2: "/k8s/<context>/api..." → drop the context segment only
      const firstSlash = rest.indexOf('/');
      if (firstSlash === -1) {
        path = '/';
      } else {
        const afterContext = rest.slice(firstSlash + 1);
        path = `/${afterContext}`;
      }
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
    const unsubscribe = await wsClient.watchResource(path, callback, params);
    
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
        watchResource(path, callback, controller, setWatchStatus, onError, contextName, params);
      }
    }, retryDelay);
  }
};
