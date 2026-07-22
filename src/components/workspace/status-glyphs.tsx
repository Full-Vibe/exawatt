// No 'use client' directive: only imported by client workspace components.

/**
 * Session turn-state icons (ENG-016 D30, amends D22/D24) — shared by the
 * tab strip, Sessions overview, and ⌘K switcher so the same truth reads
 * the same way everywhere.
 *
 * Three rounds of colored dots (D18 pulse, D22 shapes, D24 orb) failed the
 * canonical status-indicator rule (Carbon: at least three of shape / icon /
 * color / text — never hue alone): teal-vs-green dots at 6–10px were
 * indistinguishable, camouflaged among the row's identity marks. D30
 * adopts the learnable icon-vocabulary model (Linear / GitHub checks,
 * operator-chosen 2026-07-22) — every state is a DISTINCT SHAPE, color is
 * redundant, and the ⌘/ cheat sheet carries the text legend:
 *   working  — teal half-fill pie, breathing softly (subtle motion
 *              doctrine: no spinners)
 *   needs-you— amber BELL with the ping halo — the attention monitor's own
 *              vocabulary (it detects terminal bells); deliberately not an
 *              alarm triangle (operator: less alarming)
 *   done     — green circled check: a turn finished, ball in your court
 *   fresh    — dashed hollow circle: live but never given work
 *   quiet    — plain hollow circle: shells between output
 *
 * data-status / data-attention vocabulary is unchanged from D22 so tests,
 * evals, and every consumer keep working. All glyphs render in the same
 * GLYPH_BOX footprint: state changes never nudge the row.
 */
import { Bell, Circle, CircleCheck, CircleDashed } from 'lucide-react';
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
  'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center';

const ICON = 13;

/** working — half-fill pie: in-progress by SHAPE (Linear's language), with
 *  a soft breathing pulse as the motion channel */
function WorkingPie() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={ICON}
      height={ICON}
      aria-hidden="true"
      className="motion-safe:animate-pulse"
      style={{
        color: HUD.cyan2,
        filter: `drop-shadow(0 0 3px ${HUD.cyan2}66)`,
      }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M8 8 V1.6 A6.4 6.4 0 0 1 8 14.4 Z" fill="currentColor" />
    </svg>
  );
}

/** needs-operator (S1/D30) — the bell rings until you look */
export function AttentionBell() {
  return (
    <span data-attention className={GLYPH_BOX}>
      <span className="relative inline-flex items-center justify-center">
        <span
          className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full motion-reduce:animate-none"
          style={{ background: HUD.amber, opacity: 0.45 }}
        />
        <Bell
          size={ICON}
          aria-hidden="true"
          className="relative"
          style={{
            color: HUD.amber,
            fill: HUD.amber,
            filter: `drop-shadow(0 0 3px ${HUD.amber}88)`,
          }}
        />
      </span>
    </span>
  );
}

export function SessionStatusGlyph({ state }: { state: SessionGlyphState }) {
  if (state === 'working') {
    return (
      <span data-status="working" className={GLYPH_BOX}>
        <WorkingPie />
      </span>
    );
  }
  if (state === 'done') {
    return (
      <span data-status="done" className={GLYPH_BOX}>
        <CircleCheck
          size={ICON}
          aria-hidden="true"
          style={{
            color: HUD.green,
            filter: `drop-shadow(0 0 3px ${HUD.green}55)`,
          }}
        />
      </span>
    );
  }
  if (state === 'fresh') {
    return (
      <span data-status="fresh" className={GLYPH_BOX}>
        <CircleDashed
          size={ICON}
          aria-hidden="true"
          className="opacity-70"
          style={{ color: HUD.idle }}
        />
      </span>
    );
  }
  return (
    <span data-status={state} className={GLYPH_BOX}>
      <Circle
        size={ICON}
        aria-hidden="true"
        className="opacity-60"
        style={{ color: HUD.idle }}
      />
    </span>
  );
}
