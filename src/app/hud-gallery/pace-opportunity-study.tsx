'use client';

/**
 * `/hud-gallery` study — the pace opportunity voice (ENG-008 E9 design
 * options). Three directions for "free allocation resets soon", each shown
 * in BOTH placements (the ambient meter popover and `/usage`'s Headroom
 * band) across five switchable states. The trigger predicate and fixtures
 * live in `pace-opportunity-model.ts`.
 *
 * Channel discipline, common to all three: opportunity NEVER borrows the
 * alarm channel. No FLUX warm/hot, no amber, no status colors, no motion —
 * the whole voice lives inside the monochrome family the meter already
 * uses at rest, so a hot window and an expiring window can never be
 * confused, and ignoring one cannot teach the operator to ignore the other.
 *
 * The specimens replicate the production popover markup and reuse the
 * production `/usage` chrome components; the operator's pick gets wired
 * into `meter-model` / `meter-popover` / `verdict` as the follow-up.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { HUD } from '@/components/hud/tokens';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha,
  duration,
  percent,
  projectionHatch,
} from '@/components/consumption/flux';
import { HARNESS_LABEL } from '@/components/consumption/model';
import type { ConsumptionSourceView } from '@/components/consumption/model';
import {
  meterTone,
  paceSentence,
  readAllWindows,
  readMeter,
  remediationHint,
  METER_MONO,
  type MeterReading,
} from '@/components/consumption/meter/meter-model';
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
} from '@/app/usage/chrome';
import {
  opportunityOf,
  OPPORTUNITY_STATES,
  type ClosedCycle,
  type OpportunityFixtureState,
  type OpportunityRead,
} from './pace-opportunity-model';

type DirectionId = 'chip' | 'geometry' | 'swap';

/* ------------------------------------------------------------------ */
/* shared opportunity vocabulary (per direction)                       */
/* ------------------------------------------------------------------ */

/** Direction C's re-worded secondary line — the metric swap itself. */
function swapSentence(r: MeterReading, o: OpportunityRead): string {
  return o.tier === 'closing'
    ? `${o.freePts}% free · expires in ${duration(r.msToReset)}`
    : `${o.coursePts}% will expire unused at this pace`;
}

/** Direction C's coach line. Speaks only at the closing tier. */
function coachLine(r: MeterReading, o: OpportunityRead): string {
  return `${r.window.label} resets in ${duration(r.msToReset)} with ${o.freePts}% free — front-load the heavy runs.`;
}

function ledgerLine(c: ClosedCycle): string {
  return `${c.label} reset ${duration(c.agoMs)} ago · closed with ${c.unusedPercent}% unused`;
}

/** The floor claim, stated once as a tooltip so copy stays short. */
function floorTitle(o: OpportunityRead): string {
  return `Even at even pace from now, at least ${o.floorPts}% of this window expires unused.`;
}

/** +45° neutral hatch — deliberately opposite the −45° unreported/projection
 *  textures; whether a third texture is legible is part of the review. */
function expiryHatch(alpha = 0.5): string {
  return `repeating-linear-gradient(45deg, ${consumptionAlpha(
    CHROME.textDim,
    alpha
  )} 0 1px, transparent 1px 5px)`;
}

/** Best closing opportunity across every live window, for the coach slot. */
function closingOpportunity(
  state: OpportunityFixtureState
): { reading: MeterReading; o: OpportunityRead } | null {
  let best: { reading: MeterReading; o: OpportunityRead } | null = null;
  for (const source of state.sources) {
    for (const reading of readAllWindows(source, state.nowMs)) {
      const o = opportunityOf(reading);
      if (!o || o.tier !== 'closing') continue;
      if (!best || o.freePts > best.o.freePts) best = { reading, o };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* direction A — the quiet chip                                        */
/* ------------------------------------------------------------------ */

function OpportunityChip({
  reading,
  o,
}: {
  reading: MeterReading;
  o: OpportunityRead;
}) {
  const closing = o.tier === 'closing';
  return (
    <span
      className="inline-flex w-fit items-center whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-chrome-micro tabular-nums"
      style={{
        borderColor: consumptionAlpha(CHROME.text, closing ? 0.5 : 0.28),
        color: closing ? CHROME.text : CHROME.textDim,
      }}
      title={floorTitle(o)}
    >
      {o.coursePts}% unused · resets {duration(reading.msToReset)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* direction B — expiry geometry                                       */
/* ------------------------------------------------------------------ */

/**
 * The production PaceBar's construction (fill · projection hatch · even-pace
 * tick · ceiling tick) plus the one addition under review: the region from
 * the projected landing point to the ceiling, hatched +45° neutral — the
 * part of the window that dies unused if the pace holds.
 */
function ExpiryPaceBar({
  pace,
  height = 8,
}: {
  pace: MeterReading;
  height?: number;
}) {
  const o = opportunityOf(pace);
  const color = paceFill(pace);
  const usedW = Math.min(100, pace.usedPercent);
  const projW = Math.max(
    0,
    Math.min(100 - usedW, pace.projectedPercent - usedW)
  );
  const expiryStart = Math.min(100, usedW + projW);
  const overshoot = pace.projectedPercent > 100;
  return (
    <span
      aria-hidden
      className="relative inline-block w-full shrink-0 overflow-visible rounded-[1px]"
      style={{
        height,
        background: FLUX.track,
        boxShadow: `inset 0 0 0 1px ${FLUX.trackLine}`,
      }}
    >
      <span
        className="absolute left-0 top-0 h-full rounded-l-[1px]"
        style={{
          width: `${usedW}%`,
          background: color,
          boxShadow: `0 0 7px ${consumptionAlpha(color, 0.5)}`,
        }}
      />
      {projW > 0.5 && (
        <span
          className="absolute top-0 h-full"
          style={{
            left: `${usedW}%`,
            width: `${projW}%`,
            background: projectionHatch(consumptionAlpha(color, 0.85)),
          }}
        />
      )}
      {o && expiryStart < 99.5 && (
        <>
          <span
            className="absolute top-0 h-full"
            style={{
              left: `${expiryStart}%`,
              width: `${100 - expiryStart}%`,
              background: expiryHatch(),
            }}
            title={floorTitle(o)}
          />
          <span
            className="absolute top-0 h-full"
            style={{
              left: `calc(${expiryStart}% - 1px)`,
              width: 1,
              background: consumptionAlpha(CHROME.text, 0.55),
            }}
          />
        </>
      )}
      <span
        className="absolute"
        style={{
          left: `calc(${Math.min(100, pace.evenPacePercent)}% - 1px)`,
          top: -3,
          width: 2,
          height: height + 6,
          background: consumptionAlpha(CHROME.text, 0.85),
        }}
        title={`even pace would be at ${percent(pace.evenPacePercent)}`}
      />
      <span
        className="absolute top-[-2px]"
        style={{
          right: -1,
          width: 1.5,
          height: height + 4,
          background: overshoot ? FLUX.hot : FLUX.trackLine,
          boxShadow: overshoot ? `0 0 6px ${FLUX.hot}` : 'none',
        }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* placement 1 — ambient meter popover (production markup, hooked)     */
/* ------------------------------------------------------------------ */

function MiniBar({
  reading,
  geometry,
}: {
  reading: MeterReading;
  geometry: boolean;
}) {
  const tone = meterTone(reading);
  const o = geometry ? opportunityOf(reading) : null;
  const usedW = Math.min(100, reading.usedPercent);
  const projW = o
    ? Math.max(0, Math.min(100 - usedW, reading.projectedPercent - usedW))
    : 0;
  const expiryStart = Math.min(100, usedW + projW);
  return (
    <span aria-hidden className="relative block h-[7px] w-full">
      <span
        className="absolute top-[1.5px] h-[4px] w-full rounded-[2px]"
        style={{ background: tone.track }}
      />
      <span
        className="absolute top-[1.5px] h-[4px] rounded-l-[2px]"
        style={{
          width: `${Math.max(1, usedW)}%`,
          background: tone.fill,
        }}
      />
      {o && projW > 0.5 && (
        <span
          className="absolute top-[1.5px] h-[4px]"
          style={{
            left: `${usedW}%`,
            width: `${projW}%`,
            background: projectionHatch(consumptionAlpha(tone.fill, 0.85)),
          }}
        />
      )}
      {o && expiryStart < 99.5 && (
        <span
          className="absolute top-[1.5px] h-[4px]"
          style={{
            left: `${expiryStart}%`,
            width: `${100 - expiryStart}%`,
            background: expiryHatch(),
          }}
          title={floorTitle(o)}
        />
      )}
      <span
        className="absolute top-0 h-full"
        style={{
          left: `calc(${Math.min(100, reading.evenPacePercent)}% - 0.5px)`,
          width: 1,
          background: METER_MONO.tick,
        }}
      />
    </span>
  );
}

function StudyWindowRow({
  reading,
  headline,
  direction,
}: {
  reading: MeterReading;
  headline: boolean;
  direction: DirectionId;
}) {
  const tone = meterTone(reading);
  const o = opportunityOf(reading);
  const faint = CHROME.textFaint;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span
          className="whitespace-nowrap font-ui text-chrome-meta"
          style={{ color: CHROME.textDim }}
        >
          {reading.window.label}
        </span>
        {headline && (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 self-center rounded-full"
            style={{ background: tone.fill }}
          />
        )}
        <span
          className="ml-auto font-mono text-chrome-label font-medium tabular-nums"
          style={{ color: tone.text }}
        >
          {reading.state === 'exhausted'
            ? 'spent'
            : percent(reading.usedPercent)}
        </span>
        <span
          className="whitespace-nowrap font-mono text-chrome-micro tabular-nums"
          style={{ color: faint }}
        >
          resets in {duration(reading.msToReset)}
        </span>
      </div>
      <MiniBar reading={reading} geometry={direction === 'geometry'} />
      <p
        className="flex items-baseline gap-2 font-ui text-chrome-micro leading-4"
        style={{ color: faint }}
      >
        {direction === 'swap' && o ? (
          <span
            style={{ color: o.tier === 'closing' ? CHROME.text : faint }}
            title={floorTitle(o)}
          >
            {swapSentence(reading, o)}
          </span>
        ) : (
          <span>
            {paceSentence(reading)}
            {reading.exhaustsBeforeReset && reading.state !== 'exhausted' && (
              <span
                style={{ color: tone.colored ? tone.text : CHROME.textDim }}
              >
                {' '}
                · spent in {duration(reading.msToExhaust)} at this pace
              </span>
            )}
          </span>
        )}
        {direction === 'geometry' && o && (
          <span
            className="ml-auto whitespace-nowrap font-mono tabular-nums"
            style={{
              color: o.tier === 'closing' ? CHROME.text : CHROME.textDim,
            }}
            title={floorTitle(o)}
          >
            {o.coursePts}% expires
          </span>
        )}
      </p>
      {direction === 'chip' && o && <OpportunityChip reading={reading} o={o} />}
    </div>
  );
}

function StudyPopover({
  state,
  direction,
}: {
  state: OpportunityFixtureState;
  direction: DirectionId;
}) {
  const snapshot = readMeter(state.sources, state.nowMs);
  const r = snapshot.reading;
  const tone = meterTone(r);
  const hotHint = r ? remediationHint(r) : null;
  const coach =
    direction === 'swap' && !hotHint ? closingOpportunity(state) : null;
  return (
    <div
      className="exa-material-overlay relative w-[296px] overflow-hidden rounded-md border shadow-2xl"
      style={{ borderColor: CHROME.borderStrong }}
    >
      <div
        className="flex items-baseline gap-2 border-b px-3 py-2"
        style={{ borderColor: CHROME.border }}
      >
        <span
          className="font-ui text-chrome-label font-semibold"
          style={{ color: CHROME.text }}
        >
          Usage
        </span>
        {r && (
          <span
            className="font-ui text-chrome-micro"
            style={{ color: tone.colored ? tone.text : CHROME.textDim }}
          >
            {r.state === 'exhausted'
              ? `${r.window.label.toLowerCase()} spent · resets in ${duration(r.msToReset)}`
              : `${r.window.label.toLowerCase()} at ${percent(r.usedPercent)} · ${paceSentence(r)}`}
          </span>
        )}
      </div>

      {state.sources.map(source => (
        <SourceRows
          key={source.key}
          source={source}
          state={state}
          direction={direction}
        />
      ))}

      {hotHint && (
        <p
          className="border-t px-3 py-2 font-ui text-chrome-micro leading-4"
          style={{ borderColor: CHROME.border, color: tone.text }}
        >
          {hotHint}
        </p>
      )}
      {coach && (
        <p
          className="border-t px-3 py-2 font-ui text-chrome-micro leading-4"
          style={{ borderColor: CHROME.border, color: CHROME.textDim }}
        >
          {coachLine(coach.reading, coach.o)}
        </p>
      )}

      <div
        className="flex items-center gap-1.5 border-t px-3 py-1.5"
        style={{ borderColor: CHROME.border, background: CHROME.hover }}
      >
        <span
          className="font-ui text-chrome-micro"
          style={{ color: CHROME.textFaint }}
        >
          Open Usage
        </span>
        <span
          aria-hidden
          className="ml-auto font-mono text-chrome-micro"
          style={{ color: CHROME.textFaint }}
        >
          →
        </span>
      </div>
    </div>
  );
}

function SourceRows({
  source,
  state,
  direction,
}: {
  source: ConsumptionSourceView;
  state: OpportunityFixtureState;
  direction: DirectionId;
}) {
  const snapshot = readMeter(state.sources, state.nowMs);
  const readings = readAllWindows(source, state.nowMs);
  return (
    <div
      className="flex flex-col gap-2 border-t px-3 py-2.5 first:border-t-0"
      style={{ borderColor: CHROME.border }}
    >
      <span
        className="font-ui text-chrome-label font-medium"
        style={{ color: CHROME.text }}
      >
        {HARNESS_LABEL[source.harness]}
      </span>
      {readings.length === 0 ? (
        <p
          className="font-ui text-chrome-micro leading-4"
          style={{ color: CHROME.textFaint }}
        >
          No plan record on disk — this source is unmetered here, not at zero.
        </p>
      ) : (
        readings.map(reading => (
          <StudyWindowRow
            key={reading.window.limitId}
            reading={reading}
            headline={
              snapshot.reading?.window.limitId === reading.window.limitId &&
              snapshot.reading?.source.key === reading.source.key
            }
            direction={direction}
          />
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* placement 2 — /usage Headroom band (production chrome components)   */
/* ------------------------------------------------------------------ */

function StudyHeadroom({
  state,
  direction,
}: {
  state: OpportunityFixtureState;
  direction: DirectionId;
}) {
  const paces = state.sources
    .flatMap(s => readAllWindows(s, state.nowMs))
    .sort((a, b) => b.usedPercent - a.usedPercent);
  const silent = state.sources.filter(s => s.windows.length === 0);
  const [headline, ...rest] = paces;
  if (!headline) return null;
  const label = paceLabel(headline);
  const oHead = opportunityOf(headline);
  const Bar = direction === 'geometry' ? ExpiryPaceBar : PaceBar;
  const coach =
    direction === 'swap' &&
    !paces.some(p => p.exhaustsBeforeReset || p.state === 'exhausted')
      ? closingOpportunity(state)
      : null;
  return (
    <Band
      label="Headroom"
      aside={
        <Caption>
          {headline.source.label} · {headline.window.label}
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
              resets in {duration(headline.msToReset)} ·{' '}
              {direction === 'swap' && oHead
                ? `${oHead.freePts}% free to spend`
                : label.text}
            </Body>
            {direction === 'chip' && oHead && (
              <OpportunityChip reading={headline} o={oHead} />
            )}
          </div>
          <Bar pace={headline} height={10} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {rest.map(p => (
            <StudyBandRow
              key={p.window.limitId}
              pace={p}
              direction={direction}
            />
          ))}
          {silent.map(s => (
            <div key={s.key} className="flex min-w-0 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <Body className="truncate" color={CHROME.textDim}>
                  {s.label} · plan
                </Body>
                <Data color={FLUX.unknown}>no plan record</Data>
              </div>
              <UnreportedChannel
                observed={s.observedTokens5h}
                reason={s.unreportedReason}
                height={6}
              />
            </div>
          ))}
        </div>
      </div>
      {coach && <Caption>{coachLine(coach.reading, coach.o)}</Caption>}
      {direction === 'swap' && state.lastCycle && (
        <Caption>{ledgerLine(state.lastCycle)}</Caption>
      )}
    </Band>
  );
}

function StudyBandRow({
  pace,
  direction,
}: {
  pace: MeterReading;
  direction: DirectionId;
}) {
  const o = opportunityOf(pace);
  const Bar = direction === 'geometry' ? ExpiryPaceBar : PaceBar;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Body className="truncate" color={CHROME.textDim}>
          {pace.source.label} · {pace.window.label}
        </Body>
        {direction === 'swap' && o ? (
          <Data bright>
            {o.freePts}% free · resets in {duration(pace.msToReset)}
          </Data>
        ) : (
          <Data bright>
            {percent(pace.usedPercent)} · resets in {duration(pace.msToReset)}
          </Data>
        )}
      </div>
      <Bar pace={pace} height={6} />
      {direction === 'chip' && o && <OpportunityChip reading={pace} o={o} />}
      {direction === 'geometry' && o && (
        <span
          className="self-end font-mono text-chrome-micro tabular-nums"
          style={{
            color: o.tier === 'closing' ? CHROME.text : CHROME.textDim,
          }}
          title={floorTitle(o)}
        >
          {o.coursePts}% expires unused at this pace
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* workbench chrome — switcher, spec, assessments                      */
/* ------------------------------------------------------------------ */

const DIRECTIONS: {
  id: DirectionId;
  name: string;
  thesis: string;
  recommended?: boolean;
  assessment: { label: string; text: string }[];
}[] = [
  {
    id: 'chip',
    name: 'Direction A — Quiet chip',
    thesis:
      'One added object: an outline chip past the threshold, monochrome family only. Appears, states two facts, disappears without a trace.',
    assessment: [
      {
        label: 'Glance',
        text: 'Strong — a discrete object appears and disappears; scannable without reading the numbers.',
      },
      {
        label: 'False positives',
        text: 'Medium — overnight idle keeps the chip lit for hours; a chip that is always there at breakfast becomes furniture with a border.',
      },
      {
        label: 'Next to the alarm',
        text: 'Clean color separation (grey outline vs hot fill), but it adds an object class the popover otherwise does not have.',
      },
      {
        label: 'Both fire',
        text: 'Correctly subordinate — the hot row keeps color and the coach slot; the chip stays grey. Rows now grow taller when the chip lands.',
      },
      {
        label: 'Expired',
        text: 'Silent. The chip family has no memory.',
      },
      {
        label: 'Adoption cost',
        text: 'New component and popover row growth; no shared-vocabulary change.',
      },
    ],
  },
  {
    id: 'geometry',
    name: 'Direction B — Expiry geometry',
    thesis:
      'No new object: the bar itself draws the region that dies unused — fill, projection hatch forward, +45° neutral hatch to the ceiling. Magnitude as area, never as color.',
    assessment: [
      {
        label: 'Glance',
        text: 'Weak at popover scale — a 4px hatch region needs reading; strong on the /usage bar where the region has real area and size is honest.',
      },
      {
        label: 'False positives',
        text: 'Lowest — area encodes magnitude, so a borderline trigger draws a visibly small region instead of overclaiming.',
      },
      {
        label: 'Next to the alarm',
        text: 'Texture collision: −45° grey hatch already means unreported and −45° color hatch means projection; a third texture asks for a legend at micro scale.',
      },
      {
        label: 'Both fire',
        text: 'Both hatch meanings render in one panel beside the alarm colors — the legend problem made real.',
      },
      {
        label: 'Expired',
        text: 'Silent. A fresh bar has no place for last cycle.',
      },
      {
        label: 'Adoption cost',
        text: 'PaceBar and the popover bar both grow a segment; the design system must record a third hatch meaning.',
      },
    ],
  },
  {
    id: 'swap',
    name: 'Direction C — Metric swap + coach',
    recommended: true,
    thesis:
      'The line the operator already reads changes what it says: the pace deficit becomes free-to-spend. One coach line in the quiet register at the closing tier; hot always outranks it.',
    assessment: [
      {
        label: 'Glance',
        text: 'Strong where the operator already looks — no new object; the line he already scans changes what it says, in the slot the hot coach trained him on.',
      },
      {
        label: 'False positives',
        text: 'Smallest surface — the open tier only re-words an existing line; the coach speaks only at the closing tier, so idle nights show one dim phrase, not furniture.',
      },
      {
        label: 'Next to the alarm',
        text: 'Distinct by construction — dim neutral words vs the hot ramp, and the hint slot has a priority rule: hot always wins.',
      },
      {
        label: 'Both fire',
        text: 'The weekly line still swaps, but the coach yields to the hot remediation — one voice at a time, alarm first.',
      },
      {
        label: 'Expired',
        text: 'The only direction with a memory: one ledger caption on /usage; the popover stays clean.',
      },
      {
        label: 'Adoption cost',
        text: 'Amends the shared pace vocabulary in meter-model — one place, both placements inherit; it is a wording change to a settled line.',
      },
    ],
  },
];

function ColumnLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-[0.2em]"
      style={{ color: HUD.textDim }}
    >
      {children}
    </span>
  );
}

function PredicateSpec() {
  const line = (l: string) => (
    <span className="block whitespace-pre font-mono text-chrome-label leading-5">
      {l}
    </span>
  );
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:gap-8"
      style={{ borderColor: HUD.strokeSoft, background: HUD.bg.panelFill }}
    >
      <div style={{ color: HUD.text }}>
        {line('opportunity = state ∈ {healthy, warm}')}
        {line('            ∧ pace = behind        (the shared ±5 verdict)')}
        {line('            ∧ floor ≥ 15 pts       ∧ reset ≥ 30m away')}
        {line('closing     = floor ≥ 30 pts ∨ reset ≤ ¼ window')}
      </div>
      <div
        className="max-w-[64ch] text-chrome-meta leading-5"
        style={{ color: HUD.textDim }}
      >
        <p>
          <span style={{ color: HUD.text }}>floor</span> = even-pace% − used%:
          expires unused even if burn returns to even pace this instant — pure
          geometry over two reported facts, so the trigger is burn-noise-free. A
          floor of N pts requires N% of the window to have elapsed, so a large
          floor can only exist late in a window.
        </p>
        <p className="mt-1.5">
          <span style={{ color: HUD.text }}>course</span> = 100 − projected%:
          expires at the current burn — the number the copy shows, never the
          gate. 15 pts is 3× the even band (~45m of full-rate work on a 5-hour
          window, ~a day on a weekly). Hot and spent windows never speak here:
          the alarm channel wins outright. The standing false positive is
          deliberate idle — overnight, every window drifts behind — which is why
          the voice must survive being ignored.
        </p>
      </div>
    </div>
  );
}

export function PaceOpportunityStudy() {
  const [stateId, setStateId] = useState('strongly-behind');
  const state =
    OPPORTUNITY_STATES.find(s => s.id === stateId) ?? OPPORTUNITY_STATES[0];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-1.5">
        {OPPORTUNITY_STATES.map(s => {
          const on = s.id === state.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStateId(s.id)}
              aria-pressed={on}
              className="rounded border px-2.5 py-1 font-mono text-chrome-label transition-colors duration-200 motion-reduce:transition-none"
              style={{
                borderColor: on ? HUD.strokeSoft : 'transparent',
                color: on ? HUD.cyan : HUD.textDim,
                background: on ? 'rgba(25,230,255,0.06)' : 'transparent',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <p
        className="max-w-[92ch] text-chrome-meta leading-5"
        style={{ color: HUD.textDim }}
      >
        {state.caption}
      </p>

      <PredicateSpec />

      {DIRECTIONS.map(d => (
        <section
          key={d.id}
          aria-label={d.name}
          className="flex flex-col gap-4 rounded-lg border p-4"
          style={{ borderColor: HUD.strokeSoft, background: HUD.bg.panelFill }}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3
              className="font-display text-base font-semibold"
              style={{ color: HUD.text }}
            >
              {d.name}
            </h3>
            {d.recommended && (
              <span
                className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                style={{ color: HUD.cyan, borderColor: HUD.strokeSoft }}
              >
                Recommended
              </span>
            )}
            <span
              className="max-w-[80ch] text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
              {d.thesis}
            </span>
          </div>

          <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <ColumnLabel>Ambient meter popover</ColumnLabel>
              <StudyPopover state={state} direction={d.id} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <ColumnLabel>/usage · Headroom band</ColumnLabel>
              <StudyHeadroom state={state} direction={d.id} />
            </div>
          </div>

          <dl className="grid gap-x-8 gap-y-1.5 lg:grid-cols-2">
            {d.assessment.map(a => (
              <div key={a.label} className="flex items-baseline gap-2">
                <dt
                  className="w-32 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: HUD.textDim }}
                >
                  {a.label}
                </dt>
                <dd
                  className="text-chrome-meta leading-5"
                  style={{ color: HUD.text }}
                >
                  {a.text}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <p
        className="max-w-[100ch] text-chrome-meta leading-5"
        style={{ color: HUD.textDim }}
      >
        <span style={{ color: HUD.text }}>Recommendation:</span> Direction C. It
        spends no new pixels below the threshold, re-frames the exact line the
        settled idiom already owns, and degrades correctly beside the alarm —
        hot outranks it and no color moves. Direction B&rsquo;s expiry region
        remains a compatible later addition on the /usage bar alone; Direction A
        adds standing furniture the deliberate-idle false positive would wear
        out. Operator picks.
      </p>
    </div>
  );
}
