'use client';

/**
 * `/hud-gallery` study — the pace opportunity voice (ENG-008 E9).
 *
 * SUBJECT PARTLY SHIPPED (operator pick, 2026-08-11): **C + B landed** —
 * Direction C's metric swap + coach is production vocabulary everywhere
 * (`paceSentence` / `paceLabel` / `opportunityCoach` in `meter-model`), and
 * Direction B's expiry geometry ships on the `/usage` pace bars only
 * (`PaceBar` in `usage/chrome.tsx`). B stays OFF the popover, where this
 * study proved a 4px hatch region unreadable. Direction A (the quiet chip)
 * did not ship.
 *
 * The study stays as the review bench for the one unshipped direction and
 * the fixture states. Because the specimens import the production predicate
 * and vocabulary, every direction's caption lines now read the SHIPPED
 * metric-swap wording — the pure pre-pick renders of A and B live in git
 * history and the E9 milestone-log screenshots.
 *
 * Channel discipline, common to all three: opportunity NEVER borrows the
 * alarm channel. No FLUX warm/hot, no amber, no status colors, no motion —
 * the whole voice lives inside the monochrome family the meter already
 * uses at rest, so a hot window and an expiring window can never be
 * confused, and ignoring one cannot teach the operator to ignore the other.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { HUD } from '@/components/hud/tokens';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha,
  duration,
  expiryHatch,
  percent,
  projectionHatch,
} from '@/components/consumption/flux';
import { HARNESS_LABEL } from '@/components/consumption/model';
import type { ConsumptionSourceView } from '@/components/consumption/model';
import {
  closingOpportunity,
  coachLine,
  floorTitle,
  ledgerLine,
  meterTone,
  opportunityOf,
  paceSentence,
  readAllWindows,
  readMeter,
  remediationHint,
  METER_MONO,
  type MeterReading,
  type OpportunityRead,
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
  OPPORTUNITY_STATES,
  type OpportunityFixtureState,
} from './pace-opportunity-model';

type DirectionId = 'chip' | 'geometry' | 'swap';

/** Every live reading in a fixture state — the shared derivation input. */
function stateReadings(state: OpportunityFixtureState): MeterReading[] {
  return state.sources.flatMap(s => readAllWindows(s, state.nowMs));
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

/* Direction B's page-bar geometry SHIPPED into the production `PaceBar`
 * (`usage/chrome.tsx`), so the page placement below simply renders it. The
 * popover MiniBar variant stays study-local: it is the rejected placement,
 * kept as the record of why B stays off the popover. */

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
        {o ? (
          // the SHIPPED metric swap — `paceSentence` re-frames itself
          <span
            style={{ color: o.tier === 'closing' ? CHROME.text : faint }}
            title={floorTitle(o)}
          >
            {paceSentence(reading)}
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
  // the SHIPPED coach slot: hot always outranks (production arbiter)
  const coach = hotHint ? null : closingOpportunity(stateReadings(state));
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
  // `paceLabel` carries the SHIPPED metric swap ("N% free to spend") itself.
  const label = paceLabel(headline);
  const oHead = opportunityOf(headline);
  // the SHIPPED coach slot: any hot or spent window silences it outright
  const coach = paces.some(p => p.state === 'hot' || p.state === 'exhausted')
    ? null
    : closingOpportunity(paces);
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
              resets in {duration(headline.msToReset)} · {label.text}
            </Body>
            {direction === 'chip' && oHead && (
              <OpportunityChip reading={headline} o={oHead} />
            )}
          </div>
          <PaceBar pace={headline} height={10} />
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
      {state.lastCycle && <Caption>{ledgerLine(state.lastCycle)}</Caption>}
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
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Body className="truncate" color={CHROME.textDim}>
          {pace.source.label} · {pace.window.label}
        </Body>
        {o ? (
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
  /** The 2026-08-11 operator pick, per direction. */
  outcome?: string;
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
    outcome: 'Shipped · /usage bars only',
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
    outcome: 'Shipped · both placements',
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
            {d.outcome && (
              <span
                className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                style={{ color: HUD.cyan, borderColor: HUD.strokeSoft }}
              >
                {d.outcome}
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
        <span style={{ color: HUD.text }}>Outcome (operator, 2026-08-11):</span>{' '}
        C + B. Direction C shipped everywhere — the metric swap lives in
        `meter-model`&rsquo;s shared pace vocabulary, the coach in the one
        arbiter where hot always outranks, and the expired ledger as a
        `/usage` caption. Direction B&rsquo;s expiry region shipped on the
        /usage pace bars alone; the popover placement stays rejected at that
        scale. Direction A did not ship — standing furniture the
        deliberate-idle false positive would wear out.
      </p>
    </div>
  );
}
