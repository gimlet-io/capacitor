// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createSignal, For, createEffect, untrack, onMount, onCleanup, Show, createMemo } from "solid-js";
import type { ActiveFilter } from "../filterBar/FilterBar.tsx";
import { useFilterStore } from "../../store/filterStore.tsx";
import { ShortcutPrefix, doesEventMatchShortcut, getShortcutPrefix, setShortcutPrefix, getDefaultShortcutPrefix } from "../../utils/shortcuts.ts";
import { keyboardManager } from "../../utils/keyboardManager.ts";

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
    id: 'services',
    label: 'Services',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'core/Service' },
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
    id: 'fluxcd/kustomizations',
    label: 'FluxCD/Kustomizations',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'kustomize.toolkit.fluxcd.io/Kustomization' },
      { name: 'Namespace', value: 'all-namespaces' }]
  },
  { 
    id: 'fluxcd/helmreleases',
    label: 'FluxCD/HelmReleases',
    isSystem: true,
    filters: [
      { name: 'ResourceType', value: 'helm.toolkit.fluxcd.io/HelmRelease' },
      { name: 'Namespace', value: 'all-namespaces' }]
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
  const [views, setViews] = createSignal<View[]>([]);
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);
  let viewMenuRef: HTMLDivElement | undefined;
  let newViewNameInput: HTMLInputElement | undefined;
  const filterStore = useFilterStore();
  
  const [viewShortcutModifier, setViewShortcutModifier] = createSignal<ShortcutPrefix>(
    typeof globalThis !== 'undefined'
      ? (getShortcutPrefix())
      : getDefaultShortcutPrefix()
  );

  createEffect(() => {
    setShortcutPrefix(viewShortcutModifier());
  });

  // Selected view label for dropdown button
  const selectedViewLabel = createMemo(() => {
    const selectedId = filterStore.selectedView;
    const all = views();
    if (selectedId) {
      const v = all.find(view => view.id === selectedId);
      if (v) return v.label;
    }
    // Fallback: infer by matching current filters
    const currentFilters = props.activeFilters || [];
    const matched = all.find(v => JSON.stringify(v.filters) === JSON.stringify(currentFilters));
    return matched ? matched.label : "";
  });

  // Close dropdown on outside click or Escape
  const handleViewMenuClickOutside = (event: MouseEvent) => {
    if (!viewMenuOpen()) return;
    if (viewMenuRef && !viewMenuRef.contains(event.target as Node)) {
      setViewMenuOpen(false);
    }
  };
  const handleViewMenuKeydown = (event: KeyboardEvent) => {
    if (!viewMenuOpen()) return;
    if (event.key === "Escape") {
      setViewMenuOpen(false);
    }
  };
  createEffect(() => {
    if (viewMenuOpen()) {
      document.addEventListener("click", handleViewMenuClickOutside);
      document.addEventListener("keydown", handleViewMenuKeydown);
    } else {
      document.removeEventListener("click", handleViewMenuClickOutside);
      document.removeEventListener("keydown", handleViewMenuKeydown);
    }
  });

  // Labels using formatShortcutForDisplay now rerender via Solid's reactive signal in shortcuts.ts
 
  onMount(() => {
    loadViews();
    try {
      const handler: EventListener = () => loadViews();
      // store handler on window for cleanup without using `any`
      (globalThis as unknown as { __customViewsHandler?: EventListener }).__customViewsHandler = handler;
      globalThis.addEventListener('custom-views-changed', handler);
    } catch {
      // ignore
    }
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
      // If filters are already active (e.g., loaded from URL), don't override them
      const hasActiveFilters = Array.isArray(filterStore.activeFilters) && filterStore.activeFilters.length > 0;

      if (!viewExists && allViews.length > 0 && !hasActiveFilters) {
        selectView(allViews[0].id);
      }
    } catch (error) {
      console.error('Error loading views:', error);
      // Even if there's an error, we should still try to load system views
      setViews(SYSTEM_VIEWS);
    }
  };
  
  const selectView = (viewId: string) => {
    if (viewId === filterStore.selectedView) return;
    filterStore.setSelectedView(viewId);

    untrack(() => {
        const view = views().find(v => v.id === viewId);
        if (view) {
          props.setActiveFilters(view.filters);
        }
    })
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
      selectView(viewsList[index].id);
    }
  };
    
  const handleViewCreate = (viewName: string) => {
    if (!viewName.trim()) return;
    
    const newView = createView(viewName, props.activeFilters);
    
    const updatedViews = [...views(), newView];
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    selectView(newView.id);
  };
  
  const handleViewDelete = (viewId: string) => {
    const updatedViews = views().filter(view => view.id !== viewId);
    setViews(updatedViews);
    saveCustomViews(updatedViews);
    selectView(SYSTEM_VIEWS[0].id);
  };

  // Handle view keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent): boolean | void => {
    // Early exit: if no modifiers are pressed, don't bother checking shortcuts
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      return false;
    }
    
    // Only check if it's a digit key
    const code = e.code || '';
    let num: number | undefined;
    if (code.startsWith('Digit')) {
      num = parseInt(code.replace('Digit', ''));
    } else if (code.startsWith('Numpad')) {
      num = parseInt(code.replace('Numpad', ''));
    } else {
      const parsed = parseInt(e.key);
      num = isNaN(parsed) ? undefined : parsed;
    }
    
    if (!num || num < 1 || num > 9) {
      return false;
    }
    
    // Now check if it matches the configured shortcut
    if (doesEventMatchShortcut(e, `mod+${num}`)) {
      e.preventDefault();
      selectViewByIndex(num - 1);
      return true;
    }
    
    return false;
  };

  onMount(() => {
    // Register with centralized keyboard manager (priority 2 = view switching)
    const unregister = keyboardManager.register({
      id: 'view-bar',
      priority: 2,
      handler: handleKeyDown,
      ignoreInInput: true
    });
    
    onCleanup(() => {
      unregister();
      try {
        const handler = (globalThis as unknown as { __customViewsHandler?: EventListener }).__customViewsHandler;
        if (handler) {
          globalThis.removeEventListener('custom-views-changed', handler);
        }
      } catch {
        // ignore
      }
    });
  });

  // Unselect view when filters are manually changed and don't match the selected view
  createEffect(() => {
    const currentFilters = props.activeFilters;
    
    let viewId: string | undefined;
    let view: View | undefined;
    untrack(() => {
      viewId = filterStore.selectedView;
      // Only proceed if we have a non-empty viewId
      if (!viewId) {
        return;
      }
      view = views().find(v => v.id === viewId);
    });

    if (!view) {
      return;
    }
    
    // Check if the current filters match the selected view's filters
    const filtersMatch = JSON.stringify(view.filters) === JSON.stringify(currentFilters);
    
    // If filters don't match and we have a selected view, unselect it
    if (!filtersMatch && viewId) {
      selectView('');
    }
  });

  // Update document title based on selected view
  createEffect(() => {
    const defaultTitle = "Capacitor";
    const selectedViewId = filterStore.selectedView;
    const currentView = selectedViewId ? views().find(view => view.id === selectedViewId) : undefined;
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
      <div 
        class="filter-group"
        ref={el => { viewMenuRef = el; }}
      >
        <button 
          classList={{ "filter-group-button": true, "has-active-filters": !!selectedViewLabel() }}
          onClick={(e) => { e.stopPropagation(); setViewMenuOpen(!viewMenuOpen()); }}
          title="Select view"
        >
          <span>View: {selectedViewLabel() || "..."} </span>
        </button>
        <Show when={viewMenuOpen()}>
          <div class="filter-options">
            <div class="filter-options-scroll-container">
              <For each={views()}>
                {(view, _index) => (
                  <button 
                    class="filter-option"
                    classList={{ "active": filterStore.selectedView === view.id }}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectView(view.id);
                      setViewMenuOpen(false);
                    }}
                  >
                    <span>{view.label}</span>
                    <Show when={_index() < 9}>
                      <span class="shortcut-key" style={{ "margin-left": "auto" }}>
                        {_index() + 1}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
              <button 
                class="filter-option"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMenuOpen(false);
                  handleNewViewButtonClick();
                }}
              >
                New View...
              </button>
            </div>
          </div>
        </Show>
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
    </>
  );
} 