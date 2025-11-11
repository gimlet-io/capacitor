// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createMemo, onMount, onCleanup, Index, For, JSX } from "solid-js";
import { keyboardManager } from "../../utils/keyboardManager.ts";

// Types
export type Orientation = 'horizontal' | 'vertical';
export type PaneNode = {
  type: 'pane';
  key: number;
} | {
  type: 'split';
  orientation: Orientation;
  children: PaneNode[];
};

export interface PaneManagerProps {
  // Initial pane tree structure
  initialTree?: PaneNode;
  // Render function for each pane
  renderPane: (props: {
    paneKey: number;
    focused: boolean;
    onFocus: () => void;
    onStatusChange: (status: string) => void;
    onSplit: (orientation: Orientation) => void;
    onClose: () => void;
  }) => JSX.Element;
  // Callback when a pane is split (parent can use this to initialize new pane state)
  onPaneSplit?: (originalPaneKey: number, newPaneKey: number, orientation: Orientation) => void;
  // Callback when active pane changes
  onActivePaneChange?: (paneKey: number) => void;
  // Callback to get aggregated status (e.g., for header display)
  onStatusChange?: (status: string) => void;
}

export function PaneManager(props: PaneManagerProps) {
  // Pane tree structure
  const [paneTree, setPaneTree] = createSignal<PaneNode>(
    props.initialTree || {
      type: 'split',
      orientation: 'horizontal',
      children: [
        { type: 'pane', key: 0 },
        { type: 'pane', key: 1 }
      ]
    }
  );
  
  const [activePaneKey, setActivePaneKey] = createSignal(0);
  const [paneStatuses, setPaneStatuses] = createSignal<Record<number, string>>({});
  
  // Store pane sizes separately to avoid re-creating pane objects
  // Key format: "path:orientation" e.g. "0,1:horizontal"
  const [paneSizes, setPaneSizes] = createSignal<Record<string, number[]>>({});
  
  // Resize state
  const [resizing, setResizing] = createSignal<{
    startPos: number;
    startSizes: number[];
    resizeIndices: [number, number];
    orientation: Orientation;
    parentPath: number[];
  } | null>(null);
  
  // Notify parent of active pane changes
  createMemo(() => {
    const activeKey = activePaneKey();
    props.onActivePaneChange?.(activeKey);
  });
  
  // Notify parent of status changes
  createMemo(() => {
    const status = paneStatuses()[activePaneKey()] || "●";
    props.onStatusChange?.(status);
  });
  
  // Helper functions for tree manipulation
  const findAndReplacePaneWithSplit = (node: PaneNode, targetKey: number, orientation: Orientation, newKey: number): PaneNode => {
    if (node.type === 'pane') {
      if (node.key === targetKey) {
        return {
          type: 'split',
          orientation,
          children: [
            { type: 'pane', key: node.key },
            { type: 'pane', key: newKey }
          ]
        };
      }
      return node;
    }
    
    return {
      ...node,
      children: node.children.map(child => findAndReplacePaneWithSplit(child, targetKey, orientation, newKey))
    };
  };
  
  const findAndRemovePane = (node: PaneNode, targetKey: number): PaneNode | null => {
    if (node.type === 'pane') {
      return node.key === targetKey ? null : node;
    }
    
    const newChildren = node.children
      .map(child => findAndRemovePane(child, targetKey))
      .filter((child): child is PaneNode => child !== null);
    
    // If only one child left, collapse the split
    if (newChildren.length === 1) {
      return newChildren[0];
    }
    
    // If no children left, remove this split
    if (newChildren.length === 0) {
      return null;
    }
    
    return {
      ...node,
      children: newChildren
    };
  };
  
  const findFirstPaneKey = (node: PaneNode): number | null => {
    if (node.type === 'pane') {
      return node.key;
    }
    if (node.children.length > 0) {
      return findFirstPaneKey(node.children[0]);
    }
    return null;
  };
  
  const getAllPaneKeys = (node: PaneNode): number[] => {
    if (node.type === 'pane') {
      return [node.key];
    }
    return node.children.flatMap(child => getAllPaneKeys(child));
  };
  
  // Find the path (indices) to a pane by key
  const findPanePath = (node: PaneNode, targetKey: number, path: number[] = []): number[] | null => {
    if (node.type === 'pane') {
      return node.key === targetKey ? path : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const found = findPanePath(child, targetKey, [...path, i]);
      if (found) return found;
    }
    return null;
  };
  
  // Get a node by path
  const getNodeAtPath = (node: PaneNode, path: number[]): PaneNode | null => {
    let current: PaneNode | null = node;
    for (const idx of path) {
      if (!current || current.type !== 'split') return null;
      current = current.children[idx] ?? null;
    }
    return current;
  };
  
  // Choose next active pane when target is closed
  const chooseNextActivePaneKeyBeforeRemoval = (root: PaneNode, targetKey: number): number | null => {
    const path = findPanePath(root, targetKey);
    if (!path || path.length === 0) return null;
    const parentPath = path.slice(0, -1);
    const idx = path[path.length - 1];
    const parent = getNodeAtPath(root, parentPath);
    if (!parent || parent.type !== 'split') return null;
    
    // Try next sibling
    if (idx + 1 < parent.children.length) {
      const nextSibling = parent.children[idx + 1];
      const nextKey = findFirstPaneKey(nextSibling);
      if (nextKey !== null) return nextKey;
    }
    
    // Fallback to previous sibling
    if (idx - 1 >= 0) {
      const prevSibling = parent.children[idx - 1];
      const prevKey = findFirstPaneKey(prevSibling);
      if (prevKey !== null) return prevKey;
    }
    
    return null;
  };
  
  // Split a pane
  const splitPane = (paneKey: number, orientation: Orientation) => {
    const newKey = Date.now();
    
    // Notify parent FIRST so it can initialize the new pane's state
    // before the tree update triggers component creation
    props.onPaneSplit?.(paneKey, newKey, orientation);
    
    setPaneTree(prev => findAndReplacePaneWithSplit(prev, paneKey, orientation, newKey));
    setActivePaneKey(newKey);
  };
  
  // Close a pane
  const closePane = (targetKey?: number) => {
    const keyToClose = targetKey ?? activePaneKey();
    const allKeys = getAllPaneKeys(paneTree());
    if (allKeys.length <= 1) return; // Don't close last pane
    
    const preferredNextKey = chooseNextActivePaneKeyBeforeRemoval(paneTree(), keyToClose);
    const newTree = findAndRemovePane(paneTree(), keyToClose);
    
    if (newTree) {
      setPaneTree(newTree);
      const fallbackKey = findFirstPaneKey(newTree);
      const nextKey = preferredNextKey ?? fallbackKey;
      if (nextKey !== null) setActivePaneKey(nextKey);
      
      // Clean up pane state when closing
      setPaneStates(prev => {
        const newStates = { ...prev };
        delete newStates[keyToClose];
        return newStates;
      });
    }
  };
  
  // Resize handlers
  const handleResizeStart = (e: MouseEvent, idx: number, orientation: Orientation, parentPath: number[]) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    
    const children = Array.from(container.children).filter(el => 
      el.classList.contains('pane-wrapper') || el.classList.contains('panes-container')
    );
    if (idx >= children.length - 1) return;
    
    // Capture ALL sibling sizes to lock the layout
    const allSizes = children.map(child => {
      const el = child as HTMLElement;
      return orientation === 'horizontal' ? el.offsetHeight : el.offsetWidth;
    });
    
    const startPos = orientation === 'horizontal' ? e.clientY : e.clientX;
    
    setResizing({
      startPos,
      startSizes: allSizes,
      resizeIndices: [idx, idx + 1],
      orientation,
      parentPath
    });
  };
  
  const handleResizeMove = (e: MouseEvent) => {
    const resize = resizing();
    if (!resize) return;
    
    const currentPos = resize.orientation === 'horizontal' ? e.clientY : e.clientX;
    const delta = currentPos - resize.startPos;
    
    const [idx1, idx2] = resize.resizeIndices;
    const totalSizeOfPair = resize.startSizes[idx1] + resize.startSizes[idx2];
    const newSize1 = Math.max(50, Math.min(totalSizeOfPair - 50, resize.startSizes[idx1] + delta));
    const newSize2 = totalSizeOfPair - newSize1;
    
    // Build new sizes array with all siblings
    const newSizes = [...resize.startSizes];
    newSizes[idx1] = newSize1;
    newSizes[idx2] = newSize2;
    
    // Store sizes separately to avoid re-creating pane objects
    const pathKey = resize.parentPath.join(',');
    setPaneSizes(prev => ({
      ...prev,
      [pathKey]: newSizes
    }));
  };
  
  const handleResizeEnd = () => {
    setResizing(null);
  };
  
  // Keyboard shortcuts
  onMount(() => {
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    
    const unregister = keyboardManager.register({
      id: 'pane-manager',
      priority: 0,
      ignoreInInput: true,
      handler: (e: KeyboardEvent) => {
        const hasAnyMod = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
        
        // Split vertical: Mod + |
        if ((e.key === '|' || e.key === '\\') && hasAnyMod) {
          e.preventDefault();
          splitPane(activePaneKey(), 'vertical');
          return true;
        }
        
        // Split horizontal: Mod + -
        if (e.key === '-' && hasAnyMod) {
          e.preventDefault();
          splitPane(activePaneKey(), 'horizontal');
          return true;
        }
        
        // Close current pane: Mod + x
        if ((e.key === 'x' || e.key === 'X') && hasAnyMod) {
          e.preventDefault();
          closePane(activePaneKey());
          return true;
        }
        
        return false;
      }
    });
    
    onCleanup(() => {
      unregister();
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    });
  });
  
  // Create a memo that generates a unique key whenever the tree structure changes
  const treeKey = createMemo(() => {
    const tree = paneTree();
    const getNodeKey = (node: PaneNode): string => {
      if (node.type === 'pane') {
        return `pane-${node.key}`;
      }
      const childKeys = node.children.map(c => getNodeKey(c)).join('|');
      return `split-${node.orientation}-${childKeys}`;
    };
    return getNodeKey(tree);
  });
  
  // Component wrapper for a pane node
  function PaneNodeWrapper(wrapperProps: { node: PaneNode; path: number[]; childIndex: number }) {
    // Memo to read size reactively only for this specific pane
    const size = createMemo(() => {
      if (wrapperProps.path.length > 0) {
        const parentPathKey = wrapperProps.path.slice(0, -1).join(',');
        const sizes = paneSizes()[parentPathKey];
        return sizes?.[wrapperProps.childIndex];
      }
      return undefined;
    });
    
    const style = createMemo(() => {
      const s = size();
      return s !== undefined 
        ? { 'flex': `0 0 ${s}px` } 
        : { 'flex': '1 1 0px' };
    });
    
    if (wrapperProps.node.type === 'pane') {
      const paneKey = wrapperProps.node.key;
      const focused = createMemo(() => paneKey === activePaneKey());
      
      return (
        <div style={style()} class="pane-wrapper">
          {props.renderPane({
            paneKey,
            focused: focused(),
            onFocus: () => setActivePaneKey(paneKey),
            onStatusChange: (status: string) => {
              setPaneStatuses(prev => ({ ...prev, [paneKey]: status }));
            },
            onSplit: (orientation: Orientation) => splitPane(paneKey, orientation),
            onClose: () => closePane(paneKey)
          })}
        </div>
      );
    }
    
    // It's a split container
    return (
      <div style={style()} class="pane-wrapper">
        <div classList={{
          "panes-container": true,
          "horizontal": wrapperProps.node.orientation === 'horizontal',
          "vertical": wrapperProps.node.orientation === 'vertical',
        }}>
          <Index each={wrapperProps.node.children}>
            {(child, idx) => (
              <>
                <PaneNodeWrapper
                  node={child()}
                  path={[...wrapperProps.path, idx]}
                  childIndex={idx}
                />
                <Show when={idx < wrapperProps.node.children.length - 1}>
                  <div 
                    classList={{
                      "pane-divider": true,
                      "pane-divider-horizontal": wrapperProps.node.orientation === 'horizontal',
                      "pane-divider-vertical": wrapperProps.node.orientation === 'vertical',
                    }}
                    onMouseDown={(e) => handleResizeStart(e, idx, wrapperProps.node.orientation, wrapperProps.path)}
                  />
                </Show>
              </>
            )}
          </Index>
        </div>
      </div>
    );
  }
  
  // Use For with treeKey to force re-render when tree structure changes
  // This ensures PaneNodeWrapper re-executes with the new tree
  return (
    <For each={[{ key: treeKey(), tree: paneTree() }]}>
      {(item) => <PaneNodeWrapper node={item.tree} path={[]} childIndex={0} />}
    </For>
  );
}

