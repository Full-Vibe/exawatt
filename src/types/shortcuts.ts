/** Modifier keys that can be combined with key presses */
export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta';

/** Single key binding - can be a single key or key with modifiers */
export interface KeyBinding {
  key: string; // e.g., 'k', 'Enter', 'Escape'
  modifiers?: ModifierKey[]; // e.g., ['meta'] for Cmd+K
}

/** Chord sequence - multiple key bindings pressed in sequence, or a single binding */
export type ShortcutKeys = KeyBinding | [KeyBinding, KeyBinding];

/** Context in which a shortcut is active */
export type ShortcutContext =
  | 'global' // Always active
  | 'command-palette' // Inside command palette
  | 'modal-open' // When any modal is open
  // NEVER activated in the chord engine: workspace verbs are executed by the
  // workspace key layer (the only layer that can see keystrokes inside
  // xterm). Registering them under this context makes them rebindable,
  // conflict-checked, and help-listed without ever double-firing (ENG-016 D9).
  | 'workspace';

/** Category for organizing shortcuts in help modal */
export type ShortcutCategory =
  | 'workspace'
  | 'navigation'
  | 'actions'
  | 'view'
  | 'help';

/** Behavioral guarantee a customized binding must preserve. */
export type ShortcutBindingPolicy =
  | 'universal-command'; // One primary-modifier combo; works through text/xterm focus.

/** Complete shortcut definition (without action - for registration) */
export interface ShortcutDefinition {
  id: string; // Unique identifier, e.g., 'go-workspace'
  keys: ShortcutKeys; // Key binding(s)
  label: string; // Human-readable label
  description?: string; // Detailed description
  category: ShortcutCategory; // For help modal organization
  contexts: ShortcutContext[]; // Where this shortcut is active
  bindingPolicy?: ShortcutBindingPolicy;
}

/** Shortcut with action callback (runtime) */
export interface Shortcut extends ShortcutDefinition {
  action: () => void | Promise<void>; // What to execute
  enabled?: boolean; // Dynamic enable/disable
}

/** User override for a shortcut (stored in database) */
export interface ShortcutOverride {
  shortcutId: string;
  keys: ShortcutKeys;
}

/** Chord state for tracking multi-key sequences */
export interface ChordState {
  pending: KeyBinding | null; // First key in chord sequence
  timestamp: number; // When chord started
}

/** Check if keys is a chord (array of two bindings) */
export function isChord(keys: ShortcutKeys): keys is [KeyBinding, KeyBinding] {
  return Array.isArray(keys) && keys.length === 2;
}

/** Check if two key bindings match */
export function bindingsMatch(a: KeyBinding, b: KeyBinding): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;
  const aModifiers = new Set(a.modifiers || []);
  const bModifiers = new Set(b.modifiers || []);
  if (aModifiers.size !== bModifiers.size) return false;
  for (const mod of aModifiers) {
    if (!bModifiers.has(mod)) return false;
  }
  return true;
}
