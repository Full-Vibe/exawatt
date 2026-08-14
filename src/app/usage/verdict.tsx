'use client';

/**
 * Band 1 — Headroom ("how much is left?"), and the page's one glance zone.
 *
 * The tightest live window is the verdict: one display numeral, the reset,
 * and the pace read as plain words. A viewer who reads nothing else leaves
 * with this line. Every other window — and every source that reports no
 * plan record — sits beside it as a subordinate row of the same answer.
 *
 * The opportunity voice (E9) rides the shared vocabulary: `paceLabel`
 * re-frames a firing window as free-to-spend, the row figures swap to the
 * free reading, and the bar draws the expiry region. Two captions may
 * close the band: the coach (closing tier only, silenced outright by any
 * hot or spent window via the shared arbiter) and the closed-cycle ledger
 * (this band is its only home — the popover never carries a memory).
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  duration,
  percent,
} from '@/components/consumption/flux';
import {
  PLAN_LEVEL_NOTE,
  planReadState,
  sourceOwnerLabel,
  windowOwnerLabel,
  type ConsumptionSourceView,
  type PlanReadState,
} from '@/components/consumption/model';
import {
  ledgerLine,
  opportunityCoach,
  opportunityOf,
  type ClosedCycle,
} from '@/components/consumption/meter/meter-model';
import type { WindowPace } from './derive';
import {
  Band,
  Body,
  Caption,
  Data,
  Num,
  PaceBar,
  UnreportedChannel,
  paceFill,
  paceLabel,
  verdictColor,
} from './chrome';

export function Verdict({
  paces,
  silent,
  nowMs,
  unknownNote = null,
  closedCycles = [],
}: {
  paces: WindowPace[];
  silent: ConsumptionSourceView[];
  nowMs: number;
  /** Names the sources this verdict does NOT cover; null when it covers all. */
  unknownNote?: string | null;
  closedCycles?: ClosedCycle[];
}) {
  const [headline, ...rest] = paces;
  // ENG-038: an account window meters the whole plan, so the page states that
  // once — the disclosure used to exist only in the meter popover.
  const planLevel = paces.some(p => p.window.planLevel);
  if (!headline) {
    // No live window anywhere — say so, and still show each source's absent
    // channel (observed raw + why) rather than a bare card (E5 empty state).
    return (
      <Band label="Headroom">
        <Caption>No source reports a live plan window.</Caption>
        {unknownNote && <Caption>{unknownNote}</Caption>}
        {silent.length > 0 && (
          <div className="flex min-w-0 max-w-xl flex-col gap-3">
            {silent.map(s => (
              <SilentRow key={s.key} source={s} nowMs={nowMs} />
            ))}
          </div>
        )}
      </Band>
    );
  }
  const label = paceLabel(headline);
  const coach = opportunityCoach(paces);
  return (
    <Band
      label="Headroom"
      aside={
        <Caption>
          {windowOwnerLabel(headline.source, headline.window)} ·{' '}
          {headline.window.label}
        </Caption>
      }
    >
      <div className="grid items-center gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Num color={paceFill(headline)}>
              {percent(headline.usedPercent)} used
            </Num>
            <Body color={verdictColor(headline)}>
              resets in {duration(headline.msToReset)} · {label.text}
            </Body>
          </div>
          <PaceBar pace={headline} height={10} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {rest.map(p => (
            <WindowRow key={p.window.limitId} pace={p} />
          ))}
          {silent.map(s => (
            <SilentRow key={s.key} source={s} nowMs={nowMs} />
          ))}
        </div>
      </div>
      {/* the partial-verdict fact leads the captions: a reader who stops at
          the glance zone must not leave thinking the page saw everything */}
      {unknownNote && <Caption>{unknownNote}</Caption>}
      {planLevel && <Caption>{PLAN_LEVEL_NOTE}</Caption>}
      {coach && <Caption>{coach}</Caption>}
      {closedCycles.map(c => (
        <Caption key={`${c.label}-${c.agoMs}`}>{ledgerLine(c)}</Caption>
      ))}
    </Band>
  );
}

/** One subordinate window — same answer, smaller voice. */
function WindowRow({ pace }: { pace: WindowPace }) {
  const o = opportunityOf(pace);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Body className="truncate" color={CHROME.textDim}>
          {windowOwnerLabel(pace.source, pace.window)} · {pace.window.label}
        </Body>
        {o ? (
          // the E9 metric swap — the figure the row leads with becomes free
          <Data bright>
            {o.freePts}% free · resets in {duration(pace.msToReset)}
          </Data>
        ) : (
          <Data bright>
            {percent(pace.usedPercent)} · resets in {duration(pace.msToReset)}
          </Data>
        )}
      </div>
      <PaceBar pace={pace} height={6} />
    </div>
  );
}

/**
 * A source with no live window — an absent channel, never 0%.
 *
 * Three causes wear three different states (`planReadState`). Before this
 * split every one of them printed the harness's static capability sentence,
 * so an expired token read as "this vendor keeps no such record" and a fleet
 * that could see less looked healthier.
 */
function SilentRow({
  source,
  nowMs,
}: {
  source: ConsumptionSourceView;
  nowMs: number;
}) {
  const state = planReadState(source, nowMs);
  const unknown = state === 'off' || state === 'unreadable';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Body className="truncate" color={CHROME.textDim}>
          {sourceOwnerLabel(source)} · plan
        </Body>
        <Data color={FLUX.unknown}>{stateFigure(state)}</Data>
      </div>
      <UnreportedChannel
        observed={source.observedTokens5h}
        reason={unknown ? readReason(source, state, nowMs) : source.unreportedReason}
        height={6}
      />
    </div>
  );
}

/** The right-hand state word. Unknown never borrows absence's phrasing. */
function stateFigure(state: PlanReadState): string {
  if (state === 'off') return 'read turned off';
  if (state === 'unreadable') return 'position unknown';
  return 'no plan record';
}

/** One short fact about the read itself — never a remedy, never a stack. */
function readReason(
  source: ConsumptionSourceView,
  state: PlanReadState,
  nowMs: number
): string {
  const name = sourceOwnerLabel(source);
  if (state === 'off') return `${name} reads are turned off in Settings.`;
  const observedAtMs = source.accountRead?.observedAtMs ?? null;
  return observedAtMs === null
    ? `${name} has never been read successfully.`
    : `${name} last read ${duration(Math.max(0, nowMs - observedAtMs))} ago.`;
}
