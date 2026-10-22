/**
 * Which ⌘-chords the terminal pane itself implements (find, copy, paste,
 * select-all) — and, just as deliberately, which it must decline.
 *
 * A handled shortcut consumes its key event (ENG-016 D13/D19/D28), so the
 * terminal may claim EXACTLY the chords it implements. Matching `⌘F` by
 * `metaKey && key === 'f'` alone also swallowed every modifier superset:
 * ⌘⇧F opened the terminal find instead of quick feedback capture, which is
 * registered as a global verb reachable from inside xterm (ENG-025 F1,
 * feedback row 9ea6098d). Any chord this matcher declines falls through to
 * the workspace key layers, exactly like ⌘K does today.
 */
export type TerminalChordVerb = 'find' | 'copy' | 'paste' | 'select-all';

/** The one table of terminal chords: the matcher below reads it, and the
 *  terminal's command rows print it, so a row can never advertise a chord the
 *  pane does not answer. */
export const TERMINAL_CHORD_KEYS: Readonly<
  Record<TerminalChordVerb, { key: string; modifiers: ['meta'] }>
> = {
  find: { key: 'f', modifiers: ['meta'] },
  copy: { key: 'c', modifiers: ['meta'] },
  paste: { key: 'v', modifiers: ['meta'] },
  'select-all': { key: 'a', modifiers: ['meta'] },
};

const VERB_BY_KEY = new Map(
  (
    Object.entries(TERMINAL_CHORD_KEYS) as [
      TerminalChordVerb,
      { key: string },
    ][]
  ).map(([verb, binding]) => [binding.key, verb])
);

export function matchTerminalChord(
  event: Pick<
    KeyboardEvent,
    'type' | 'key' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'
  >
): TerminalChordVerb | null {
  if (event.type !== 'keydown' || !event.metaKey) return null;
  // exact chords only: a shifted/optioned variant is a DIFFERENT combo and
  // may belong to a workspace verb (⌘⇧F = quick feedback)
  if (event.shiftKey || event.altKey || event.ctrlKey) return null;
  return VERB_BY_KEY.get(event.key.toLowerCase()) ?? null;
}
