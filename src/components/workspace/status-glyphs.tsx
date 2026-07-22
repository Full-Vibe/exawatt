// No 'use client' directive: only imported by client workspace components.

/**
 * Session turn-state glyphs (ENG-016 D22, amends the D18 slice) — shared by
 * the tab strip, Sessions overview, and command switcher so the same truth
 * reads the same way everywhere. The D18 pair (pulsing dot vs hollow dot)
 * was too subtle to read peripherally and conflated "finished a turn" with
 * "never started";
 * these states differ in shape AND motion:
 *   working — softly breathing teal orb: output streaming right now.
 *             Motion is the peripheral signal, kept SUBTLE (D24: the
 *             rotating arc read as annoying) — a slow glow pulse, larger
 *             and hotter than the rest dot; reduced motion keeps the
 *             solid orb, still size/hue-distinct from both dots.
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
import type { SessionGlyphState } from './session-status';

// Keep the established import surface for existing renderers while the
// state model itself stays usable from render-free mapping code.
export {
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  sessionGlyphState,
} from './session-status';
export type { SessionGlyphState } from './session-status';

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
      <span data-status="working" className={GLYPH_BOX}>
        <span
          className="inline-flex h-2 w-2 rounded-full motion-safe:animate-pulse"
          style={{
            background: HUD.cyan2,
            boxShadow: `0 0 6px ${HUD.cyan2}, 0 0 12px ${HUD.cyan2}66`,
          }}
        />
      </span>
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
