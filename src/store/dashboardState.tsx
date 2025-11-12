// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal } from "solid-js";
import type { PaneNode } from "../components/paneManager/PaneManager.tsx";
import type { ActiveFilter } from "../components/filterbar/FilterBar.tsx";

// Persisted dashboard layout and pane-related state across route changes
const [savedPaneTree, setSavedPaneTree] = createSignal<PaneNode | undefined>(undefined);
const [savedPaneSizes, setSavedPaneSizes] = createSignal<Record<string, number[]>>({});
const [savedActivePaneKey, setSavedActivePaneKey] = createSignal<number | undefined>(undefined);
const [savedPaneFilters, setSavedPaneFilters] = createSignal<Record<number, ActiveFilter[]>>({});

export function getInitialPaneTree(): PaneNode | undefined {
  return savedPaneTree();
}

export function getInitialPaneSizes(): Record<string, number[]> {
  return savedPaneSizes();
}

export function getInitialActivePaneKey(): number | undefined {
  return savedActivePaneKey();
}

export function savePaneTree(tree: PaneNode) {
  setSavedPaneTree(tree);
}

export function savePaneSizes(sizes: Record<string, number[]>) {
  setSavedPaneSizes(sizes);
}

export function saveActivePaneKey(key: number) {
  setSavedActivePaneKey(key);
}

export function getSavedPaneFilters(): Record<number, ActiveFilter[]> {
  return savedPaneFilters();
}

export function savePaneFilter(paneKey: number, filters: ActiveFilter[]) {
  setSavedPaneFilters(prev => ({ ...prev, [paneKey]: filters }));
}


