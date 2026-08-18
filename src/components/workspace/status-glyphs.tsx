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
import { useEffect, useState, type ReactNode } from 'react';
import { WORKSPACE_HUD as HUD } from './workspace-theme';
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
  delegationElapsedLabel,
  delegationRailRows,
  sessionGlyphCopy,
  sessionStateWord,
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
  fleetAttention,
  mergeFleetAttention,
  NO_FLEET_ATTENTION,
  ATTENTION_GLYPH_COPY,
  DELEGATION_DOT_CAP,
  delegationCopy,
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  SESSION_BLOCKED_COPY,
  sessionDelegationBusy,
  sessionGlyphCopy,
  sessionGlyphState,
  sessionLensTurnState,
  sessionReportedBlocked,
  sessionStateWord,
  sessionStatusLightState,
  sessionTurnFacts,
} from './session-status';
export type {
  FleetAttentionSignals,
  SessionAttentionSignal,
  SessionGlyphState,
  SessionTurnFacts,
  SessionTurnSources,
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
        // than as an ellipsis after the title.
        //
        // The cluster is exactly as wide as the children it is reporting. It
        // used to reserve all five slots so a spawn could not resize the row —
        // but under the D45 engine a tab's width comes from the layout policy
        // and the title flexes inside it, so the cluster CANNOT resize
        // anything. All the empty slots bought was a band of dead space
        // between the status glyph and the title, on the narrow tabs that can
        // least afford it (operator, 2026-08-04).
        style={color ? { color } : undefined}
      >
        {Array.from({ length: lit }, (_, index) => (
          <span
            aria-hidden="true"
            className="delegation-dot"
            key={index}
            style={{
              width: 3,
              height: 3,
              borderRadius: 9999,
              background: 'currentColor',
              // stagger so a cluster breathes as separate workers
              animationDelay: `${index * 320}ms`,
            }}
          />
        ))}
      </span>
    </StatusTooltip>
  );
}

/** Slow clock for elapsed labels — minute granularity means a 30s tick, not
 *  a stopwatch. The rail mounts only while children exist, so the interval's
 *  lifetime is exactly the rail's. */
function useSlowNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Sessions-altitude child rail (ENG-023 D3a): one row per delegated
 * child — breathing dot, the source's own agent kind, the child's spawn
 * label, minute-granularity elapsed. Labels only; results never render here.
 *
 * Row count is capped (`delegationRailRows`), so the rail's vertical budget
 * is a constant three rows and children arriving or finishing never move the
 * tile grid. It appears with the first child and leaves with the last — the
 * same conditional footprint as the dots it details.
 *
 * No aria-label here: the rail lives inside tiles that are themselves
 * `aria-label`ed buttons, whose subtree is presentational to assistive tech.
 * The census travels in the OWNING button's accessible name instead
 * (`delegationCopy`), which is where AT users actually hear it.
 */
export function DelegationRail({
  delegation,
  color,
}: {
  delegation?: SessionDelegation | null;
  /** Project color: the rail belongs to the tile's identity, not to status. */
  color: string;
}) {
  const now = useSlowNow();
  if ((delegation?.children.length ?? 0) === 0) return null;
  const { rows, overflow } = delegationRailRows(delegation);
  return (
    <div
      data-session-delegation-rail
      className="mt-1.5 flex min-w-0 flex-col gap-[3px]"
    >
      {rows.map((row, index) => {
        const elapsed = delegationElapsedLabel(now, row.startedAt);
        return (
          <StatusTooltip
            key={row.key}
            copy={`${row.description ?? row.agentType ?? 'delegated agent'}${
              Number.isFinite(row.startedAt)
                ? ` — started ${new Date(row.startedAt).toLocaleTimeString()}`
                : ''
            }`}
          >
            <span
              data-delegation-child
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className="delegation-dot shrink-0"
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 9999,
                  background: color,
                  animationDelay: `${index * 320}ms`,
                }}
              />
              <span
                className="shrink-0 font-mono text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                {row.agentType ?? 'agent'}
              </span>
              {row.description && (
                <span
                  className="min-w-0 truncate font-sans text-xs leading-4"
                  style={{ color: HUD.text }}
                >
                  {row.description}
                </span>
              )}
              {elapsed && (
                <span
                  suppressHydrationWarning
                  className="ml-auto shrink-0 font-mono text-xs tabular-nums"
                  style={{ color: HUD.textMono }}
                >
                  {elapsed}
                </span>
              )}
            </span>
          </StatusTooltip>
        );
      })}
      {overflow > 0 && (
        <span
          data-delegation-overflow
          className="pl-[9px] font-sans text-xs leading-4"
          style={{ color: HUD.textDim }}
        >
          and {overflow} more working
        </span>
      )}
    </div>
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

/**
 * The mark AND the word (ENG-033 H2).
 *
 * A roster has to be readable with the colour switched off. That was always
 * the accessibility requirement; remote Agents made it sharper, because a
 * remote Agent's state is not guessable from the context around it the way a
 * local one you just started is. The word is what turns "reads without
 * colour" from an assertion into something the surface proves.
 *
 * A SIBLING rather than a prop on `SessionStatusGlyph`, because only this
 * caller wants the word. The tab strip, the ⌘K switcher, and the shortcut
 * legend all mount the mark in a row whose width belongs to the Session
 * title; a second text run there would be taken out of the title, which is
 * the one thing on those rows the operator cannot do without. The comparison
 * tile is the surface with room and the surface that has to be scanned.
 *
 * The word is derived from the same `sessionStatusLightState` projection the
 * mark inside is drawn from, so there is one state in and one mark and one
 * word out — the word can never become a second status channel that
 * disagrees with the light. It reports WORK state only: a remote Agent whose
 * connection has gone stale keeps its last known work word here, and
 * connection freshness stays a separate readout.
 */
export function SessionStatusReadout({
  state,
  attention,
  delegation,
  fault = false,
}: {
  state: SessionGlyphState;
  attention?: SessionAttentionSignal | null;
  delegation?: SessionDelegation | null;
  fault?: boolean;
}) {
  const word = sessionStateWord({ state, attention, fault });
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      data-session-state-word={word}
    >
      <SessionStatusGlyph
        state={state}
        attention={attention}
        delegation={delegation}
        fault={fault}
      />
      {/* chrome-meta is the secondary-metadata rung (design system, D39 type
          scale); `whitespace-nowrap` keeps the widest word — "Result ready" —
          on one line at the tile's fixed 272px, where wrapping would push the
          header row into the identity band below it. */}
      <span
        className="whitespace-nowrap font-sans text-chrome-meta leading-4"
        style={{ color: HUD.text }}
      >
        {word}
      </span>
    </span>
  );
}
