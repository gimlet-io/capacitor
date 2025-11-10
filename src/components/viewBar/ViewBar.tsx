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
  // When isolated, the ViewBar manages its own selected view id locally
  isolated?: boolean;
  // Enable/disable keyboard shortcuts handling (useful for multi-pane focus)
  keyboardEnabled?: boolean;
}

export function ViewBar(props: ViewBarProps) {
  const [views, setViews] = createSignal<View[]>([]);
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);
  let viewMenuRef: HTMLDivElement | undefined;
  const filterStore = useFilterStore();
  const isIsolated = () => !!props.isolated;
  const isKeyboardEnabled = () => props.keyboardEnabled !== false;
  // Local selected view id when isolated
  const [localSelectedViewId, setLocalSelectedViewId] = createSignal<string>('');
  const [saveViewOpen, setSaveViewOpen] = createSignal(false);
  let saveViewButtonRef: HTMLDivElement | undefined;
  let saveViewInlineRef: HTMLDivElement | undefined;
  const [newViewName, setNewViewName] = createSignal<string>("");
  // Unique keyboard handler id per instance
  const handlerId = `view-bar-${Math.random().toString(36).slice(2)}`;
  
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
    const selectedId = isIsolated() ? localSelectedViewId() : filterStore.selectedView;
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
  const [highlightedViewIndex, setHighlightedViewIndex] = createSignal<number>(-1);
  const scrollHighlightedViewIntoView = () => {
    if (!viewMenuRef) return;
    const container = viewMenuRef.querySelector('.filter-options-scroll-container') as HTMLElement | null;
    if (!container) return;
    const index = highlightedViewIndex();
    if (index < 0) return;
    const el = container.querySelector(`.filter-option[data-view-index="${index}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
  };
  const handleViewMenuKeydown = (event: KeyboardEvent) => {
    if (!viewMenuOpen()) return;
    if (event.key === "Escape") {
      setViewMenuOpen(false);
      return;
    }
    const list = views();
    if (!list || list.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedViewIndex(prev => {
        const next = prev < 0 ? 0 : Math.min(prev + 1, list.length - 1);
        return next;
      });
      setTimeout(scrollHighlightedViewIntoView, 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedViewIndex(prev => {
        const next = prev <= 0 ? 0 : prev - 1;
        return next;
      });
      setTimeout(scrollHighlightedViewIntoView, 0);
      return;
    }
    if (event.key === "Enter") {
      const index = highlightedViewIndex();
      if (index >= 0 && index < list.length) {
        event.preventDefault();
        const v = list[index];
        selectView(v.id);
        setViewMenuOpen(false);
        return;
      }
    }
  };
  createEffect(() => {
    if (viewMenuOpen()) {
      document.addEventListener("click", handleViewMenuClickOutside);
      document.addEventListener("keydown", handleViewMenuKeydown);
      // Set initial highlight to current selection or first item
      const list = views();
      const currentSelected = isIsolated() ? localSelectedViewId() : filterStore.selectedView;
      const currentIndex = list.findIndex(v => v.id === currentSelected);
      setHighlightedViewIndex(currentIndex >= 0 ? currentIndex : (list.length > 0 ? 0 : -1));
      setTimeout(scrollHighlightedViewIntoView, 0);
    } else {
      document.removeEventListener("click", handleViewMenuClickOutside);
      document.removeEventListener("keydown", handleViewMenuKeydown);
      setHighlightedViewIndex(-1);
    }
  });

  // Save View inline controls: outside click and Esc handling
  const handleSaveViewClickOutside = (event: MouseEvent) => {
    if (!saveViewOpen()) return;
    const target = event.target as Node;
    const insideButton = !!(saveViewButtonRef && saveViewButtonRef.contains(target));
    const insideInline = !!(saveViewInlineRef && saveViewInlineRef.contains(target));
    if (!insideButton && !insideInline) {
      setSaveViewOpen(false);
    }
  };
  const handleSaveViewKeydown = (event: KeyboardEvent) => {
    if (!saveViewOpen()) return;
    if (event.key === 'Escape') {
      setSaveViewOpen(false);
    }
  };
  createEffect(() => {
    if (saveViewOpen()) {
      document.addEventListener('click', handleSaveViewClickOutside);
      document.addEventListener('keydown', handleSaveViewKeydown);
    } else {
      document.removeEventListener('click', handleSaveViewClickOutside);
      document.removeEventListener('keydown', handleSaveViewKeydown);
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
      // Load hidden system views ids
      const hiddenSystem = localStorage.getItem('hiddenSystemViews');
      let hiddenSystemViewIds: string[] = [];
      
      if (storedViews) {
        customViews = JSON.parse(storedViews) as View[];
      }
      if (hiddenSystem) {
        try {
          const parsed = JSON.parse(hiddenSystem);
          if (Array.isArray(parsed)) {
            hiddenSystemViewIds = parsed.filter((v: unknown) => typeof v === 'string') as string[];
          }
        } catch {
          hiddenSystemViewIds = [];
        }
      }
      
      const systemViewsFiltered = SYSTEM_VIEWS.filter(v => !hiddenSystemViewIds.includes(v.id));
      const allViews = [...systemViewsFiltered, ...customViews];
      setViews(allViews);
      
      // Maintain the current selection if possible or select the first view
      const currentViewId = isIsolated() ? localSelectedViewId() : filterStore.selectedView;
      const viewExists = allViews.some(v => v.id === currentViewId);
      // If filters are already active (e.g., loaded from URL), don't override them
      const hasActiveFilters = Array.isArray(props.activeFilters) && props.activeFilters.length > 0;

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
    const currentId = isIsolated() ? localSelectedViewId() : filterStore.selectedView;
    if (viewId === currentId) return;
    if (isIsolated()) {
      setLocalSelectedViewId(viewId);
    } else {
      filterStore.setSelectedView(viewId);
    }

    untrack(() => {
        const view = views().find(v => v.id === viewId);
        if (view) {
          props.setActiveFilters(view.filters);
        }
    })
  };

  // Persist a new view and select it
  const saveCurrentFiltersAsView = (label: string) => {
    try {
      const id = `custom-${Date.now()}`;
      const newView = { id, label, filters: props.activeFilters.map(f => ({ name: f.name, value: f.value })) };
      const stored = localStorage.getItem('customViews');
      let customViews: any[] = [];
      if (stored) {
        try {
          customViews = JSON.parse(stored);
          if (!Array.isArray(customViews)) customViews = [];
        } catch { customViews = []; }
      }
      const updated = [...customViews, newView];
      localStorage.setItem('customViews', JSON.stringify(updated));
      try {
        const ev = new Event('custom-views-changed');
        (globalThis as unknown as { dispatchEvent?: (e: Event) => void }).dispatchEvent?.(ev);
      } catch { /* ignore */ }
      // Select the newly created view
      filterStore.setSelectedView(id);
    } catch {
      // Ignore persistence errors silently
    }
  };

  const selectViewByIndex = (index: number) => {
    const viewsList = views();
    if (index >= 0 && index < viewsList.length) {
      selectView(viewsList[index].id);
    }
  };
    
  const handleViewDelete = (viewId: string) => {
    const target = views().find(v => v.id === viewId);
    // Ask for user confirmation before deleting
    if (target) {
      try {
        const viewName = target.label || target.id;
        const confirmed =
          (globalThis as unknown as { confirm?: (msg: string) => boolean })
            .confirm?.(`Delete view "${viewName}"?`) ?? true;
        if (!confirmed) return;
      } catch {
        // If confirm is not available, proceed without blocking
      }
    }
    // Persist deletion for both custom and system views
    if (target) {
      try {
        if (target.isSystem) {
          // Track hidden system views
          const hiddenSystem = localStorage.getItem('hiddenSystemViews');
          let hiddenSystemViewIds: string[] = [];
          if (hiddenSystem) {
            try {
              const parsed = JSON.parse(hiddenSystem);
              if (Array.isArray(parsed)) {
                hiddenSystemViewIds = parsed.filter((v: unknown) => typeof v === 'string') as string[];
              }
            } catch {
              hiddenSystemViewIds = [];
            }
          }
          const alreadyHidden = hiddenSystemViewIds.includes(viewId);
          const updatedHidden = alreadyHidden ? hiddenSystemViewIds : [...hiddenSystemViewIds, viewId];
          localStorage.setItem('hiddenSystemViews', JSON.stringify(updatedHidden));
        } else {
          // Remove from custom views
          const stored = localStorage.getItem('customViews');
          let customViews: any[] = [];
          if (stored) {
            try {
              customViews = JSON.parse(stored);
              if (!Array.isArray(customViews)) customViews = [];
            } catch {
              customViews = [];
            }
          }
          const updatedCustom = customViews.filter((v: any) => v?.id !== viewId);
          localStorage.setItem('customViews', JSON.stringify(updatedCustom));
        }
        try {
          const ev = new Event('custom-views-changed');
          (globalThis as unknown as { dispatchEvent?: (e: Event) => void }).dispatchEvent?.(ev);
        } catch { /* ignore */ }
      } catch {
        // ignore storage errors
      }
    }
    // Update local state and switch selection
    const updatedViews = views().filter(view => view.id !== viewId);
    setViews(updatedViews);
    if (updatedViews.length > 0) {
      selectView(updatedViews[0].id);
    } else {
      selectView('');
    }
  };

  // Handle view keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent): boolean | void => {
    if (!isKeyboardEnabled()) return false;
    // If no modifiers are pressed, handle single-key shortcuts
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      // Open the Views dropdown with 'v' (mirrors ResourceType filter 'r')
      if (e.key === 'v') {
        e.preventDefault();
        setViewMenuOpen(true);
        return true;
      }
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
      id: handlerId,
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
      viewId = isIsolated() ? localSelectedViewId() : filterStore.selectedView;
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
    if (isIsolated()) return;
    const defaultTitle = "Capacitor";
    const selectedViewId = filterStore.selectedView;
    const currentView = selectedViewId ? views().find(view => view.id === selectedViewId) : undefined;
    document.title = currentView ? `${defaultTitle} › ${currentView.label}` : defaultTitle;
  });

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
          <span><span class="filter-label-prefix">View: </span>{selectedViewLabel() || "..."} </span>
          <span class="shortcut-key">v</span>
        </button>
        <Show when={viewMenuOpen()}>
          <div class="filter-options">
            <div class="filter-options-scroll-container">
              <Show when={isIsolated() ? !localSelectedViewId() : !filterStore.selectedView}>
                <button
                  class="filter-option"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMenuOpen(false);
                    setSaveViewOpen(true);
                    setTimeout(() => {
                      const input = (saveViewInlineRef?.querySelector('.filter-text-input input') as HTMLInputElement | undefined);
                      input?.focus();
                      input?.select?.();
                    }, 0);
                  }}
                >
                  <span>Save as View...</span>
                </button>
              </Show>
              <For each={views()}>
                {(view, _index) => (
                  <Show when={(isIsolated() ? localSelectedViewId() : filterStore.selectedView) === view.id} fallback={
                    <button 
                      class="filter-option"
                      data-view-index={_index()}
                      classList={{ "active": (isIsolated() ? localSelectedViewId() : filterStore.selectedView) === view.id, "highlighted": highlightedViewIndex() === _index() }}
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
                  }>
                    <div style={{ display: "flex", "align-items": "stretch", gap: "6px", width: "100%" }}>
                      <button 
                        class="filter-option"
                        data-view-index={_index()}
                        classList={{ "active": true, "highlighted": highlightedViewIndex() === _index() }}
                        style={{ flex: "1 1 auto" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Keep current selection; just close the menu
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
                      <button
                        class="filter-option"
                        title="Delete view"
                        style={{ "flex": "0 0 auto", "padding": "4px 8px" }}
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          handleViewDelete(view.id); 
                        }}
                      >
                        x
                      </button>
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
      {/* Save as View inline panel (only when no view is selected) */}
      <Show when={isIsolated() ? !localSelectedViewId() : !filterStore.selectedView}>
        <Show when={saveViewOpen()}>
          <div 
            class="filter-group"
            ref={el => { saveViewInlineRef = el; }}
          >
            <div class="filter-inline-controls" style="display: flex; align-items: center; gap: 8px;">
              <div class="filter-text-input">
                <input
                  type="text"
                  placeholder="View name"
                  value={newViewName()}
                  onInput={(e) => setNewViewName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = newViewName().trim();
                      if (name) {
                        saveCurrentFiltersAsView(name);
                        setNewViewName("");
                        setSaveViewOpen(false);
                      }
                    } else if (e.key === 'Escape') {
                      setSaveViewOpen(false);
                    }
                  }}
                />
              </div>
              <button
                class="filter-group-button"
                onClick={(e) => {
                  e.stopPropagation();
                  const name = newViewName().trim();
                  if (!name) return;
                  saveCurrentFiltersAsView(name);
                  setNewViewName("");
                  setSaveViewOpen(false);
                }}
                disabled={!newViewName().trim()}
              >
                Save
              </button>
              <button
                class="filter-group-button"
                onClick={(e) => { e.stopPropagation(); setSaveViewOpen(false); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </Show>
    </>
  );
} 