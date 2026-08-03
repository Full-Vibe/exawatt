'use client';

import { HUD } from '@/components/hud';
import { HarnessGlyph } from './harness-icons';
import { SessionGoalSummary } from './session-goal-summary';
import {
  DelegationDots,
  DelegationRail,
  SessionStatusGlyph,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from './status-glyphs';
import type { PtyHarness, SessionDelegation } from '@/types/electron';

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
  fault?: boolean;
  lifecycleLabel?: string | null;
  current: string;
  meaningfulChange?: string | null;
  next: string;
  nextProgress?: string | null;
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
  fault = false,
  lifecycleLabel,
  current,
  meaningfulChange,
  next,
  nextProgress,
}: SessionOverviewCardContentProps) {
  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span
            aria-label={
              harness === 'claude'
                ? 'Claude Code'
                : harness === 'codex'
                  ? 'Codex'
                  : 'Shell'
            }
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
            style={{ color }}
          >
            <HarnessGlyph harness={harness} size={13} />
          </span>
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
        <span className="inline-flex items-center gap-1.5">
          <DelegationDots color={color} delegation={delegation} />
          <SessionStatusGlyph
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
              color={color}
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
              color={color}
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
            className={`mt-1 font-sans text-[15px] leading-6 ${
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

      <div
        data-session-next
        className="mt-auto min-w-0 border-t pt-2.5"
        style={{ borderColor: HUD.divider }}
      >
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
            style={{
              color: next === 'No plan reported' ? HUD.textDim : HUD.text,
            }}
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
      </div>
    </>
  );
}
