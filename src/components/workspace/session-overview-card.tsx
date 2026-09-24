'use client';

import { Shapes, Target } from 'lucide-react';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';
import {
  FLUX_CSS as FLUX,
  exact,
  pressureColorCss as pressureColor,
  tokens,
} from '@/components/consumption/flux';
import { HarnessGlyph } from './harness-icons';
import { HARNESS_META } from './harnesses';
import { SessionGoalSummary } from './session-goal-summary';
import {
  DelegationDots,
  DelegationRail,
  SessionStatusReadout,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from './status-glyphs';
import type { PtyHarness } from '@exawatt/core';
import type { SessionDelegation } from '@exawatt/core/desktop-bridge';

/**
 * Per-Session consumption readout (ENG-008): raw tokens this Session
 * (delegated runs included) plus its burn relative to the busiest Session in
 * the Workspace. Sources that report no usage pass nothing — the row is
 * omitted entirely, never rendered as zero.
 */
export interface SessionConsumptionReadout {
  /** Raw tokens across all units, delegated runs included. */
  rawTokens: number;
  /** Slice of the Workspace's normalized token burn, 0..1. */
  share: number;
  /** Against the busiest Session in the Workspace, 0..1 — the bar length. */
  intensity: number;
}

export interface SessionInitiativeReadout {
  id: string;
  name: string;
  goal?: string;
}

export interface SessionOverviewCardContentProps {
  title: string;
  context?: string | null;
  titleIsContext?: boolean;
  color: string;
  harness: PtyHarness;
  glyphState: SessionGlyphState;
  attention?: SessionAttentionSignal;
  /** harness-reported delegated work (ENG-023); absent when unreported */
  delegation?: SessionDelegation | null;
  /**
   * ENG-028 T1: the Agent Type name, when the data source declares one (the
   * Demo Workspace's authored desks). A declared Type is a fact and renders
   * as one; a Session with no declared Type renders no chip at all. The
   * dashed "Coding" placeholder every live card used to carry is gone: a
   * dashed stroke means designed-not-built, and a card states facts only.
   */
  agentType?: string | null;
  /** Durable goal this Session advances. Omitted when a source does not
   *  report Initiative truth; absence never becomes an invented bucket. */
  initiative?: SessionInitiativeReadout | null;
  fault?: boolean;
  lifecycleLabel?: string | null;
  current: string;
  meaningfulChange?: string | null;
  /** The plan step this Session advances. Null when no plan source reports
   *  one; the card then shows no Next region rather than a sentence saying
   *  there is none. */
  next: string | null;
  nextProgress?: string | null;
  /** Consumption readout (ENG-008); absent when the source reports none. */
  consumption?: SessionConsumptionReadout | null;
}

/**
 * The shared Sessions-card projection reviewed in `/hud-gallery` and consumed
 * by production. Operational prose is readable sans; mono is reserved for the
 * tiny Now/Next and lifecycle metadata. Raw terminal output never belongs here.
 */
export function SessionOverviewCardContent({
  title,
  context,
  titleIsContext = false,
  color,
  harness,
  glyphState,
  attention,
  delegation,
  agentType,
  initiative,
  fault = false,
  lifecycleLabel,
  current,
  meaningfulChange,
  next,
  nextProgress,
  consumption,
}: SessionOverviewCardContentProps) {
  // Monochrome until notable (design kernel): the FLUX channel lights only
  // once a Session crosses into the ramp's warm territory; the ramp boundary
  // (0.62) is the shared definition of "notable" — no second threshold.
  const consumptionNotable = (consumption?.intensity ?? 0) > 0.62;
  const consumptionColor = consumption
    ? consumptionNotable
      ? pressureColor(consumption.intensity * 100)
      : HUD.textDim
    : HUD.textDim;
  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="inline-flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-label={HARNESS_META[harness].label}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
            style={{ color }}
          >
            <HarnessGlyph harness={harness} size={13} />
          </span>
          {/* ENG-028 T1: the Type slot, what kind of worker rather than which
              engine, rendered only when a source declares one. A chip shows
              a VALUE, never its slot's name (operator, 2026-08-03). */}
          {harness !== 'shell' && agentType && (
            <span
              data-session-agent-type
              className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-chrome-micro"
              style={{ color: HUD.textDim, borderColor: HUD.strokeFaint }}
            >
              <Shapes aria-hidden className="h-2.5 w-2.5" />
              {agentType}
            </span>
          )}
          {initiative && (
            <span
              data-session-initiative={initiative.id}
              title={initiative.goal ?? initiative.name}
              className="inline-flex min-w-0 items-center gap-1 font-ui text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
              <Target aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate">{initiative.name}</span>
            </span>
          )}
          {lifecycleLabel && (
            <span
              data-expose-state={lifecycleLabel}
              className="font-mono text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
              {lifecycleLabel}
            </span>
          )}
        </span>
        {/* `shrink-0`: the state readout carries a word now (ENG-033 H2), and
            the identity run to its left is the side that yields — it already
            truncates, the state does not. */}
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <DelegationDots color={color} delegation={delegation} />
          <SessionStatusReadout
            state={glyphState}
            attention={attention}
            delegation={delegation}
            fault={fault}
          />
        </span>
      </div>

      {/* Identity and Now share one clipping band. The tile is a fixed
          footprint, so when extreme content (a two-line rename, a context
          subtitle, AND a full rail) exceeds it, the overflow is clipped HERE
          — the Next region below sits outside the band and stays intact by
          construction rather than by arithmetic. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mt-2 min-h-12 min-w-0">
          {titleIsContext ? (
            <SessionGoalSummary
              summary={title}
              size="comparison"
              className="max-w-full"
            />
          ) : (
            <span
              data-session-overview-title
              className="line-clamp-2 block font-sans text-base font-medium leading-6"
              style={{ color: HUD.text }}
            >
              {title}
            </span>
          )}
          {context && (
            <SessionGoalSummary
              summary={context}
              className={`mt-0.5 max-w-full text-sm leading-5${
                // The context cue also yields its second line while the rail
                // is up — identity stays present, the team gets the room.
                delegation?.children.length ? ' line-clamp-1' : ''
              }`}
            />
          )}
        </div>

        {/* With live children the current sentence yields its second line to
            the child rail (ENG-023 D3a) — the team's labels are worth more at
            comparison altitude than the tail of one sentence. The rail's row
            budget is fixed, so the tile footprint never moves. */}
        <div data-session-now className="mt-3 min-w-0">
          <span
            className="block font-mono text-chrome-meta uppercase tracking-[0.14em]"
            style={{ color: HUD.textDim }}
          >
            Now
          </span>
          {/* No `block` beside the clamp: line-clamp sets display:-webkit-box,
              and a display:block utility can win the cascade and silently
              unclamp the line — measured as a clipped Next region. */}
          <span
            data-session-current
            className={`mt-1 font-sans text-reading leading-6 ${
              delegation?.children.length ? 'line-clamp-1' : 'line-clamp-2'
            }`}
            style={{ color: HUD.text }}
          >
            {current}
          </span>
          {delegation?.children.length ? (
            <DelegationRail delegation={delegation} color={color} />
          ) : (
            meaningfulChange && (
              <span
                className="mt-0.5 line-clamp-1 block font-sans text-sm leading-5"
                style={{ color: HUD.textDim }}
              >
                {meaningfulChange}
              </span>
            )
          )}
        </div>
      </div>

      {/* The footer states facts only: a plan step when a plan source
          reports one, consumption when a source reports it. Absent both, no
          footer, and the fixed tile footprint keeps the card's height. */}
      {(next || consumption) && (
      <div
        data-session-next
        className="mt-auto min-w-0 border-t pt-2.5"
        style={{ borderColor: HUD.divider }}
      >
        {next && (
          <>
            <span
              className="block font-mono text-chrome-meta uppercase tracking-[0.14em]"
              style={{ color: HUD.textDim }}
            >
              Next
            </span>
            <span className="mt-1 flex min-w-0 items-baseline justify-between gap-3">
              <span
                data-session-next-copy
                className="min-w-0 truncate font-sans text-sm leading-5"
                style={{ color: HUD.text }}
              >
                {next}
              </span>
              {nextProgress && (
                <span
                  className="shrink-0 font-mono text-xs tabular-nums"
                  style={{ color: HUD.textMono }}
                >
                  {nextProgress}
                </span>
              )}
            </span>
          </>
        )}
        {consumption && (
          <span
            data-session-consumption
            className="mt-2 flex items-center justify-between gap-3"
            title={`${exact(consumption.rawTokens)} tokens this Session, delegated runs included · ${consumption.share < 0.01 ? '<1' : Math.round(consumption.share * 100)}% of the Workspace's normalized burn · bar is relative to the busiest Session`}
          >
            <span
              className="font-mono text-chrome-meta tabular-nums"
              style={{ color: consumptionColor }}
            >
              {tokens(consumption.rawTokens)} tokens
            </span>
            <span
              aria-hidden="true"
              className="h-[3px] w-16 shrink-0 overflow-hidden rounded-full"
              style={{ background: FLUX.track }}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(3, consumption.intensity * 100)}%`,
                  background: consumptionNotable
                    ? pressureColor(consumption.intensity * 100)
                    : withThemeAlpha(HUD.textDim, 0.55),
                }}
              />
            </span>
          </span>
        )}
      </div>
      )}
    </>
  );
}
