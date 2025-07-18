import { createContext, createResource, useContext, JSX, createSignal } from "solid-js";
import type { ApiResource, ApiResourceList, ApiGroupList } from "../types/k8s.ts";

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
  lastError: string | null;
  refetchResources: () => Promise<void>;
}

const ApiResourceContext = createContext<ApiResourceState>();

export function ApiResourceProvider(props: { children: JSX.Element }) {
  const [isSwitchingContext, setIsSwitchingContext] = createSignal(false);
  const [lastError, setLastError] = createSignal<string | null>(null);
  
  const [apiResources, { refetch: refetchApiResources }] = createResource(async () => {
    try {
      // Clear error at the start of a successful fetch
      setLastError(null);
      
      // Fetch core API resources (v1)
      const coreResponse = await fetch('/k8s/api/v1');
      
      if (!coreResponse.ok) {
        const errorText = await coreResponse.text();
        throw new Error(`Failed to fetch API resources: ${coreResponse.status} ${coreResponse.statusText} - ${errorText}`);
      }
      
      const coreData = await coreResponse.json() as ApiResourceList;
      const coreResources = coreData.resources.map(resource => ({
        ...resource,
        group: '',
        version: 'v1',
        apiPath: '/k8s/api/v1'
      })).sort((a, b) => a.name.localeCompare(b.name)); // Sort core resources alphabetically
      
      // Fetch API groups
      const groupsResponse = await fetch('/k8s/apis');
      
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
          const groupVersionResponse = await fetch(`/k8s/apis/${group.preferredVersion.groupVersion}`);
          const groupVersionData = await groupVersionResponse.json() as ApiResourceList;
          
          const resources = groupVersionData.resources.map(resource => ({
            ...resource,
            group: group.name,
            version: group.preferredVersion.version,
            apiPath: `/k8s/apis/${group.preferredVersion.groupVersion}`
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
        resource.verbs.includes('list') && 
        !resource.name.includes('/') &&
        resource.kind // Ensure it has a kind
      );
      
      // Explicitly clear error on successful completion
      setLastError(null);
      return filteredResources;
    } catch (error) {
      console.error("Error fetching API resources:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching API resources';
      setLastError(errorMessage);
      throw error; // Re-throw to let createResource handle the error state
    }
  });

  const [namespaces, { refetch: refetchNamespaces }] = createResource(async () => {
    try {
      const response = await fetch('/k8s/api/v1/namespaces');
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch namespaces: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
      
      // Clear error on successful completion
      setLastError(null);
      return nsList;
    } catch (error) {
      console.error("Error fetching namespaces:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching namespaces';
      setLastError(errorMessage);
      throw error;
    }
  });

  // Fetch context information from the API
  const [contextInfo, { refetch: refetchContexts }] = createResource(async () => {
    try {
      const response = await fetch('/api/contexts');
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch contexts: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const data = await response.json() as ContextInfo;
      
      // Clear error on successful completion
      setLastError(null);
      return data;
    } catch (error) {
      console.error("Error fetching context information:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching contexts';
      setLastError(errorMessage);
      throw error;
    }
  });

  // Function to switch Kubernetes context
  const switchContext = async (contextName: string) => {
    if (isSwitchingContext()) return;
    
    try {
      setIsSwitchingContext(true);
      
      const response = await fetch('/api/contexts/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ context: contextName }),
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to switch context';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      // Refetch data with the new context
      await refetchContexts();
      await refetchApiResources();
      await refetchNamespaces();
      
    } catch (error) {
      console.error('Error switching context:', error);
      
      // Set error in store for monitoring
      const errorMessage = error instanceof Error ? error.message : 'Unknown error switching context';
      setLastError(`Context switch failed: ${errorMessage}`);
      
      throw error;
    } finally {
      setIsSwitchingContext(false);
    }
  };

  // Function to refetch all resources
  const refetchResources = async () => {
    try {
      setLastError(null);
      await Promise.all([
        refetchApiResources(),
        refetchNamespaces(),
        refetchContexts()
      ]);
      console.log('Successfully refetched all resources');
    } catch (error) {
      console.error('Error refetching resources:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to refetch resources';
      setLastError(errorMessage);
    }
  };

  const store: ApiResourceState = {
    get apiResources() { return apiResources(); },
    get namespaces() { return namespaces(); },
    get contextInfo() { return contextInfo(); },
    switchContext,
    get isSwitchingContext() { return isSwitchingContext(); },
    get lastError() { return lastError(); },
    refetchResources
  };

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
