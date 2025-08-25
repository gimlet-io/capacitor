import { onCleanup, createEffect } from "solid-js";
import { Portal } from "solid-js/web";
import type { ThemeName } from "../../utils/theme.ts";
import { getShortcutPrefix, setShortcutPrefix } from "../../utils/shortcuts.ts";

export function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  theme: ThemeName;
  onChangeTheme: (theme: ThemeName) => void;
  viewShortcutModifier: string;
  onChangeViewShortcutModifier: (m: string) => void;
}) {

  let lastPrefix: string | null = null;

  const _getModifierLabel = (value: 'Ctrl' | 'Alt' | 'Meta') => {
    if (value === 'Alt') {
      try {
        return (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) ? 'Option' : 'Alt';
      } catch {
        return 'Alt';
      }
    }
    if (value === 'Meta') return 'Cmd';
    return 'Ctrl';
  };

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target && (e.target as HTMLElement).classList.contains('settings-modal-backdrop')) {
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    }
  };

  createEffect(() => {
    if (props.open) {
      globalThis.addEventListener('keydown', handleKeyDown);
    } else {
      globalThis.removeEventListener('keydown', handleKeyDown);
    }
  });

  onCleanup(() => {
    globalThis.removeEventListener('keydown', handleKeyDown);
  });

  if (!props.open) return null;

  return (
    <Portal>
      <div class="settings-modal-backdrop" onClick={handleBackdropClick}>
        <div class="settings-modal" role="dialog" aria-modal="true">
          <div class="settings-header">
            <div class="settings-title">Settings</div>
            <button type="button" class="settings-close" onClick={props.onClose}>×</button>
          </div>
          <div class="settings-content">
            <table class="settings-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="settings-key">Theme</td>
                  <td class="settings-value">
                    <select
                      value={props.theme}
                      onChange={(e) => props.onChangeTheme(e.currentTarget.value as ThemeName)}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="mallow">Mallow</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td class="settings-key">Shortcut prefix</td>
                  <td class="settings-value">
                    <input
                      type="text"
                      value={getShortcutPrefix()}
                      onFocus={(e) => {
                        lastPrefix = getShortcutPrefix();
                        e.currentTarget.value = '';
                      }}
                      onBlur={(e) => {
                        if (!e.currentTarget.value.trim()) {
                          e.currentTarget.value = lastPrefix || getShortcutPrefix();
                        }
                      }}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        const parts: string[] = [];
                        if (e.metaKey) parts.push('Meta');
                        if (e.ctrlKey) parts.push('Ctrl');
                        if (e.altKey) parts.push('Alt');
                        if (e.shiftKey) parts.push('Shift');
                        const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
                        const prefix = parts.join('+') || (isMac ? 'Alt' : 'Ctrl');
                        setShortcutPrefix(prefix);
                        props.onChangeViewShortcutModifier(prefix);
                        e.currentTarget.value = prefix;
                      }}
                      placeholder="Press modifier keys (e.g., Ctrl+Alt)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Portal>
  );
}


