/**
 * Shared live-Session turn state (ENG-016 D22/D29).
 *
 * Keep this module render-free: the strip, Sessions overview, and command
 * switcher all consume the same derivation and language, while their visual
 * components remain free to choose the appropriate footprint.
 */
export type SessionGlyphState = 'working' | 'done' | 'fresh' | 'quiet';

/** Working wins; agents split on whether they were ever given work; shells
 * are simply quiet between output because they do not have turns. */
export function sessionGlyphState({
  working,
  agent,
  started,
}: {
  working: boolean;
  /** false for shells — they have no turn state */
  agent: boolean;
  started: boolean;
}): SessionGlyphState {
  if (working) return 'working';
  if (!agent) return 'quiet';
  return started ? 'done' : 'fresh';
}

/** Tooltip copy — one voice across every Session surface. */
export const SESSION_GLYPH_COPY: Record<SessionGlyphState, string> = {
  working: 'working — output streaming',
  done: 'turn finished — waiting on you',
  fresh: 'new — not given a task yet',
  quiet: 'quiet — waiting or between turns',
};

/** Compact state words for visible labels and accessible names. */
export const SESSION_GLYPH_LABEL: Record<SessionGlyphState, string> = {
  working: 'working',
  done: 'turn finished',
  fresh: 'new',
  quiet: 'quiet',
};
