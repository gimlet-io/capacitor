import { Show } from "solid-js";

export interface KeyboardShortcut {
  key: string;
  description: string;
  isContextual?: boolean;
}

export function KeyboardShortcuts(props: {
  shortcuts: KeyboardShortcut[];
  resourceSelected: boolean;
}) {
  return (
    <div class="keyboard-shortcut-container">
      {props.shortcuts.map(shortcut => (
        <Show when={!shortcut.isContextual || props.resourceSelected}>
          <div class="keyboard-shortcut">
            <span class="shortcut-key">{shortcut.key}</span>
            <span class="shortcut-description">{shortcut.description}</span>
          </div>
        </Show>
      ))}
    </div>
  );
}

export const getFilterShortcuts = (): KeyboardShortcut[] => [
  { key: "n", description: "Namespace filter" },
  { key: "r", description: "Resource type filter" },
];
