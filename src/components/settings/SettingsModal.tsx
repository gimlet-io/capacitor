import { onCleanup, createEffect, createSignal, Show } from "solid-js";
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
  const [showImport, setShowImport] = createSignal(false);
  const [importText, setImportText] = createSignal("");
  const [message, setMessage] = createSignal<string | null>(null);

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

  const getExportPayload = () => {
    let views: unknown = [];
    try {
      const raw = globalThis.localStorage?.getItem('customViews');
      views = raw ? JSON.parse(raw) : [];
    } catch {
      views = [];
    }
    return {
      version: 1,
      settings: {
        theme: props.theme,
        shortcutPrefix: getShortcutPrefix(),
      },
      views,
    };
  };

  const handleExport = async () => {
    try {
      const json = JSON.stringify(getExportPayload(), null, 2);
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setMessage('Configuration copied to clipboard');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error('Export failed', err);
      setMessage('Export failed');
      setTimeout(() => setMessage(null), 2000);
    }
  };

  type SerializableActiveFilter = { name: string; value: string };
  type SerializableView = { id: string; label: string; filters: SerializableActiveFilter[] };
  type ExportPayload = {
    version: number;
    settings: { theme: ThemeName; shortcutPrefix: string };
    views: SerializableView[];
  };

  const applyImportedData = (data: unknown) => {
    try {
      const payload = data as Partial<ExportPayload>;
      // Settings
      const theme = payload?.settings?.theme as ThemeName | undefined;
      if (theme === 'light' || theme === 'dark' || theme === 'mallow') {
        props.onChangeTheme(theme);
      }
      const prefix = payload?.settings?.shortcutPrefix as string | undefined;
      if (typeof prefix === 'string' && prefix.trim()) {
        setShortcutPrefix(prefix);
        props.onChangeViewShortcutModifier(prefix);
      }

      // Views (custom views only)
      const views = payload?.views;
      if (Array.isArray(views)) {
        try {
          globalThis.localStorage?.setItem('customViews', JSON.stringify(views));
        } catch {
          // ignore storage errors
        }
        try {
          globalThis.dispatchEvent(new CustomEvent('custom-views-changed'));
        } catch {
          // ignore
        }
      }

      setMessage('Configuration imported');
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      console.error('Import apply failed', e);
      setMessage('Import failed');
      setTimeout(() => setMessage(null), 2000);
    }
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText());
      applyImportedData(parsed);
      setShowImport(false);
      setImportText("");
    } catch (e) {
      console.error('Invalid JSON', e);
      setMessage('Invalid JSON');
      setTimeout(() => setMessage(null), 2000);
    }
  };

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
                <tr>
                  <td class="settings-key">Export/Import config</td>
                  <td class="settings-value">
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem', 'flex-wrap': 'wrap' }}>
                      <button type="button" class="action-button" onClick={handleExport}>Export to clipboard</button>
                      <button type="button" class="action-button" onClick={() => setShowImport(!showImport())}>{showImport() ? 'Close import' : 'Import...'}</button>
                      <Show when={message()}>
                        <span style={{ opacity: 0.7 }}>{message()}</span>
                      </Show>
                    </div>
                    <Show when={showImport()}>
                      <div style={{ 'margin-top': '0.5rem' }}>
                        <textarea
                          rows={8}
                          style={{ width: '100%', 'font-family': 'monospace' }}
                          placeholder='Paste exported JSON here'
                          value={importText()}
                          onInput={(e) => setImportText(e.currentTarget.value)}
                        />
                        <div style={{ 'margin-top': '0.5rem', display: 'flex', gap: '0.5rem' }}>
                          <button type="button" class="action-button" onClick={handleImport}>Apply import</button>
                          <button type="button" class="action-button" onClick={() => { setShowImport(false); setImportText(""); }}>Cancel</button>
                        </div>
                      </div>
                    </Show>
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


