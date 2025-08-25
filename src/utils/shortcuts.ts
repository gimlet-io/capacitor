import { createSignal } from "solid-js";

export type ShortcutPrefix = string; // e.g., "Ctrl", "Alt", "Meta", "Ctrl+Alt", "Meta+Shift"

const STORAGE_KEY_PREFIX = 'ui.shortcut.prefix';
const STORAGE_KEY_LEGACY = 'ui.shortcut.modifier';

export function isMacPlatform(): boolean {
  try {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  } catch {
    return false;
  }
}

export function getDefaultShortcutPrefix(): ShortcutPrefix {
  return isMacPlatform() ? 'Ctrl+Shift' : 'Ctrl';
}

function normalizeToken(token: string): 'Ctrl' | 'Alt' | 'Meta' | 'Shift' | null {
  const t = token.trim().toLowerCase();
  if (t === 'ctrl' || t === 'control') return 'Ctrl';
  if (t === 'alt' || t === 'option' || t === 'opt') return 'Alt';
  if (t === 'meta' || t === 'cmd' || t === 'command') return 'Meta';
  if (t === 'shift') return 'Shift';
  return null;
}

function normalizePrefixString(prefix: string): ShortcutPrefix {
  const parts = String(prefix || '')
    .split('+')
    .map(normalizeToken)
    .filter((t): t is NonNullable<ReturnType<typeof normalizeToken>> => !!t);
  const unique: Record<string, boolean> = {};
  for (const p of parts) unique[p] = true;
  const order: Array<'Meta' | 'Ctrl' | 'Alt' | 'Shift'> = ['Meta', 'Ctrl', 'Alt', 'Shift'];
  const ordered = order.filter(k => unique[k]);
  return ordered.join('+') || getDefaultShortcutPrefix();
}

export function getShortcutPrefix(): ShortcutPrefix {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY_PREFIX);
    if (stored) return normalizePrefixString(stored);
    const legacy = globalThis.localStorage?.getItem(STORAGE_KEY_LEGACY);
    if (legacy) return normalizePrefixString(legacy);
  } catch {
    // ignore
  }
  return getDefaultShortcutPrefix();
}

// SolidJS reactive signal for the current shortcut prefix
const [shortcutPrefixSignal, setShortcutPrefixSignal] = createSignal<ShortcutPrefix>(getShortcutPrefix());

export function shortcutPrefix(): ShortcutPrefix {
  return shortcutPrefixSignal();
}

export function setShortcutPrefix(prefix: ShortcutPrefix) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY_PREFIX, normalizePrefixString(prefix));
  } catch {
    // ignore
  }
  // update reactive signal
  try {
    setShortcutPrefixSignal(normalizePrefixString(prefix));
  } catch {
    // ignore
  }
  try {
    globalThis.dispatchEvent(new CustomEvent('shortcut-prefix-changed'));
  } catch {
    // ignore
  }
}

function eventMatchesPrefix(e: KeyboardEvent, prefix: ShortcutPrefix): boolean {
  const normalized = normalizePrefixString(prefix);
  const needCtrl = normalized.includes('Ctrl');
  const needAlt = normalized.includes('Alt');
  const needMeta = normalized.includes('Meta');
  const needShift = normalized.includes('Shift');
  // Required-subset match: required modifiers must be present; extra modifiers allowed
  if (needCtrl && !e.ctrlKey) return false;
  if (needAlt && !e.altKey) return false;
  if (needMeta && !e.metaKey) return false;
  if (needShift && !e.shiftKey) return false;
  return needCtrl || needAlt || needMeta || needShift;
}

export function doesEventMatchShortcut(e: KeyboardEvent, shortcutKey: string): boolean {
  const normalized = shortcutKey.trim().toLowerCase();
  const hasModifier = normalized.includes('+');
  if (!hasModifier) {
    return e.key.toLowerCase() === normalized && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
  }

  const [prefix, keyPartRaw] = normalized.split('+', 2);
  const keyPart = keyPartRaw;
  let modifierOk = false;
  if (prefix === 'mod') {
    // Try the configured prefix first, then allow common platform variants
    const configured = getShortcutPrefix();
    const candidates: ShortcutPrefix[] = [configured];
    if (!candidates.includes('Meta')) candidates.push('Meta');
    if (!candidates.includes('Ctrl')) candidates.push('Ctrl');
    modifierOk = candidates.some(c => eventMatchesPrefix(e, c));
  } else {
    const explicit = normalizePrefixString(prefix);
    modifierOk = eventMatchesPrefix(e, explicit);
  }
  if (!modifierOk) return false;

  // Support arrows named as 'arrowleft', 'arrowright', etc.
  const eventKey = (e.key || '').toLowerCase();
  const targetKey = keyPart.toLowerCase();
  if (targetKey.startsWith('arrow')) {
    return eventKey === targetKey;
  }
  // Allow unicode arrows in display mapping: ← → ↑ ↓
  if (targetKey === '←') return eventKey === 'arrowleft';
  if (targetKey === '→') return eventKey === 'arrowright';
  if (targetKey === '↑') return eventKey === 'arrowup';
  if (targetKey === '↓') return eventKey === 'arrowdown';
  return eventKey === targetKey;
}

function iconsForPrefix(prefix: ShortcutPrefix): string {
  const n = normalizePrefixString(prefix);
  const parts = n.split('+');
  const iconMap: Record<string, string> = { Meta: '⌘', Alt: '⌥', Ctrl: '⌃', Shift: '⇧' };
  return parts.map(p => iconMap[p] || p).join('+');
}

export function formatShortcutForDisplay(shortcutKey: string): string {
  const normalized = shortcutKey.trim();
  // Replace any leading 'Ctrl+' or 'Mod+' or 'Meta+'/'Alt+' with our current icon
  const idx = normalized.indexOf('+');
  if (idx > 0) {
    const prefix = normalized.slice(0, idx);
    const rest = normalized.slice(idx + 1);
    const actualPrefix = prefix.toLowerCase() === 'mod' ? shortcutPrefixSignal() : prefix;
    return `${iconsForPrefix(actualPrefix)}+${rest}`;
  }
  // No modifier: return as-is
  return normalized;
}

export function subscribeShortcutPrefix(listener: () => void): () => void {
  const handler = () => listener();
  try {
    globalThis.addEventListener('shortcut-prefix-changed', handler as EventListener);
  } catch {
    // ignore
  }
  return () => {
    try {
      globalThis.removeEventListener('shortcut-prefix-changed', handler as EventListener);
    } catch {
      // ignore
    }
  };
}


