'use client';

/**
 * Direction C — INSTRUMENT. The cockpit reading.
 *
 * Thesis: at two seconds an operator can read one verdict and one scale. So
 * spend the whole first screen on those, put the second voice (an allocation
 * expiring unused) beside it as a peer rather than below it, and earn every
 * other number by drill.
 *
 * The one thing this direction adds that nothing in the E12 corpus has: a
 * READ TIMELINE per source — a Grafana-style state strip over the last three
 * days showing when each source was actually readable. It is the difference
 * between "the number is low" and "nobody asked the number in eighteen hours".
 */
import { useState } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  duration,
  percent,
  pressureColorCss as pressureColor,
  tokens,
} from '@/components/consumption/flux';
import { paceSentence } from '@/components/consumption/meter/meter-model';
import { Body, Caption, Data, MicroLabel, Num } from '@/app/usage/chrome';
import {
  AsOf,
  AttentionBlock,
  BoundLine,
  Repair,
  Section,
  StateWord,
  Tape,
  VendorMark,
  VerdictWord,
} from './parts';
import {
  ambientProjection,
  readTimeline,
  type RosterView,
  type WindowRow,
} from './model';

const SPAN_MS = 3 * 24 * 3_600_000;

export function InstrumentDirection({ view }: { view: RosterView }) {
  const [drill, setDrill] = useState<'none' | 'sources' | 'timeline'>('none');
  const h = view.headline;
  const primary = h.binding;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ---- the instrument ---- */}
      <Section
        label="Right now"
        aside={
          <span className="flex items-center gap-2">
            <RosterPips view={view} />
            <Caption>{h.coverage.line}</Caption>
          </span>
        }
      >
        <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <VerdictWord word={h.verdict.word} tone={h.verdict.tone} />
            <Body color={h.verdict.tone === 'hot' ? FLUX.hot : CHROME.text}>
              {h.verdict.because}
            </Body>
            {h.verdict.degradedNote && (
              <Body color="var(--exa-hud-amber)">{h.verdict.degradedNote}</Body>
            )}
            {primary && h.bindingSource ? (
              <PrimaryScale
                w={primary}
                label={`${h.bindingSource.account} · ${primary.label}`}
              />
            ) : (
              <Caption>
                No source on this machine reports a plan window.
              </Caption>
            )}
            <BoundLine bound={h.bound} coverage={h.coverage} scan={view.scan} />
          </div>

          {/* the second voice — a peer, not a footnote */}
          <div className="flex min-w-0 flex-col gap-2">
            <MicroLabel>Expiring unused</MicroLabel>
            {h.expiring && h.expiringSource ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <Num color={FLUX.calm}>
                    {h.expiring.opportunity?.coursePts ?? 0}%
                  </Num>
                  <Body color={CHROME.textDim}>dies at this pace</Body>
                </div>
                <Body className="truncate">
                  {h.expiringSource.account} · {h.expiring.label}
                </Body>
                <Tape w={h.expiring} />
                <Caption>
                  {paceSentence(h.expiring.read)} · resets in{' '}
                  {duration(h.expiring.read.msToReset)}
                </Caption>
              </>
            ) : (
              <Caption>
                No window is running far enough behind pace to matter.
              </Caption>
            )}
          </div>
        </div>
      </Section>

      <AttentionBlock rows={view.attention} nowMs={view.nowMs} />

      {/* ---- earned by drill ---- */}
      <div className="flex flex-wrap gap-2">
        <DrillButton
          active={drill === 'sources'}
          onClick={() => setDrill(d => (d === 'sources' ? 'none' : 'sources'))}
        >
          Sources · {view.rows.length}
        </DrillButton>
        <DrillButton
          active={drill === 'timeline'}
          onClick={() =>
            setDrill(d => (d === 'timeline' ? 'none' : 'timeline'))
          }
        >
          Read history · 3 days
        </DrillButton>
      </div>

      {drill === 'sources' && (
        <Section label="Sources">
          {view.rows.map(row => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-x-4 border-b py-2 last:border-b-0"
              style={{ borderColor: withAlpha(CHROME.border, 0.6) }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <VendorMark row={row} />
                <Body className="truncate">{row.account}</Body>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                {row.windows[0] ? (
                  <>
                    <Data>
                      {row.windows[0].label} ·{' '}
                      {percent(row.windows[0].read.usedPercent)} used · resets
                      in {duration(row.windows[0].read.msToReset)}
                    </Data>
                    <Tape w={row.windows[0]} height={4} />
                  </>
                ) : (
                  <Caption>{row.note}</Caption>
                )}
              </span>
              <span className="flex items-center gap-3">
                <StateWord row={row} />
                <AsOf row={row} nowMs={view.nowMs} />
                <Repair row={row} />
              </span>
            </div>
          ))}
        </Section>
      )}

      {drill === 'timeline' && <ReadTimeline view={view} />}
    </div>
  );
}

/**
 * The roster, compressed to one pip per source and kept beside the coverage
 * line — so an Instrument that hides its detail still cannot hide a source.
 * Same rows, same order, one column (Monarch's dots-not-percentages idiom).
 */
function RosterPips({ view }: { view: RosterView }) {
  const a = ambientProjection(view);
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {a.cells.map(cell => (
        <span
          key={cell.id}
          title={cell.short}
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background:
              cell.state === 'unreadable'
                ? 'var(--exa-hud-amber)'
                : cell.usedPercent === null
                  ? 'transparent'
                  : cell.hot
                    ? FLUX.hot
                    : pressureColor(cell.usedPercent),
            boxShadow:
              cell.usedPercent === null
                ? `inset 0 0 0 1px ${withAlpha(FLUX.unknown, 0.7)}`
                : 'none',
          }}
        />
      ))}
    </span>
  );
}

/**
 * The primary scale: one tape at instrument size with its bugs LABELLED on
 * the scale, so the reading is legible without a legend.
 */
function PrimaryScale({ w, label }: { w: WindowRow; label: string }) {
  const r = w.read;
  const even = Math.min(100, r.evenPacePercent);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Num color={pressureColor(r.usedPercent)}>{percent(r.usedPercent)}</Num>
        <Body color={CHROME.textDim}>{label}</Body>
      </div>
      <Tape w={w} height={16} />
      <div className="relative h-4 w-full">
        <span className="absolute left-0 top-0">
          <Caption>window start</Caption>
        </span>
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${Math.min(88, Math.max(12, even))}%` }}
        >
          <Caption>even pace {percent(even)}</Caption>
        </span>
        <span className="absolute right-0 top-0">
          <Caption>limit</Caption>
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4">
        <Data bright>
          {w.ratePerHour === null
            ? 'projection — no prior data'
            : `→ ${Math.round(r.projectedPercent)}% at reset`}
        </Data>
        <Data>{paceSentence(r)}</Data>
        <Data>resets in {duration(r.msToReset)}</Data>
      </div>
    </div>
  );
}

function DrillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded border px-2.5 py-1 text-chrome-label"
      style={{
        borderColor: CHROME.border,
        color: active ? CHROME.text : CHROME.textDim,
        background: active ? withAlpha(CHROME.text, 0.08) : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

/** Grafana's state timeline, per source, over the real observation series. */
function ReadTimeline({ view }: { view: RosterView }) {
  const rows = readTimeline(view, SPAN_MS);
  const end = view.nowMs;
  const start = end - SPAN_MS;
  const pct = (t: number) => ((t - start) / SPAN_MS) * 100;
  return (
    <Section
      label="Read history"
      aside={
        <Caption>
          three days · a gap is nobody asking, not nothing happening
        </Caption>
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
        {rows.map(r => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5rem] items-center gap-x-3"
          >
            <Body className="truncate" color={CHROME.textDim}>
              {r.label}
            </Body>
            <span
              aria-hidden
              className="relative inline-block h-3 w-full rounded-[1px]"
              style={{ background: withAlpha(CHROME.text, 0.06) }}
            >
              {r.segments.map((s, i) => (
                <span
                  key={i}
                  className="absolute top-0 h-full"
                  style={{
                    left: `${Math.max(0, pct(s.startMs))}%`,
                    width: `${Math.max(0.4, pct(s.endMs) - Math.max(0, pct(s.startMs)))}%`,
                    background:
                      s.state === 'reporting'
                        ? withAlpha(FLUX.calm, 0.85)
                        : s.state === 'gap'
                          ? `repeating-linear-gradient(-45deg, ${withAlpha(FLUX.unknown, 0.4)} 0 1px, transparent 1px 5px)`
                          : withAlpha(FLUX.unknown, 0.12),
                  }}
                />
              ))}
            </span>
            <Data
              className="text-right"
              color={r.coverage === 0 ? FLUX.unknown : undefined}
            >
              {r.coverage === 0
                ? 'never'
                : `${Math.round(r.coverage * 100)}% read`}
            </Data>
          </div>
        ))}
      </div>
      <Caption>
        {tokens(view.corpus.samples)} local records over{' '}
        {view.corpus.windowDays} days ·{' '}
        {view.scan.complete ? 'complete pass' : 'partial pass'}
      </Caption>
    </Section>
  );
}
