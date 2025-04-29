import { createSignal, For, Show } from "solid-js";
import type { Filter } from "../filterBar/FilterBar.tsx";

// View Types
export type ResourceType = 'pods' | 'services' | 'deployments' | 'fluxcd' | 'argocd';

export interface ActiveFilter {
  filter: Filter;
  value: string;
}

export interface View {
  id: string;
  label: string;
  namespace: string;
  resourceType: ResourceType;
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
  resourceType: ResourceType;
  isSystem?: boolean;
  filters?: SerializableFilter[];
}

// System views definition
const SYSTEM_VIEWS: View[] = [
  { 
    id: 'pods',
    label: 'Pods',
    namespace: 'flux-system',
    resourceType: 'pods',
    isSystem: true
  },
  { 
    id: 'fluxcd',
    label: 'FluxCD',
    namespace: 'all-namespaces',
    resourceType: 'fluxcd',
    isSystem: true
  },
  { 
    id: 'argocd',
    label: 'ArgoCD',
    namespace: 'all-namespaces',
    resourceType: 'argocd',
    isSystem: true
  }
];

// ViewService class
export class ViewService {
  private filterRegistry: Record<string, any>;
  
  constructor(filterRegistry: Record<string, any>) {
    this.filterRegistry = filterRegistry;
  }
  
  loadViews(): View[] {
    try {
      const storedViews = localStorage.getItem('customViews');
      if (storedViews) {
        const serializedViews = JSON.parse(storedViews) as SerializableView[];
        
        // Reconstruct views with proper filter functions
        const customViews = serializedViews.map(serializedView => {
          if (serializedView.filters) {
            // Restore filter functions for each filter reference
            const restoredFilters = serializedView.filters
              .map((sf: SerializableFilter) => {
                const filterDef = this.filterRegistry[sf.filterId];
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
        
        return [...SYSTEM_VIEWS, ...customViews];
      }
    } catch (error) {
      console.error('Error loading custom views:', error);
    }
    
    return [...SYSTEM_VIEWS];
  }
  
  saveCustomViews(views: View[]): void {
    try {
      const customViews = views.filter(view => !view.isSystem);
      
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
      console.log('Serialized and saved custom views:', serializableViews);
    } catch (error) {
      console.error('Error saving custom views:', error);
    }
  }
  
  createView(label: string, namespace: string, resourceType: ResourceType, filters: ActiveFilter[]): View {
    const id = `custom-${Date.now()}`;
    return {
      id,
      label,
      namespace,
      resourceType,
      filters: [...filters]
    };
  }
  
  getSystemViews(): View[] {
    return [...SYSTEM_VIEWS];
  }
}

// ViewBar component
export interface ViewBarProps {
  views: View[];
  selectedViewId: string;
  onViewSelect: (viewId: string) => void;
  onViewCreate: (viewName: string, namespace: string, resourceType: ResourceType, filters: ActiveFilter[]) => void;
  onViewDelete: (viewId: string) => void;
  watchStatus?: string;
  namespace: string;
  resourceType: ResourceType;
  activeFilters: ActiveFilter[];
}

export function ViewBar(props: ViewBarProps) {
  const [showNewViewForm, setShowNewViewForm] = createSignal(false);
  const [newViewName, setNewViewName] = createSignal("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = createSignal<string | null>(null);
  let newViewNameInput: HTMLInputElement | undefined;

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
    
    props.onViewCreate(
      newViewName(),
      props.namespace,
      props.resourceType,
      props.activeFilters
    );
    
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
          <For each={props.views}>
            {(view) => (
              <div class="view-pill-container">
                <button
                  class={`view-pill ${props.selectedViewId === view.id ? 'selected' : ''}`}
                  onClick={() => props.onViewSelect(view.id)}
                >
                  <span>{view.label}</span>
                  {props.selectedViewId === view.id && !view.isSystem && (
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
                props.onViewDelete(showDeleteConfirmation()!);
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