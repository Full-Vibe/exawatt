import type { CommandVerbBinding } from './command-verbs';

/**
 * Convert a key binding to an Electron menu accelerator string
 * (ENG-016 D10): the menu bar mirrors the registry's EFFECTIVE bindings, so
 * a rebind updates what the menus display instead of letting them lie.
 * Returns null for combos a menu cannot express (chords are handled by the
 * caller; here: unknown keys).
 *
 * Lives in the shared package because both processes need it: the renderer
 * to publish effective bindings, and the main process to seed the menu's
 * accelerator column from the same manifest defaults.
 */
const MODIFIER_TO_ELECTRON: Record<string, string> = {
  meta: 'Command',
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
};

/** keys Electron accepts verbatim beyond single letters/digits */
const SPECIAL_KEYS = new Set([
  '[',
  ']',
  '\\',
  ';',
  "'",
  ',',
  '.',
  '/',
  '`',
  '-',
  '=',
  'Enter',
  'Escape',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function bindingToAccelerator(
  binding: CommandVerbBinding
): string | null {
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  const known =
    /^[A-Z0-9]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    SPECIAL_KEYS.has(key);
  if (!known) return null;
  const mods = (binding.modifiers ?? [])
    .map(m => MODIFIER_TO_ELECTRON[m])
    .filter(Boolean);
  return [...mods, key].join('+');
}
