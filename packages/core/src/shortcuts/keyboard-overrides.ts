/**
 * Per-device keyboard overrides (BUG-044).
 *
 * A rebound key is a property of THIS keyboard, not of an account. The
 * overrides therefore persist on the device — `userData/settings.json` on the
 * desktop, `localStorage` on the web — and an account, where a distribution
 * ships one, only syncs them.
 *
 * The parser lives in the shared package because both processes read the same
 * bytes: Electron main validates the IPC payload before it writes the file,
 * and the renderer validates whatever it reads back. `electron/` cannot import
 * `src/`, and a second hand-rolled validator is how the two drift apart.
 */

import type { CommandVerbBinding, CommandVerbKeys } from './command-verbs';

export const KEYBOARD_OVERRIDE_SCHEMA_VERSION = 1 as const;

/** The most overrides one device may store. A keyboard has a finite number of
 *  useful combos; a larger array is a bug or a hostile write, never taste. */
export const MAX_KEYBOARD_OVERRIDES = 256;

const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta']);
const MAX_KEY_CHARS = 32;
const MAX_SHORTCUT_ID_CHARS = 128;

export interface KeyboardShortcutOverrideV1 {
  shortcutId: string;
  keys: CommandVerbKeys;
}

export interface KeyboardShortcutOverridesV1 {
  schemaVersion: typeof KEYBOARD_OVERRIDE_SCHEMA_VERSION;
  overrides: KeyboardShortcutOverrideV1[];
}

export function emptyKeyboardShortcutOverrides(): KeyboardShortcutOverridesV1 {
  return { schemaVersion: KEYBOARD_OVERRIDE_SCHEMA_VERSION, overrides: [] };
}

function parseBinding(raw: unknown): CommandVerbBinding | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const key = candidate.key;
  if (typeof key !== 'string' || !key || key.length > MAX_KEY_CHARS) {
    return null;
  }
  if (candidate.modifiers === undefined) return { key };
  if (!Array.isArray(candidate.modifiers)) return null;
  const modifiers: CommandVerbBinding['modifiers'] = [];
  for (const modifier of candidate.modifiers) {
    if (typeof modifier !== 'string' || !MODIFIERS.has(modifier)) return null;
    const typed = modifier as NonNullable<
      CommandVerbBinding['modifiers']
    >[number];
    if (!modifiers.includes(typed)) modifiers.push(typed);
  }
  return { key, modifiers };
}

function parseKeys(raw: unknown): CommandVerbKeys | null {
  if (Array.isArray(raw)) {
    if (raw.length !== 2) return null;
    const first = parseBinding(raw[0]);
    const second = parseBinding(raw[1]);
    return first && second ? [first, second] : null;
  }
  return parseBinding(raw);
}

function parseOverride(raw: unknown): KeyboardShortcutOverrideV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const shortcutId = candidate.shortcutId;
  if (
    typeof shortcutId !== 'string' ||
    !shortcutId ||
    shortcutId.length > MAX_SHORTCUT_ID_CHARS
  ) {
    return null;
  }
  const keys = parseKeys(candidate.keys);
  return keys ? { shortcutId, keys } : null;
}

/**
 * Total: anything unrecognizable degrades to "no overrides" rather than
 * throwing. A malformed settings file must never be able to stop the app from
 * starting, and a rejected entry must never take a valid sibling with it.
 * Later entries win, matching the registry's own last-write-wins map.
 */
export function parseKeyboardShortcutOverrides(
  raw: unknown
): KeyboardShortcutOverridesV1 {
  if (!raw || typeof raw !== 'object') return emptyKeyboardShortcutOverrides();
  const candidate = Array.isArray(raw)
    ? { overrides: raw }
    : (raw as Record<string, unknown>);
  if (
    !Array.isArray(candidate.overrides) ||
    (candidate.schemaVersion !== undefined &&
      candidate.schemaVersion !== KEYBOARD_OVERRIDE_SCHEMA_VERSION)
  ) {
    return emptyKeyboardShortcutOverrides();
  }
  const byId = new Map<string, KeyboardShortcutOverrideV1>();
  for (const entry of candidate.overrides) {
    const parsed = parseOverride(entry);
    if (parsed) byId.set(parsed.shortcutId, parsed);
  }
  return {
    schemaVersion: KEYBOARD_OVERRIDE_SCHEMA_VERSION,
    overrides: Array.from(byId.values()).slice(0, MAX_KEYBOARD_OVERRIDES),
  };
}
