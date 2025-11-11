// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js";
import { type ActiveFilter } from "../components/filterbar/FilterBar.tsx";
import { SettingsModal } from "../components/settings/SettingsModal.tsx";
import { applyTheme, loadInitialTheme, type ThemeName } from "../utils/theme.ts";
import { ShortcutPrefix, getShortcutPrefix, getDefaultShortcutPrefix, setShortcutPrefix, formatShortcutForDisplay } from "../utils/shortcuts.ts";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useErrorStore } from "../store/errorStore.tsx";
import { PaneManager } from "../components/paneManager/index.ts";
import { DashboardPaneWithProvider } from "../components/DashboardPane.tsx";

export function Dashboard() {
  const apiResourceStore = useApiResourceStore();
  const errorStore = useErrorStore();
  
  // Header / settings
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [theme, setTheme] = createSignal<ThemeName>(loadInitialTheme());
  const [viewShortcutModifier, setViewShortcutModifier] = createSignal<ShortcutPrefix>(
    typeof globalThis !== 'undefined' ? getShortcutPrefix() : getDefaultShortcutPrefix()
  );
  
  let contextDropdownRef: HTMLDivElement | undefined;

  // Watch status in header - updated by PaneManager
  const [watchStatus, setWatchStatus] = createSignal("●");
  
  // Cache of pane filter states - updated by providers, used to restore state after tree changes
  const paneFilterCache = new Map<number, ActiveFilter[]>();
  
  // Update cache when pane filters change
  const handlePaneFilterChange = (paneKey: number, filters: ActiveFilter[]) => {
    paneFilterCache.set(paneKey, filters);
  };

  // Function to switch to a new context
  const handleContextSwitch = async (contextName: string) => {
    if (contextName === apiResourceStore.contextInfo?.current) {
      setContextMenuOpen(false);
      return;
    }
    
    try {
      await apiResourceStore.switchContext(contextName);
      setContextMenuOpen(false);
    } catch (error) {
      console.error("Error switching context in dashboard:", error);
      
      // Show error to user when context switch fails
      const errorMessage = error instanceof Error ? error.message : 'Failed to switch context';
      console.log('Processing context switch error:', errorMessage);
      errorStore.setApiError(`Context switch failed: ${errorMessage}`);
      setContextMenuOpen(false);
    }
  };
  
  // Handle clicks outside the context dropdown
  const handleOutsideClick = (e: MouseEvent) => {
    if (contextDropdownRef && !contextDropdownRef.contains(e.target as Node)) {
      setContextMenuOpen(false);
    }
  };
  
  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    applyTheme(theme());
  });
  
  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
  });

  createEffect(() => {
    setShortcutPrefix(viewShortcutModifier());
  });

  return (
    <div class="layout">
      <main class="main-content">
        <div class="header-section">
          {/* Context display on the left */}
          <Show when={apiResourceStore.contextInfo}>
            <div class="context-dropdown" ref={contextDropdownRef}>
              <div 
                class="context-display" 
                onClick={() => setContextMenuOpen(!contextMenuOpen())}
              >
                <span class="context-label">Current Context:</span>
                <span class="context-name">{apiResourceStore.contextInfo?.current}</span>
                <span class="context-dropdown-arrow">▼</span>
                <Show when={watchStatus}>
                  <span
                    classList={{ 
                      "watch-status": true, 
                      "error": watchStatus() !== "●" 
                    }}
                  >
                    {watchStatus()}
                  </span>
                </Show>
              </div>
              
              <Show when={contextMenuOpen()}>
                <div class="context-menu">
                  {apiResourceStore.contextInfo?.contexts.map(context => (
                    <div 
                      class={`context-menu-item ${context.isCurrent ? 'active' : ''}`}
                      onClick={() => handleContextSwitch(context.name)}
                    >
                      <span class="context-menu-name">{context.name}</span>
                      {context.clusterName && (
                        <span class="context-menu-details">
                          Cluster: {context.clusterName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Show>
            </div>
          </Show>
          
          {/* Right-aligned settings button */}
        <div style={{ "flex-grow": 1 }} />
          <button type="button" class="settings-button" title="Settings" onClick={() => setSettingsOpen(true)}>⚙︎</button>
        </div>

        <Show when={settingsOpen()}>
          <SettingsModal
            open
            onClose={() => setSettingsOpen(false)}
            theme={theme()}
            onChangeTheme={(t) => { setTheme(t); applyTheme(t); }}
            viewShortcutModifier={viewShortcutModifier()}
            onChangeViewShortcutModifier={(m) => setViewShortcutModifier(m as ShortcutPrefix)}
          />
        </Show>

        {/* Panes container */}
        <PaneManager
          onStatusChange={setWatchStatus}
          renderPane={(paneProps) => (
            <DashboardPaneWithProvider
              paneKey={paneProps.paneKey}
              focused={paneProps.focused}
              onFocus={paneProps.onFocus}
              onStatusChange={paneProps.onStatusChange}
              onSplit={paneProps.onSplit}
              onClose={paneProps.onClose}
              paneFilterCache={paneFilterCache}
              onPaneFilterChange={handlePaneFilterChange}
            />
          )}
        />
      </main>
    </div>
  );
}
