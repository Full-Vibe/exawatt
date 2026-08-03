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
  DELEGATION_DOT_CAP,
  FAULT_GLYPH_COPY,
  delegationCopy,
  sessionGlyphCopy,
  sessionStatusLightState,
} from './session-status';
import type {
  SessionAttentionSignal,
  SessionGlyphState,
} from './session-status';
import type { SessionDelegation } from '@/types/electron';

// Keep the established import surface for existing renderers while the
// state model itself stays usable from render-free mapping code.
export {
  attentionNeedsOperator,
  ATTENTION_GLYPH_COPY,
  DELEGATION_DOT_CAP,
  delegationCopy,
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  SESSION_BLOCKED_COPY,
  sessionDelegationBusy,
  sessionGlyphCopy,
  sessionGlyphState,
  sessionReportedBlocked,
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

/**
 * Delegated children (ENG-023) — a presence channel beside the status light,
 * never a replacement for it.
 *
 * Dots, not a count: the exact number belongs in the tooltip and the
 * accessible name, and a cluster should read as "this agent has help" at a
 * glance. The cluster is a FIXED width for its cap, so children arriving and
 * finishing — the whole point of the thing — never resize the row they sit in.
 * It appears when the first child starts and leaves when the last one ends,
 * which is the same conditional footprint the harness and pinned marks use.
 *
 * The row is deliberately more than D1 draws. D2 hangs the per-child rail off
 * this same trigger rather than replacing it.
 */
export function DelegationDots({
  delegation,
  color,
}: {
  delegation?: SessionDelegation | null;
  /** Owned here rather than by a wrapper: a wrapping element would survive as
   *  an empty flex child when there is no delegation, and its parent's `gap`
   *  would then pad every NON-delegating row. */
  color?: string;
}) {
  const running = delegation?.children.length ?? 0;
  const copy = delegationCopy(delegation);
  if (running === 0 || !copy) return null;
  const lit = Math.min(running, DELEGATION_DOT_CAP);
  return (
    <StatusTooltip copy={copy}>
      <span
        aria-label={copy}
        className="inline-flex shrink-0 items-center gap-[3px]"
        data-delegation={running}
        role="img"
        // Gap wider than the dot so a cluster reads as separate workers rather
        // than as an ellipsis after the title. Width is the cap, always, so
        // children arriving and finishing never resize the row.
        style={{
          width: DELEGATION_DOT_CAP * 3 + (DELEGATION_DOT_CAP - 1) * 3,
          ...(color ? { color } : {}),
        }}
      >
        {Array.from({ length: DELEGATION_DOT_CAP }, (_, index) => (
          <span
            aria-hidden="true"
            className={index < lit ? 'delegation-dot' : undefined}
            key={index}
            style={{
              width: 3,
              height: 3,
              borderRadius: 9999,
              // Unlit slots hold the width without implying spare capacity.
              background: index < lit ? 'currentColor' : 'transparent',
              // stagger so a cluster breathes as separate workers
              animationDelay: `${index * 320}ms`,
            }}
          />
        ))}
      </span>
    </StatusTooltip>
  );
}

export function SessionStatusGlyph({
  state,
  attention,
  delegation,
  fault = false,
}: {
  state: SessionGlyphState;
  attention?: SessionAttentionSignal | null;
  /** corrects the tooltip: a delegating Session is quiet, not streaming */
  delegation?: SessionDelegation | null;
  fault?: boolean;
}) {
  const lightState = sessionStatusLightState({ state, attention, fault });
  const copy =
    lightState === 'fault'
      ? FAULT_GLYPH_COPY
      : lightState === 'needs-you'
        ? // A REPORTED gate knows what it is waiting for; the generic attention
          // sentence is the fallback for inferred signals that do not.
          state === 'blocked'
          ? sessionGlyphCopy(state, delegation)
          : ATTENTION_GLYPH_COPY
        : sessionGlyphCopy(state, delegation);

  if (lightState === 'needs-you') {
    return (
      <StatusTooltip copy={copy}>
        {/* `data-status` rides along rather than being replaced: turn state and
            attention are separate channels, and a Session that stops reporting
            its turn state the moment it needs the operator is exactly the blind
            spot that made this area hard to test and hard to trust. */}
        <span data-attention data-status={state} className={GLYPH_BOX}>
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
