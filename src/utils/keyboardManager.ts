// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

type KeyboardHandler = {
  id: string;
  priority: number; // Lower number = higher priority (0 = highest)
  handler: (e: KeyboardEvent) => boolean | void; // Return true to stop propagation
  ignoreInInput?: boolean; // If true, don't call handler when in input/textarea
};

class KeyboardManager {
  private handlers: KeyboardHandler[] = [];
  private isSetup = false;

  constructor() {
    this.handleGlobalKeyDown = this.handleGlobalKeyDown.bind(this);
  }

  setup() {
    if (this.isSetup) return;
    // Use capture phase (true) to intercept before browser handles it
    globalThis.addEventListener('keydown', this.handleGlobalKeyDown, true);
    this.isSetup = true;
  }

  cleanup() {
    if (!this.isSetup) return;
    globalThis.removeEventListener('keydown', this.handleGlobalKeyDown, true);
    this.isSetup = false;
  }

  register(handler: KeyboardHandler): () => void {
    this.handlers.push(handler);
    // Sort by priority (lower number = higher priority)
    this.handlers.sort((a, b) => a.priority - b.priority);
    
    // Return unregister function
    return () => {
      this.handlers = this.handlers.filter(h => h.id !== handler.id);
    };
  }

  private shouldIgnoreKeyboardEvents(): boolean {
    // Ignore keyboard events when:
    // 1. Any input element is focused
    // 2. Any .filter-options element is visible in the DOM
    if (document.activeElement instanceof HTMLInputElement || 
        document.activeElement instanceof HTMLTextAreaElement) {
      return true;
    }
    
    // Check if any filter dropdown is open
    const openFilterOptions = document.querySelector('.filter-options');
    if (openFilterOptions) {
      return true;
    }
    
    return false;
  }

  private handleGlobalKeyDown(e: KeyboardEvent) {
    // Check if we should ignore keyboard events globally
    const shouldIgnore = this.shouldIgnoreKeyboardEvents();
    
    // Let each handler process the event in priority order
    for (const handler of this.handlers) {
      // Skip handlers that want to be ignored in inputs
      if (shouldIgnore && handler.ignoreInInput) {
        continue;
      }
      
      try {
        const shouldStop = handler.handler(e);
        if (shouldStop) {
          break; // Stop processing if handler returns true
        }
      } catch (err) {
        console.error(`Error in keyboard handler ${handler.id}:`, err);
      }
    }
  }
}

// Singleton instance
export const keyboardManager = new KeyboardManager();

