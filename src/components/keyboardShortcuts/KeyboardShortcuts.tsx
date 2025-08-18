import { Show } from "solid-js";

export interface KeyboardShortcut {
  key: string;
  description: string;
  isContextual?: boolean;
  disabled?: boolean;
}

export function KeyboardShortcuts(props: {
  shortcuts: KeyboardShortcut[];
  resourceSelected: boolean;
}) {
  return (
    <div class="keyboard-shortcut-container">
      {props.shortcuts.map(shortcut => (
        <Show when={!shortcut.isContextual || props.resourceSelected}>
          <div class={`keyboard-shortcut ${shortcut.disabled ? 'disabled' : ''}`} title={shortcut.disabled ? 'Not permitted' : undefined}>
            <span class={`shortcut-key ${shortcut.disabled ? 'disabled' : ''}`}>{shortcut.key}</span>
            <span class={`shortcut-description ${shortcut.disabled ? 'disabled' : ''}`}>{shortcut.description}</span>
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
