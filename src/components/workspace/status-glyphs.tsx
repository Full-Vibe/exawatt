// No 'use client' directive: only imported by client workspace components.

/**
 * Session turn-state glyphs (ENG-016 D22, amends the D18 slice) — shared by
 * the tab strip and the Sessions overview so the same truth reads the same
 * way everywhere. The D18 pair (pulsing dot vs hollow dot) was too subtle to
 * read peripherally and conflated "finished a turn" with "never started";
 * these states differ in shape AND motion:
 *   working — rotating teal arc: output streaming right now. Motion is the
 *             peripheral signal; reduced motion keeps the static arc, which
 *             stays shape-distinct from both dots.
 *   done    — solid green rest dot: started, now quiet — a turn finished
 *             and the ball is in the operator's court.
 *   fresh   — dim hollow ring: live but never given work.
 *   quiet   — shells between output; visually the hollow ring (a shell has
 *             no turns, so started/unstarted does not apply).
 * The amber AttentionDot outranks all of these while a turn-end/bell is
 * unseen, so amber → glance → green is the natural progression.
 *
 * Every glyph (attention included) renders in the same GLYPH_BOX footprint:
 * state changes must never nudge the tab's layout sideways.
 */
import { HUD } from '@/components/hud';

export type SessionGlyphState = 'working' | 'done' | 'fresh' | 'quiet';

/** One derivation for every surface: working wins; agents split on whether
 *  they were ever given work; shells are just quiet between output. */
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

/** tooltip copy — one voice across the strip and the overview */
export const SESSION_GLYPH_COPY: Record<SessionGlyphState, string> = {
  working: 'working — output streaming',
  done: 'turn finished — waiting on you',
  fresh: 'new — not given a task yet',
  quiet: 'quiet — waiting or between turns',
};

/** compact state words for accessible names */
export const SESSION_GLYPH_LABEL: Record<SessionGlyphState, string> = {
  working: 'working',
  done: 'turn finished',
  fresh: 'new',
  quiet: 'quiet',
};

/** constant footprint so working↔rest↔attention swaps never shift the row */
const GLYPH_BOX =
  'inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center';

/** needs-operator pulse (S1) — amber, small, impossible to miss peripherally */
export function AttentionDot() {
  return (
    <span data-attention className={GLYPH_BOX}>
      <span className="relative inline-flex h-1.5 w-1.5">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none"
          style={{ background: HUD.amber, opacity: 0.6 }}
        />
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: HUD.amber, boxShadow: `0 0 5px ${HUD.amber}` }}
        />
      </span>
    </span>
  );
}

export function SessionStatusGlyph({ state }: { state: SessionGlyphState }) {
  if (state === 'working') {
    return (
      <span
        data-status="working"
        className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] motion-safe:animate-spin"
        style={{
          borderColor: `${HUD.cyan2}40`,
          borderTopColor: HUD.cyan2,
          boxShadow: `0 0 5px ${HUD.cyan2}55`,
        }}
      />
    );
  }
  if (state === 'done') {
    return (
      <span data-status="done" className={GLYPH_BOX}>
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: HUD.green, boxShadow: `0 0 5px ${HUD.green}` }}
        />
      </span>
    );
  }
  return (
    <span data-status={state} className={GLYPH_BOX}>
      <span
        className="inline-flex h-1.5 w-1.5 rounded-full border opacity-60"
        style={{ borderColor: HUD.idle }}
      />
    </span>
  );
}
