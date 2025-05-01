import { createSignal, For, Show, createEffect, untrack } from "solid-js";
import type { Filter } from "../filterBar/FilterBar.tsx";
import type { Accessor } from "solid-js";

export interface ActiveFilter {
  filter: Filter;
  value: string;
}

export interface View {
  id: string;
  label: string;
  namespace: string;
  resourceType: string;
  isSystem?: boolean;
  filters?: ActiveFilter[];
}

interface SerializableFilter {
  filterId: string;
  value: string;
}

interface SerializableView {
  id: string;
  label: string;
  namespace: string;
  resourceType: string;
  isSystem?: boolean;
  filters?: SerializableFilter[];
}

// System views definition
const SYSTEM_VIEWS: View[] = [
  { 
    id: 'pods',
    label: 'Pods',
    namespace: 'flux-system',
    resourceType: 'core/Pod',
    isSystem: true
  },
  { 
    id: 'fluxcd',
    label: 'FluxCD',
    namespace: 'all-namespaces',
    resourceType: 'kustomize.toolkit.fluxcd.io/Kustomization',
    isSystem: true
  },
  { 
    id: 'argocd',
    label: 'ArgoCD',
    namespace: 'all-namespaces',
    resourceType: 'argoproj.io/Application',
    isSystem: true
  }
];

export interface ViewBarProps {
  filterRegistry: Accessor<Record<string, Filter>>;
  watchStatus?: string;
  namespace: string;
  resourceType: string;
  activeFilters: ActiveFilter[];
  updateFilters: (namespace: string, resourceType: string, filters: ActiveFilter[]) => void;
}

export function ViewBar(props: ViewBarProps) {
  const [showNewViewForm, setShowNewViewForm] = createSignal(false);
  const [newViewName, setNewViewName] = createSignal("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = createSignal<string | null>(null);
  const [views, setViews] = createSignal<View[]>([]);
  const [selectedView, setSelectedView] = createSignal<string>('');
  let newViewNameInput: HTMLInputElement | undefined;

  // Reload views when filterRegistry changes
  createEffect(() => {
    const registry = props.filterRegistry();
    if (Object.keys(registry).length > 0) {
      loadViews();
    }
  });
  
  // Function to load views
  const loadViews = () => {
    try {
      const storedViews = localStorage.getItem('customViews');
      let customViews: View[] = [];
      
      if (storedViews) {
        const serializedViews = JSON.parse(storedViews) as SerializableView[];
        
        // Reconstruct views with proper filter functions
        customViews = serializedViews.map(serializedView => {
          if (serializedView.filters) {            
            // Restore filter functions for each filter reference
            const restoredFilters = serializedView.filters
              .map((sf: SerializableFilter) => {
                const filterDef = props.filterRegistry()[sf.filterId];
                if (filterDef) {
                  return {
                    filter: filterDef,
                    value: sf.value
                  };
                }
                return null;
              })
              .filter(Boolean) as ActiveFilter[]; // Remove any null filters
            
            return { 
              ...serializedView, 
              filters: restoredFilters 
            };
          }
          return serializedView;
        }) as View[];
      }
      
      const loadedViews = [...SYSTEM_VIEWS, ...customViews];
      setViews(loadedViews);
      
      // Maintain the current selection if possible or select the first view
      const currentViewId = selectedView();
      const viewExists = loadedViews.some(v => v.id === currentViewId);
      
      if (!viewExists && loadedViews.length > 0) {
        handleViewSelect(loadedViews[0].id);
      }
    } catch (error) {
      console.error('Error loading views:', error);
      setViews([...SYSTEM_VIEWS]);
    }
  };
  
  const saveCustomViews = (viewsToSave: View[]) => {
    console.log('Saving views:', viewsToSave);
    try {
      const customViews = viewsToSave.filter(view => !view.isSystem);
      
      // Convert views to a serializable format
      const serializableViews = customViews.map(view => {
        // Process filters to make them serializable
        const serializableFilters = view.filters?.map((activeFilter: ActiveFilter) => ({
          filterId: activeFilter.filter.name, // Store filter name as identifier
          value: activeFilter.value
        }));
        
        return {
          ...view,
          filters: serializableFilters
        };
      });
      
      localStorage.setItem('customViews', JSON.stringify(serializableViews));
    } catch (error) {
      console.error('Error saving custom views:', error);
    }
  };
  
  const createView = (label: string, namespace: string, resourceType: string, filters: ActiveFilter[]) => {
    const id = `custom-${Date.now()}`;
    return {
      id,
      label,
      namespace,
      resourceType,
      filters: [...filters]
    };
  };
  
  const handleViewSelect = (viewId: string) => {
    setSelectedView(viewId);
    const view = views().find(v => v.id === viewId);
    if (view) {
      // Notify parent component of view change
      props.updateFilters(
        view.namespace,
        view.resourceType,
        view.filters || []
      );
    }
  };
  
  const handleViewCreate = (viewName: string) => {
    if (!viewName.trim()) return;
    
    const newView = createView(
      viewName,
      props.namespace,
      props.resourceType,
      props.activeFilters
    );
    
    const updatedViews = [...views(), newView];
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    handleViewSelect(newView.id);
  };
  
  const handleViewDelete = (viewId: string) => {
    const updatedViews = views().filter(view => view.id !== viewId);
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    
    // Set selection to first system view
    const systemViews = SYSTEM_VIEWS;
    if (systemViews.length > 0) {
      handleViewSelect(systemViews[0].id);
    }
  };

  // Update the current custom view whenever active filters change
  createEffect(() => {
    let viewId: string | undefined;
    let view: View | undefined;
    untrack(() => {
      viewId = selectedView();
      if (!viewId) {
        return;
      }
      view = views().find(v => v.id === viewId);
    })

    const currentFilters = props.activeFilters;
    const currentNamespace = props.namespace;
    const currentResourceType = props.resourceType;
    
    if (!view || view.isSystem) {
      return;
    }
    
    // Check if any properties have actually changed before updating
    const filtersChanged = JSON.stringify(view.filters) !== JSON.stringify(currentFilters);
    const namespaceChanged = view.namespace !== currentNamespace;
    const resourceTypeChanged = view.resourceType !== currentResourceType;
    
    // Only proceed if something has changed
    if (filtersChanged || namespaceChanged || resourceTypeChanged) {
      // Update this view with current filters and settings
      const updatedView: View = {
        ...view,
        namespace: currentNamespace,
        resourceType: currentResourceType,
        filters: [...currentFilters]
      };
      
      // Update the view in the views list
      const updatedViews = views().map(v => 
        v.id === updatedView.id ? updatedView : v
      );
      
      setViews(updatedViews);
      saveCustomViews(updatedViews);
    }
  });

  // Update document title based on selected view
  createEffect(() => {
    const defaultTitle = "Capacitor";
    const currentView = views().find(view => view.id === selectedView());
    document.title = currentView ? `${defaultTitle} › ${currentView.label}` : defaultTitle;
  });

  const handleNewViewButtonClick = () => {
    setShowNewViewForm(true);
    setNewViewName("");
    setTimeout(() => {
      newViewNameInput?.focus();
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      createNewView();
    }
  };

  const createNewView = () => {
    if (!newViewName().trim()) return;
    
    handleViewCreate(newViewName());
    
    setShowNewViewForm(false);
    setNewViewName("");
  };

  const cancelNewView = () => {
    setShowNewViewForm(false);
    setNewViewName("");
  };

  return (
    <>
      <div class="views">
        <div class="view-buttons">
          <For each={views()}>
            {(view) => (
              <div class="view-pill-container">
                <button
                  class={`view-pill ${selectedView() === view.id ? 'selected' : ''}`}
                  onClick={() => handleViewSelect(view.id)}
                >
                  <span>{view.label}</span>
                  {selectedView() === view.id && !view.isSystem && (
                    <span 
                      class="view-delete" 
                      title="Delete view"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirmation(view.id);
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              </div>
            )}
          </For>
          {!showNewViewForm() ? (
            <button
              class="view-pill new-view"
              onClick={handleNewViewButtonClick}
            >
              +
            </button>
          ) : (
            <button
              class="view-pill new-view-creating"
            >
              {newViewName() || "New View"}
            </button>
          )}
        </div>
        <Show when={props.watchStatus}>
          <span 
            classList={{ 
              "watch-status": true, 
              "error": props.watchStatus !== "●" 
            }}
          >
            {props.watchStatus}
          </span>
        </Show>
      </div>
      
      {showNewViewForm() && (
        <div class="new-view-form">
          <input
            type="text"
            placeholder="View name"
            value={newViewName()}
            onInput={(e) => setNewViewName(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            ref={el => newViewNameInput = el}
          />
          <div class="new-view-actions">
            <button class="new-view-cancel" onClick={cancelNewView}>Cancel</button>
            <button 
              class="new-view-save" 
              onClick={createNewView}
              disabled={!newViewName().trim()}
            >
              Save
            </button>
          </div>
        </div>
      )}
      
      {showDeleteConfirmation() && (
        <div class="delete-confirmation">
          <p>Are you sure you want to delete this view?</p>
          <div class="delete-actions">
            <button 
              class="delete-cancel" 
              onClick={() => setShowDeleteConfirmation(null)}
            >
              Cancel
            </button>
            <button 
              class="delete-confirm" 
              onClick={() => {
                handleViewDelete(showDeleteConfirmation()!);
                setShowDeleteConfirmation(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </>
  );
} 