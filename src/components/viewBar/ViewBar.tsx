// deno-lint-ignore-file jsx-button-has-type
import { createSignal, For, Show, createEffect, untrack, onMount, onCleanup } from "solid-js";
import type { Filter } from "../filterBar/FilterBar.tsx";
import type { Accessor } from "solid-js";
import { KeyboardShortcuts } from "../keyboardShortcuts/KeyboardShortcuts.tsx";
import type { ActiveFilter } from "../filterBar/FilterBar.tsx";
export interface View {
  id: string;
  label: string;
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
  resourceType: string;
  isSystem?: boolean;
  filters?: SerializableFilter[];
}

const SERIALIZED_SYSTEM_VIEWS: SerializableView[] = [
  { 
    id: 'pods',
    label: 'Pods',
    resourceType: 'core/Pod',
    isSystem: true,
    filters: [{ filterId: 'Namespace', value: 'all-namespaces' }]
  },
  { 
    id: 'fluxcd',
    label: 'FluxCD',
    resourceType: 'kustomize.toolkit.fluxcd.io/Kustomization',
    isSystem: true,
    filters: [{ filterId: 'Namespace', value: 'flux-system' }]
  },
  { 
    id: 'argocd',
    label: 'ArgoCD',
    resourceType: 'argoproj.io/Application',
    isSystem: true,
    filters: [{ filterId: 'Namespace', value: 'argocd' }]
  }
];

export interface ViewBarProps {
  filterRegistry: Accessor<Record<string, Filter>>;
  watchStatus?: string;
  resourceType: string;
  activeFilters: ActiveFilter[];
  setFilters: (filters: ActiveFilter[]) => void;
}

export function ViewBar(props: ViewBarProps) {
  const [showNewViewForm, setShowNewViewForm] = createSignal(false);
  const [newViewName, setNewViewName] = createSignal("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = createSignal<string | null>(null);
  const [views, setViews] = createSignal<View[]>([]);
  const [selectedView, setSelectedView] = createSignal<string>('');
  let previousSelectedView: string | null = null;
  let newViewNameInput: HTMLInputElement | undefined;

  // Reload views when filterRegistry changes
  createEffect(() => {
    const registry = props.filterRegistry();
    if (Object.keys(registry).length > 0) {
      loadViews();
    }
  });
  
  // Helper function to deserialize views
  const deserializeViews = (serializedViews: SerializableView[]): View[] => {
    return serializedViews.map(serializedView => {
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
  };

  onMount(() => {
    loadViews();
  });
  
  const loadViews = () => {
    try {
      // First load and deserialize system views
      const systemViews = deserializeViews(SERIALIZED_SYSTEM_VIEWS);
      
      // Then load custom views from storage
      const storedViews = localStorage.getItem('customViews');
      let customViews: View[] = [];
      
      if (storedViews) {
        const serializedCustomViews = JSON.parse(storedViews) as SerializableView[];
        customViews = deserializeViews(serializedCustomViews);
      }
      
      const allViews = [...systemViews, ...customViews];
      setViews(allViews);
      
      // Maintain the current selection if possible or select the first view
      const currentViewId = selectedView();
      const viewExists = allViews.some(v => v.id === currentViewId);
      
      if (!viewExists && allViews.length > 0) {
        setSelectedView(allViews[0].id);
      }
    } catch (error) {
      console.error('Error loading views:', error);
      // Even if there's an error, we should still try to load system views
      const systemViews = deserializeViews(SERIALIZED_SYSTEM_VIEWS);
      setViews(systemViews);
    }
  };
  
  const saveCustomViews = (viewsToSave: View[]) => {
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
  
  const createView = (label: string, resourceType: string, filters: ActiveFilter[]) => {
    const id = `custom-${Date.now()}`;
    return {
      id,
      label,
      resourceType,
      filters: [...filters]
    };
  };

  const selectViewByIndex = (index: number) => {
    const viewsList = views();
    if (index >= 0 && index < viewsList.length) {
      setSelectedView(viewsList[index].id);
    }
  };

  createEffect(() => {
    let view: View | undefined;
    const selectedViewId = selectedView();
    if (selectedViewId === previousSelectedView) {
      return;
    }

    untrack(() => {
      view = views().find(v => v.id === selectedViewId);
    })

    if (view) {
      props.setFilters(view.filters || []);
    }
    previousSelectedView = selectedViewId;
  });
  
  const handleViewCreate = (viewName: string) => {
    if (!viewName.trim()) return;
    
    const newView = createView(
      viewName,
      props.resourceType,
      props.activeFilters
    );
    
    const updatedViews = [...views(), newView];
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    setSelectedView(newView.id);
  };
  
  const handleViewDelete = (viewId: string) => {
    const updatedViews = views().filter(view => view.id !== viewId);
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    
    // Set selection to first system view
    const systemViews = deserializeViews(SERIALIZED_SYSTEM_VIEWS);
    if (systemViews.length > 0) {
      setSelectedView(systemViews[0].id);
    }
  };

  // Handle view keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    // Check for Ctrl + number to switch views
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      const num = parseInt(e.key);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        e.preventDefault();
        selectViewByIndex(num - 1);
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  // Update the current custom view whenever active filters change
  createEffect(() => {
    // Explicitly track these dependencies to ensure effect reruns when they change
    const currentFilters = props.activeFilters;
    const currentResourceType = props.resourceType;
    
    let viewId: string | undefined;
    let view: View | undefined;
    untrack(() => {
      viewId = selectedView();
      if (!viewId) {
        return;
      }
      view = views().find(v => v.id === viewId);
    });

    if (!view || view.isSystem) {
      return;
    }
    
    // Check if any properties have actually changed before updating
    const filtersChanged = JSON.stringify(view.filters) !== JSON.stringify(currentFilters);
    const resourceTypeChanged = view.resourceType !== currentResourceType;
    
    // Only proceed if something has changed
    if (filtersChanged || resourceTypeChanged) {
      // Create a completely new view with updated properties
      const updatedView: View = {
        ...view,
        resourceType: currentResourceType,
        // Make a fresh copy of the filters array
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

  const handleFormKeyDown = (e: KeyboardEvent) => {
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
            {(view, index) => (
              <div class="view-pill-container">
                <button
                  class={`view-pill ${selectedView() === view.id ? 'selected' : ''}`}
                  onClick={() => setSelectedView(view.id)}
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
        
        <div class="view-right-section">
          <div class="keyboard-shortcut-container">
            <KeyboardShortcuts 
              shortcuts={[{ key: `Ctrl+1,2,3...`, description: 'Switch view' }]}
              resourceSelected={true}
            />
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
      </div>
      
      {showNewViewForm() && (
        <div class="new-view-form">
          <input
            type="text"
            placeholder="View name"
            value={newViewName()}
            onInput={(e) => setNewViewName(e.currentTarget.value)}
            onKeyDown={handleFormKeyDown}
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