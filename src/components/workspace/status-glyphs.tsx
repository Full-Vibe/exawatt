'use client';

/**
 * Session turn-state icons (ENG-016 D30, amends D22/D24) — shared by the
 * tab strip, Sessions overview, and ⌘K switcher so the same truth reads
 * the same way everywhere.
 *
 * D40 percolates the reviewed five-light protocol through the pre-existing
 * Session truth: Off / Active / Result / Needs You / Fault. Every state keeps
 * D30's redundant shape, color, tooltip, and accessible-name channels. Only
 * Active moves, using the shared slow rotor; attention and faults stay still.
 *
 * data-status / data-attention vocabulary is unchanged from D22 so tests,
 * evals, and every consumer keep working. All glyphs render in the same
 * GLYPH_BOX footprint: state changes never nudge the row.
 */
import type { ReactNode } from 'react';
import { HUD } from '@/components/hud';
import { StatusLight } from '@/components/status-light/status-light';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ATTENTION_GLYPH_COPY,
  FAULT_GLYPH_COPY,
  SESSION_GLYPH_COPY,
  sessionStatusLightState,
} from './session-status';
import type {
  SessionAttentionSignal,
  SessionGlyphState,
} from './session-status';

// Keep the established import surface for existing renderers while the
// state model itself stays usable from render-free mapping code.
export {
  attentionNeedsOperator,
  ATTENTION_GLYPH_COPY,
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  sessionGlyphState,
  sessionStatusLightState,
} from './session-status';
export type {
  SessionAttentionSignal,
  SessionGlyphState,
} from './session-status';

/** constant footprint so working↔rest↔attention swaps never shift the row */
const GLYPH_BOX = 'inline-flex h-4 w-4 shrink-0 items-center justify-center';

/** One shared explanation surface keeps strip, overview, and ⌘K semantics
 *  in lockstep. The trigger is the fixed glyph footprint, so hover never
 *  changes row geometry. */
function StatusTooltip({
  copy,
  children,
}: {
  copy: string;
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={7}
        className="max-w-64 border px-2.5 py-1.5 font-mono text-chrome-label shadow-xl"
        style={{
          color: HUD.text,
          background: HUD.bg.panel,
          borderColor: HUD.strokeSoft,
        }}
      >
        {copy}
      </TooltipContent>
    </Tooltip>
  );
}

/** unseen operator update (S1/D33) — calm at rest, explicit on hover */
export function AttentionMarker() {
  return (
    <StatusTooltip copy={ATTENTION_GLYPH_COPY}>
      <span data-attention className={GLYPH_BOX}>
        <StatusLight decorative size="compact" state="needs-you" />
      </span>
    </StatusTooltip>
  );
}

export function SessionStatusGlyph({
  state,
  attention,
  fault = false,
}: {
  state: SessionGlyphState;
  attention?: SessionAttentionSignal | null;
  fault?: boolean;
}) {
  const lightState = sessionStatusLightState({ state, attention, fault });
  const copy =
    lightState === 'fault'
      ? FAULT_GLYPH_COPY
      : lightState === 'needs-you'
        ? ATTENTION_GLYPH_COPY
        : SESSION_GLYPH_COPY[state];

  if (lightState === 'needs-you') {
    return (
      <StatusTooltip copy={copy}>
        <span data-attention className={GLYPH_BOX}>
          <StatusLight decorative size="compact" state={lightState} />
        </span>
      </StatusTooltip>
    );
  }

  return (
    <StatusTooltip copy={copy}>
      <span data-status={fault ? 'fault' : state} className={GLYPH_BOX}>
        <StatusLight decorative size="compact" state={lightState} />
      </span>
    </StatusTooltip>
  );
}
