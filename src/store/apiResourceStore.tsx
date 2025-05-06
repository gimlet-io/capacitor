import { createContext, createResource, useContext, JSX } from "solid-js";
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
}

const ApiResourceContext = createContext<ApiResourceState>();

export function ApiResourceProvider(props: { children: JSX.Element }) {
  const [apiResources] = createResource(async () => {
    try {
      // Fetch core API resources (v1)
      const coreResponse = await fetch('/k8s/api/v1');
      const coreData = await coreResponse.json() as ApiResourceList;
      const coreResources = coreData.resources.map(resource => ({
        ...resource,
        group: '',
        version: 'v1',
        apiPath: '/k8s/api/v1'
      })).sort((a, b) => a.name.localeCompare(b.name)); // Sort core resources alphabetically
      
      // Fetch API groups
      const groupsResponse = await fetch('/k8s/apis');
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
      return allApiResources.filter(resource => 
        resource.verbs.includes('list') && 
        !resource.name.includes('/') &&
        resource.kind // Ensure it has a kind
      );
    } catch (error) {
      console.error("Error fetching API resources:", error);
      return [];
    }
  });

  const [namespaces] = createResource(async () => {
    const response = await fetch('/k8s/api/v1/namespaces');
    const data = await response.json();
    const nsList = data.items.map((ns: { metadata: { name: string } }) => ns.metadata.name);
    return nsList;
  });

  // Fetch context information from the API
  const [contextInfo] = createResource(async () => {
    try {
      const response = await fetch('/api/contexts');
      if (!response.ok) {
        throw new Error(`Failed to fetch contexts: ${response.statusText}`);
      }
      const data = await response.json() as ContextInfo;
      return data;
    } catch (error) {
      console.error("Error fetching context information:", error);
      return { contexts: [], current: "" };
    }
  });

  const store: ApiResourceState = {
    get apiResources() { return apiResources(); },
    get namespaces() { return namespaces(); },
    get contextInfo() { return contextInfo(); }
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
