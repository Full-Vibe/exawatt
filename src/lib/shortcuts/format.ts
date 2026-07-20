import type { ShortcutKeys, KeyBinding, ModifierKey } from '@/types/shortcuts';
import { isChord } from '@/types/shortcuts';

const MODIFIER_SYMBOLS: Record<ModifierKey, string> = {
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
};

const KEY_DISPLAY: Record<string, string> = {
  Enter: '↵',
  Escape: 'esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'space',
  Backspace: '⌫',
  Delete: 'del',
  Tab: '⇥',
};

/** Format a single key binding for display */
export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];

  if (binding.modifiers) {
    // Sort modifiers consistently: meta, ctrl, alt, shift
    const order: ModifierKey[] = ['meta', 'ctrl', 'alt', 'shift'];
    for (const mod of order) {
      if (binding.modifiers.includes(mod)) {
        parts.push(MODIFIER_SYMBOLS[mod]);
      }
    }
  }

  const keyDisplay = KEY_DISPLAY[binding.key] || binding.key.toUpperCase();
  parts.push(keyDisplay);

  return parts.join('');
}

/** Format shortcut keys (single or chord) for display */
export function formatShortcutKeys(keys: ShortcutKeys): string {
  if (isChord(keys)) {
    return keys.map(formatKeyBinding).join(' ');
  }
  return formatKeyBinding(keys);
}

/** Format for screen readers */
export function formatShortcutKeysAccessible(keys: ShortcutKeys): string {
  const formatBinding = (b: KeyBinding): string => {
    const parts: string[] = [];
    if (b.modifiers) {
      parts.push(
        ...b.modifiers.map(m => m.charAt(0).toUpperCase() + m.slice(1))
      );
    }
    parts.push(b.key);
    return parts.join(' + ');
  };

  if (isChord(keys)) {
    return keys.map(formatBinding).join(' then ');
  }
  return formatBinding(keys);
}

/** WAI-ARIA `aria-keyshortcuts` syntax for single-key commands. Chord
 *  sequences do not have an interoperable representation and are omitted. */
export function formatShortcutKeysAria(keys: ShortcutKeys): string | undefined {
  if (isChord(keys)) return undefined;
  const names: Record<ModifierKey, string> = {
    meta: 'Meta',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
  };
  const parts = (keys.modifiers ?? []).map(modifier => names[modifier]);
  parts.push(keys.key === ' ' ? 'Space' : keys.key);
  return parts.join('+');
}

/** Convert a KeyboardEvent to a KeyBinding */
export function eventToBinding(event: KeyboardEvent): KeyBinding {
  const modifiers: ModifierKey[] = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.altKey) modifiers.push('alt');
  if (event.metaKey) modifiers.push('meta');

  // Digit-row keys match by PHYSICAL position: ⇧1 must resolve to
  // { key: '1', modifiers: ['shift'] }, never to the layout-dependent
  // shifted symbol ('!', '+', …) — otherwise a ⌘⇧1 binding can only be
  // triggered on one keyboard layout (ENG-016 D18).
  const physicalDigit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (physicalDigit !== undefined) {
    if (event.shiftKey) modifiers.push('shift');
    return {
      key: physicalDigit,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
    };
  }

  // Don't add shift as a modifier if the key is already a shifted symbol (like ?, !, @, etc.)
  // This allows defining shortcuts as { key: '?' } instead of { key: '?', modifiers: ['shift'] }
  const isShiftedSymbol =
    event.shiftKey && event.key.length === 1 && !/[a-zA-Z]/.test(event.key);
  if (event.shiftKey && !isShiftedSymbol) {
    modifiers.push('shift');
  }

  return {
    key: event.key,
    modifiers: modifiers.length > 0 ? modifiers : undefined,
  };
}
