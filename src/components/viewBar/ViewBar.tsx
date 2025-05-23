// deno-lint-ignore-file jsx-button-has-type
import { createSignal, For, createEffect, untrack, onMount, onCleanup } from "solid-js";
import { KeyboardShortcuts } from "../keyboardShortcuts/KeyboardShortcuts.tsx";
import type { ActiveFilter } from "../filterBar/FilterBar.tsx";
import { useFilterStore } from "../../store/filterStore.tsx";

export interface View {
  id: string;
  label: string;
  isSystem?: boolean;
  filters: ActiveFilter[];
}

const SYSTEM_VIEWS: View[] = [
  { 
    id: 'pods',
    label: 'Pods',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'core/Pod' },
      { name: 'Namespace', value: 'all-namespaces' }]
  },
  { 
    id: 'helm',
    label: 'Helm',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'helm.sh/Release' },
      { name: 'Namespace', value: 'all-namespaces' }]
  },
  { 
    id: 'fluxcd',
    label: 'FluxCD',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'kustomize.toolkit.fluxcd.io/Kustomization' },
      { name: 'Namespace', value: 'flux-system' }]
  },
  { 
    id: 'argocd',
    label: 'ArgoCD',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'argoproj.io/Application' },
      { name: 'Namespace', value: 'argocd' }]
  }
];

export interface ViewBarProps {
  activeFilters: ActiveFilter[];
  setActiveFilters: (filters: ActiveFilter[]) => void;
}

export function ViewBar(props: ViewBarProps) {
  const [showNewViewForm, setShowNewViewForm] = createSignal(false);
  const [newViewName, setNewViewName] = createSignal("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = createSignal<string | null>(null);
  const [views, setViews] = createSignal<View[]>([]);
  let newViewNameInput: HTMLInputElement | undefined;
  const filterStore = useFilterStore();
  
  onMount(() => {
    loadViews();
  });
  
  const loadViews = () => {
    try {
      // Load custom views from storage
      const storedViews = localStorage.getItem('customViews');
      let customViews: View[] = [];
      
      if (storedViews) {
        customViews = JSON.parse(storedViews) as View[];
      }
      
      const allViews = [...SYSTEM_VIEWS, ...customViews];
      setViews(allViews);
      
      // Maintain the current selection if possible or select the first view
      const currentViewId = filterStore.selectedView;
      const viewExists = allViews.some(v => v.id === currentViewId);
      
      if (!viewExists && allViews.length > 0) {
        filterStore.setSelectedView(allViews[0].id);
      }
    } catch (error) {
      console.error('Error loading views:', error);
      // Even if there's an error, we should still try to load system views
      setViews(SYSTEM_VIEWS);
    }
  };
  
  const saveCustomViews = (viewsToSave: View[]) => {
    try {
      const customViews = viewsToSave.filter(view => !view.isSystem);
      
      // Convert views to a serializable format
      const serializableViews = customViews.map(view => {
        // Process filters to make them serializable
        const serializableFilters = view.filters?.map((activeFilter: ActiveFilter) => ({
          name: activeFilter.name, // Store filter name as identifier
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
  
  const createView = (label: string, filters: ActiveFilter[]) => {
  return {
      id: `custom-${Date.now()}`,
      label,
      filters: filters
    };
  };

  const selectViewByIndex = (index: number) => {
    const viewsList = views();
    if (index >= 0 && index < viewsList.length) {
      filterStore.setSelectedView(viewsList[index].id);
    }
  };
  
  // Update active filters when view changes
  createEffect(() => {
    let view: View | undefined;
    const selectedViewId = filterStore.selectedView;
    if (selectedViewId === filterStore.previousSelectedView) {
      return;
    }

    untrack(() => {
      view = views().find(v => v.id === selectedViewId);
    })

    if (view) {
      props.setActiveFilters(view.filters);
    }
  });
  
  const handleViewCreate = (viewName: string) => {
    if (!viewName.trim()) return;
    
    const newView = createView(viewName, props.activeFilters);
    
    const updatedViews = [...views(), newView];
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    filterStore.setSelectedView(newView.id);
  };
  
  const handleViewDelete = (viewId: string) => {
    const updatedViews = views().filter(view => view.id !== viewId);
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    filterStore.setSelectedView(SYSTEM_VIEWS[0].id);
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
    // Explicitly track dependencies to ensure effect reruns when they change
    const currentFilters = props.activeFilters;
    
    let viewId: string | undefined;
    let view: View | undefined;
    untrack(() => {
      viewId = filterStore.selectedView;
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
    if (!filtersChanged) {
      return;
    }

    // Create a completely new view with updated properties
    const updatedView: View = {
      ...view,
      filters: [...currentFilters]
    };
    
    // Update the view in the views list
    const updatedViews = views().map(v => 
      v.id === updatedView.id ? updatedView : v
    );
    
    setViews(updatedViews);
    saveCustomViews(updatedViews);
  });

  // Update document title based on selected view
  createEffect(() => {
    const defaultTitle = "Capacitor";
    const currentView = views().find(view => view.id === filterStore.selectedView);
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
                  class={`view-pill ${filterStore.selectedView === view.id ? 'selected' : ''}`}
                  onClick={() => filterStore.setSelectedView(view.id)}
                >
                  <span>{view.label}</span>
                  {filterStore.selectedView === view.id && !view.isSystem && (
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