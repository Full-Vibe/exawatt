/**
 * Search shortcuts BY their key combination (ENG-016 FIX-001).
 *
 * `⌘/` exists to answer "what is ⌘⇧T bound to?", and until now it could only
 * be searched by action name — the one question it is for was the one
 * question it could not answer. Matching the formatted string is not enough
 * either: the sheet renders `⌘⇧T`, so a typed "cmd shift t" finds nothing
 * and a lone "t" finds everything.
 *
 * So a query that LOOKS like a chord is parsed as one and matched
 * structurally: same modifier set, same key. Everything else stays plain
 * text search over labels. Written to be forgiving about how a chord gets
 * typed, because the operator is describing keys, not writing a selector:
 *
 *   ⌘⇧T    cmd+shift+t    command shift T    ⌘ shift t    meta-shift-t
 *
 * A bare modifier ("cmd") is a legitimate query too — it lists everything
 * bound under that modifier.
 */
import type { KeyBinding, ModifierKey, ShortcutKeys } from '@/types/shortcuts';
import { isChord } from '@/types/shortcuts';

/** Every spelling of a modifier we accept, symbol or word. */
const MODIFIER_ALIASES: Record<string, ModifierKey> = {
  '⌘': 'meta',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  '⌃': 'ctrl',
  ctrl: 'ctrl',
  control: 'ctrl',
  '⌥': 'alt',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  '⇧': 'shift',
  shift: 'shift',
};

/** Key names we render as symbols, accepted back in either spelling. */
const KEY_ALIASES: Record<string, string> = {
  '↵': 'enter',
  return: 'enter',
  esc: 'escape',
  '↑': 'arrowup',
  up: 'arrowup',
  '↓': 'arrowdown',
  down: 'arrowdown',
  '←': 'arrowleft',
  left: 'arrowleft',
  '→': 'arrowright',
  right: 'arrowright',
  '⌫': 'backspace',
  del: 'delete',
  '⇥': 'tab',
  space: ' ',
};

export interface ChordQuery {
  modifiers: ReadonlySet<ModifierKey>;
  /** null when the query names modifiers only ("cmd shift") */
  key: string | null;
}

const normalizeKey = (raw: string): string => {
  const key = raw.toLowerCase();
  return KEY_ALIASES[key] ?? key;
};

/**
 * Parse a query as a key combination, or return null when it is ordinary
 * text. Null is the important half of the contract: "close tab" must keep
 * searching labels, not silently become a chord match for the T key.
 */
export function parseChordQuery(query: string): ChordQuery | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Split on separators AND between adjacent modifier symbols, so `⌘⇧T`
  // and `cmd+shift+t` reach the same token list.
  const tokens = trimmed
    .replace(/[⌘⌃⌥⇧↵↑↓←→⌫⇥]/g, m => ` ${m} `)
    .split(/[\s+\-_]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const modifiers = new Set<ModifierKey>();
  const keys: string[] = [];
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    keys.push(token);
  }

  // A chord query must NAME at least one modifier. Without that rule every
  // single-letter search would turn into a key lookup.
  if (modifiers.size === 0) return null;
  // More than one non-modifier token is a sentence, not a chord.
  if (keys.length > 1) return null;
  const key = keys[0];
  // A multi-character remainder is only a key if we render it as one
  // ("esc", "space", "tab"); otherwise this is prose that happens to
  // contain a modifier word.
  if (key && key.length > 1 && !(normalizeKey(key) in NAMED_KEYS)) return null;

  return { modifiers, key: key ? normalizeKey(key) : null };
}

/** Keys whose printable name is longer than one character. */
const NAMED_KEYS: Record<string, true> = {
  enter: true,
  escape: true,
  arrowup: true,
  arrowdown: true,
  arrowleft: true,
  arrowright: true,
  backspace: true,
  delete: true,
  tab: true,
  ' ': true,
};

function bindingMatches(binding: KeyBinding, query: ChordQuery): boolean {
  const modifiers = new Set<ModifierKey>(binding.modifiers ?? []);
  // Every named modifier must be present. Extra modifiers on the binding are
  // fine: "cmd t" should surface ⌘T and ⌘⇧T, the way a partial text search
  // surfaces every label containing the word.
  for (const modifier of query.modifiers) {
    if (!modifiers.has(modifier)) return false;
  }
  if (!query.key) return true;
  return normalizeKey(binding.key) === query.key;
}

/** True when `keys` satisfies the parsed chord. Any step of a chord sequence
 *  counts — asking about `⌘K P` by typing `⌘K` should find it. */
export function matchesChordQuery(
  keys: ShortcutKeys,
  query: ChordQuery
): boolean {
  if (isChord(keys)) return keys.some(binding => bindingMatches(binding, query));
  return bindingMatches(keys, query);
}
