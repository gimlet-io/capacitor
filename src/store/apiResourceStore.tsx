// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createContext, createResource, useContext, JSX, createSignal, onMount } from "solid-js";
import type { ApiResource, ApiResourceList, ApiGroupList } from "../types/k8s.ts";
import { useErrorStore } from "./errorStore.tsx";

// Define types for the context information
export interface KubeContext {
  name: string;
  isCurrent: boolean;
  namespace?: string;
  clusterName?: string;
  user?: string;
}

interface ContextInfo {
  contexts: KubeContext[];
  current: string;
}

interface ApiResourceState {
  apiResources: ApiResource[] | undefined;
  namespaces: string[] | undefined;
  contextInfo: ContextInfo | undefined;
  switchContext: (contextName: string) => Promise<void>;
  isSwitchingContext: boolean;
  refetchResources: () => Promise<void>;
  clearResources: () => void;
}

const ApiResourceContext = createContext<ApiResourceState>();

export function ApiResourceProvider(props: { children: JSX.Element }) {
  const errorStore = useErrorStore();
  const [isSwitchingContext, setIsSwitchingContext] = createSignal(false);
  
  // Read ctx from URL if present and keep URL in sync when context changes
  const getCtxFromUrl = (): string | undefined => {
    try {
      const url = new URL(globalThis.location.href);
      const val = url.searchParams.get('ctx');
      return val || undefined;
    } catch {
      return undefined;
    }
  };
  
  const writeCtxToUrl = (ctx?: string) => {
    try {
      const url = new URL(globalThis.location.href);
      // rebuild query so ctx is first
      const currentParams = new URLSearchParams(url.search);
      url.search = '';
      if (ctx) url.searchParams.set('ctx', ctx);
      // re-add the rest (excluding ctx, to ensure first position)
      for (const [k, v] of currentParams.entries()) {
        if (k === 'ctx') continue;
        url.searchParams.append(k, v);
      }
      globalThis.history.replaceState(null, '', url.toString());
    } catch {
      // noop
    }
  };
  
  // Fetch context information from the API (must be initialized before other resources)
  const [contextInfo, { refetch: _refetchContexts, mutate: mutateContexts }] = createResource(async () => {
    try {
      // Contexts endpoint is cluster-agnostic; no per-context prefix
      const response = await fetch('/api/contexts');
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch contexts: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const data = await response.json() as ContextInfo;
      // Use ctx from URL if provided; else server-provided current; else first
      const ctxFromUrl = getCtxFromUrl();
      const currentName = ctxFromUrl || data.current || (data.contexts?.[0]?.name || '');
      const normalizedContexts = (data.contexts || []).map(c => ({ ...c, isCurrent: c.name === currentName }));
      const normalized: ContextInfo = { contexts: normalizedContexts, current: currentName };
      // Ensure URL reflects chosen context and has ctx first
      writeCtxToUrl(currentName || undefined);
      
      // Clear API error on successful completion
      if (errorStore.currentError?.type === 'api') {
        errorStore.clearError();
      }
      return normalized;
    } catch (error) {
      console.error("Error fetching context information:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching contexts';
      errorStore.setApiError(errorMessage);
      throw error;
    }
  });

  const [apiResources, { refetch: refetchApiResources, mutate: mutateApiResources }] = createResource(
    () => contextInfo()?.current,
    async (currentContext) => {
    try {
      if (!currentContext) return undefined as unknown as ApiResource[];
      const ctxName = encodeURIComponent(currentContext);
      // Clear previous API error if present on successful fetch
      if (errorStore.currentError?.type === 'api') {
        errorStore.clearError();
      }
      
      // Fetch core API resources (v1)
      const coreResponse = await fetch(`/k8s/${ctxName}/api/v1`);
      
      if (!coreResponse.ok) {
        const errorText = await coreResponse.text();
        throw new Error(`Failed to fetch API resources: ${coreResponse.status} ${coreResponse.statusText} - ${errorText}`);
      }
      
      const coreData = await coreResponse.json() as ApiResourceList;
      const coreResources = coreData.resources.map(resource => ({
        ...resource,
        group: '',
        version: 'v1',
        apiPath: `/k8s/${ctxName}/api/v1`
      })).sort((a, b) => a.name.localeCompare(b.name)); // Sort core resources alphabetically
      
      // Fetch API groups
      const groupsResponse = await fetch(`/k8s/${ctxName}/apis`);
      
      if (!groupsResponse.ok) {
        const errorText = await groupsResponse.text();
        throw new Error(`Failed to fetch API groups: ${groupsResponse.status} ${groupsResponse.statusText} - ${errorText}`);
      }
      
      const groupsData = await groupsResponse.json() as ApiGroupList;
      
      // Prepare priority groups first (apps/v1 and networking.k8s.io/v1)
      let appsResources: ApiResource[] = [];
      let networkingResources: ApiResource[] = [];
      let otherGroupResources: ApiResource[] = [];
      
      // Fetch resources for each API group
      const groupResourcesPromises = groupsData.groups.map(async (group) => {
        try {
          const groupVersionResponse = await fetch(`/k8s/${ctxName}/apis/${group.preferredVersion.groupVersion}`);
          const groupVersionData = await groupVersionResponse.json() as ApiResourceList;
          
          const resources = groupVersionData.resources.map(resource => ({
            ...resource,
            group: group.name,
            version: group.preferredVersion.version,
            apiPath: `/k8s/${ctxName}/apis/${group.preferredVersion.groupVersion}`
          })).sort((a, b) => a.name.localeCompare(b.name)); // Sort resources within each group
          
          return { 
            groupName: group.name, 
            resources 
          };
        } catch (error) {
          console.error(`Error fetching resources for group ${group.name}:`, error);
          return { 
            groupName: group.name, 
            resources: [] 
          };
        }
      });
      
      const groupResourcesResults = await Promise.all(groupResourcesPromises);
      
      // Sort groups alphabetically
      groupResourcesResults.sort((a, b) => a.groupName.localeCompare(b.groupName));
      
      // Split into priority groups and others
      for (const groupResult of groupResourcesResults) {
        if (groupResult.groupName === 'apps') {
          appsResources = groupResult.resources;
        } else if (groupResult.groupName === 'networking.k8s.io') {
          networkingResources = groupResult.resources;
        } else {
          otherGroupResources = [...otherGroupResources, ...groupResult.resources];
        }
      }
      
      // Combine all resources in the desired order: core -> apps -> networking -> others
      const allApiResources = [
        ...coreResources, 
        ...appsResources,
        ...networkingResources,
        ...otherGroupResources
      ];
      
      // Filter to include only resources that support listing (have 'list' in verbs)
      // and aren't subresources (don't contain '/')
      const filteredResources = allApiResources.filter(resource => 
        resource.verbs && // kubevirt subresources don't have verbs
        resource.verbs.includes('list') && 
        !resource.name.includes('/') &&
        resource.kind // Ensure it has a kind
      );
      
      // Explicitly clear API error on successful completion
      if (errorStore.currentError?.type === 'api') {
        errorStore.clearError();
      }
      return filteredResources;
    } catch (error) {
      console.error("Error fetching API resources:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching API resources';
      errorStore.setApiError(errorMessage);
      throw error; // Re-throw to let createResource handle the error state
    }
  });

  const [namespaces, { refetch: refetchNamespaces, mutate: mutateNamespaces }] = createResource(
    () => contextInfo()?.current,
    async (currentContext) => {
    try {
      if (!currentContext) return undefined as unknown as string[];
      const ctxName = encodeURIComponent(currentContext);
      const response = await fetch(`/k8s/${ctxName}/api/v1/namespaces`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch namespaces: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
      
      // Clear API error on successful completion
      if (errorStore.currentError?.type === 'api') {
        errorStore.clearError();
      }
      return nsList;
    } catch (error) {
      console.error("Error fetching namespaces:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching namespaces';
      errorStore.setApiError(errorMessage);
      throw error;
    }
  });

  // (moved contextInfo above)

  // Clear all stored API data immediately (used when switching contexts)
  const clearResources = () => {
    // Set API-derived data to undefined so consumers can react to loading state
    // Keep context list; we manage current locally
    mutateApiResources(undefined as unknown as ApiResource[]);
    mutateNamespaces(undefined as unknown as string[]);
  };

  // Function to switch Kubernetes context
  const switchContext = async (contextName: string) => {
    if (isSwitchingContext()) return;
    
    try {
      setIsSwitchingContext(true);
      // Immediately clear existing data so UI doesn't show stale info
      clearResources();
      const prev = contextInfo();
      if (prev) {
        const updated: ContextInfo = {
          current: contextName,
          contexts: (prev.contexts || []).map(c => ({ ...c, isCurrent: c.name === contextName }))
        };
        mutateContexts(updated);
      }
      // Sync ctx into URL
      writeCtxToUrl(contextName || undefined);
    } catch (error) {
      console.error('Error switching context:', error);
      
      // Set error in store for monitoring
      const errorMessage = error instanceof Error ? error.message : 'Unknown error switching context';
      errorStore.setApiError(`Context switch failed: ${errorMessage}`);
      
      throw error;
    } finally {
      setIsSwitchingContext(false);
    }
    // Refetch resources under the new context
    try {
      await Promise.all([
        refetchApiResources(),
        refetchNamespaces()
      ]);
    } catch (_err) {
      // Errors handled by resource loaders
    }
  };

  // Function to refetch all resources
  const refetchResources = async () => {
    try {
      await Promise.all([
        refetchApiResources(),
        refetchNamespaces()
      ]);
      console.log('Successfully refetched all resources');
    } catch (error) {
      console.error('Error refetching resources:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to refetch resources';
      errorStore.setApiError(errorMessage);
    }
  };

  const store: ApiResourceState = {
    get apiResources() { return apiResources(); },
    get namespaces() { return namespaces(); },
    get contextInfo() { return contextInfo(); },
    clearResources,
    switchContext,
    get isSwitchingContext() { return isSwitchingContext(); },
    refetchResources
  };

  // Handle browser navigation: if ctx changes in URL, switch context accordingly
  onMount(() => {
    const handlePopState = () => {
      const fromUrl = getCtxFromUrl();
      const current = contextInfo()?.current || '';
      // If ctx present and different, switch
      if (fromUrl && fromUrl !== current) {
        // Fire and forget; errors are handled internally
        switchContext(fromUrl);
      }
      // If ctx is missing, do nothing; keep current selection as-is
    };
    globalThis.addEventListener('popstate', handlePopState);
    return () => {
      globalThis.removeEventListener('popstate', handlePopState);
    };
  });

  return (
    <ApiResourceContext.Provider value={store}>
      {props.children}
    </ApiResourceContext.Provider>
  );
}

export function useApiResourceStore() {
  const context = useContext(ApiResourceContext);
  if (!context) {
    throw new Error("useApiResourceStore must be used within an ApiResourceProvider");
  }
  return context;
}
