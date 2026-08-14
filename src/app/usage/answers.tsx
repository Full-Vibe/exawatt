'use client';

/**
 * Bands 2–5 — the remaining operator questions, in the order they are asked:
 *
 *   Burn  — how fast am I going?   observed %/h and the window's shape
 *   Pace  — am I on pace?          the shared verdict + projection at reset
 *   Heat  — am I overheating?      windows that exhaust before their reset
 *   Spend — how much am I spending? modelled dollars, labelled modelled
 *
 * Every reading comes off the one shared derivation (`meter-model`) the
 * chrome meter renders — the page and the title bar can never disagree.
 */
import { useMemo } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  dollars,
  duration,
  percent,
  tokens,
} from '@/components/consumption/flux';
import {
  modelledDollars,
  planCredits as planCreditAmount,
} from '@/components/consumption/units';
import { windowOwnerLabel } from '@/components/consumption/model';
import { remediationHint } from '@/components/consumption/meter/meter-model';
import type { DemoConsumption } from '@/components/consumption/demo-source';
import {
  heatWindows,
  operatorSamples,
  windowTimeline,
  type PlanCreditRow,
  type SpendView,
  type WindowPace,
} from './derive';
import {
  Band,
  Body,
  Caption,
  Data,
  paceFill,
  paceLabel,
  verdictColor,
} from './chrome';

/* ------------------------------------------------------------------ */
/* Burn — how fast am I going?                                         */
/* ------------------------------------------------------------------ */

export function Burn({
  demo,
  paces,
}: {
  demo: DemoConsumption;
  paces: WindowPace[];
}) {
  const headline = paces[0];
  if (!headline) return null;
  return (
    <Band
      label="Burn"
      aside={
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {paces.map(p => (
            <span key={p.window.limitId} className="flex items-baseline gap-1.5">
              <Caption>
                {windowOwnerLabel(p.source, p.window)} · {p.window.label}
              </Caption>
              <Data bright>{p.window.burnPercentPerHour.toFixed(1)}%/h</Data>
            </span>
          ))}
        </span>
      }
    >
      <BurnChart demo={demo} pace={headline} />
      <Caption>
        shape measured from local logs · scaled to the harness&rsquo;s reported{' '}
        {percent(headline.usedPercent)}
      </Caption>
    </Band>
  );
}

/** Measured past, hatched projection to reset, even-pace diagonal. */
function BurnChart({
  demo,
  pace,
}: {
  demo: DemoConsumption;
  pace: WindowPace;
}) {
  const W = 960;
  const H = 150;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const samples = useMemo(() => operatorSamples(demo), [demo]);
  const line = useMemo(
    () => windowTimeline(pace, samples, demo.nowMs, 48),
    [pace, samples, demo.nowMs]
  );
  const startMs = pace.window.resetsAtMs - pace.window.windowMinutes * 60_000;
  const x = (t: number) =>
    padL + ((t - startMs) / (pace.window.resetsAtMs - startMs)) * innerW;
  const y = (pct: number) =>
    padT + innerH - (Math.min(pct, 105) / 105) * innerH;

  const color = paceFill(pace);
  const pastPath = line
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.pct).toFixed(1)}`
    )
    .join(' ');
  const nowX = x(demo.nowMs);
  const nowY = y(pace.usedPercent);
  const projY = y(Math.min(pace.projectedPercent, 105));

  /** All chart lettering is one voice: 10px mono, dim (the SVG projection
   *  of the page's Data role — no colored or bright chart text). */
  const letter = {
    fontSize: 10,
    fontFamily: 'var(--font-geist-mono, monospace)',
    fill: CHROME.textDim,
  } as const;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Window position over time: ${percent(pace.usedPercent)} used now, projected ${percent(pace.projectedPercent)} at reset`}
    >
      {/* gridlines + ceiling */}
      {[0, 50, 100].map(g => (
        <g key={g}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(g)}
            y2={y(g)}
            stroke={g === 100 ? withAlpha(FLUX.hot, 0.5) : FLUX.trackLine}
            strokeWidth={1}
            strokeDasharray={g === 100 ? '3 3' : undefined}
          />
          <text x={padL - 6} y={y(g) + 3} textAnchor="end" {...letter}>
            {g}%
          </text>
        </g>
      ))}
      {/* even-pace diagonal */}
      <line
        x1={x(startMs)}
        y1={y(0)}
        x2={x(pace.window.resetsAtMs)}
        y2={y(100)}
        stroke={withAlpha(CHROME.text, 0.4)}
        strokeWidth={1}
        strokeDasharray="2 4"
      />
      {/* measured area under the line */}
      <path
        d={`${pastPath} L${nowX.toFixed(1)},${y(0)} L${x(startMs)},${y(0)} Z`}
        fill={withAlpha(color, 0.12)}
      />
      <path d={pastPath} fill="none" stroke={color} strokeWidth={1.6} />
      {/* projection to reset */}
      <line
        x1={nowX}
        y1={nowY}
        x2={x(pace.window.resetsAtMs)}
        y2={projY}
        stroke={withAlpha(color, 0.9)}
        strokeWidth={1.4}
        strokeDasharray="4 3"
      />
      {/* now marker */}
      <line
        x1={nowX}
        x2={nowX}
        y1={padT}
        y2={H - padB}
        stroke={withAlpha(CHROME.text, 0.35)}
        strokeWidth={1}
      />
      <circle cx={nowX} cy={nowY} r={3} fill={color} />
      <text x={nowX + 5} y={padT + 10} {...letter}>
        now · {percent(pace.usedPercent)}
      </text>
      <text
        x={W - padR}
        y={
          pace.projectedPercent > 100
            ? projY + 20
            : Math.max(padT + 10, projY - 6)
        }
        textAnchor="end"
        {...letter}
      >
        {percent(pace.projectedPercent)} at reset
      </text>
      {/* x labels */}
      <text x={padL} y={H - 6} {...letter}>
        window start
      </text>
      <text x={W - padR} y={H - 6} textAnchor="end" {...letter}>
        reset in {duration(pace.msToReset)}
      </text>
      <text x={padL + innerW * 0.42} y={y(38)} {...letter}>
        even pace
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Pace — am I on pace?                                                */
/* ------------------------------------------------------------------ */

export function Pace({ paces }: { paces: WindowPace[] }) {
  return (
    <Band label="Pace">
      {/* a fresh machine has no live window to pace — state it, never a
          bare card (E5 empty-state honesty) */}
      {paces.length === 0 && <Caption>No live plan window to pace.</Caption>}
      <div className="flex flex-col gap-2.5">
        {paces.map(p => {
          const label = paceLabel(p);
          return (
            <div
              key={p.window.limitId}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="flex min-w-0 flex-col">
                <Body className="truncate" color={verdictColor(p)}>
                  {label.text}
                </Body>
                <Caption>
                  {windowOwnerLabel(p.source, p.window)} · {p.window.label}
                </Caption>
              </span>
              <Data bright>
                → {percent(Math.min(p.projectedPercent, 100))}
                {p.projectedPercent > 100 ? '+' : ''} at reset
              </Data>
            </div>
          );
        })}
      </div>
    </Band>
  );
}

/* ------------------------------------------------------------------ */
/* Heat — am I overheating?                                            */
/* ------------------------------------------------------------------ */

export function Heat({ paces }: { paces: WindowPace[] }) {
  const hot = heatWindows(paces);
  return (
    <Band label="Heat">
      {hot.length === 0 ? (
        <Caption>No window exhausts before its reset.</Caption>
      ) : (
        <div className="flex flex-col gap-2.5">
          {hot.map(p => {
            const hint = remediationHint(p);
            return (
              <div key={p.window.limitId} className="flex min-w-0 flex-col">
                <Body color={FLUX.hot}>
                  {windowOwnerLabel(p.source, p.window)} · {p.window.label} ·{' '}
                  {p.exhaustsBeforeReset && p.state !== 'exhausted'
                    ? `spent in ${duration(p.msToExhaust)}`
                    : paceLabel(p).text}
                </Body>
                {hint && <Caption>{hint}</Caption>}
              </div>
            );
          })}
        </div>
      )}
    </Band>
  );
}

/* ------------------------------------------------------------------ */
/* Spend — how much am I spending?                                     */
/* ------------------------------------------------------------------ */

export function Spend({
  spend,
  planCredits: credits = [],
  windowLabel,
}: {
  spend: SpendView;
  /** ENG-038 vendor-reported plan credits. Its own lane, never a sum. */
  planCredits?: PlanCreditRow[];
  windowLabel: string;
}) {
  return (
    <Band label="Spend" aside={<Caption>{windowLabel}</Caption>}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <Body>Operator sessions</Body>
          <Data bright>
            ≈ {dollars(modelledDollars(spend.operatorWeighted))} modelled
          </Data>
        </div>
        {spend.bySource.map(s => (
          <div
            key={s.key}
            className="flex items-baseline justify-between gap-3"
          >
            <Caption>{s.label}</Caption>
            <Data>
              ≈ {dollars(modelledDollars(s.weighted))} · {tokens(s.weighted)} nt
            </Data>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3">
          <Caption>Exawatt overhead</Caption>
          <Data>≈ {dollars(modelledDollars(spend.overheadWeighted))}</Data>
        </div>
        <Caption>list-price model · not billing truth</Caption>
      </div>
      {/* Plan credits are a DIFFERENT ledger, so they get their own lane and
          their own basis label. Plan, overage, and metered API never sum:
          a single total across them is a figure nobody is charged. */}
      {credits.length > 0 && (
        <div
          className="flex flex-col gap-2.5 border-t pt-2.5"
          style={{ borderColor: CHROME.border }}
        >
          {credits.map(row => (
            <div
              key={row.key}
              className="flex items-baseline justify-between gap-3"
            >
              <Body>{row.label}</Body>
              <Data bright>
                {planCreditAmount(row.spend.usedMinor, row.spend)}
                {row.spend.limitMinor !== null
                  ? ` of ${planCreditAmount(row.spend.limitMinor, row.spend)}`
                  : ''}
              </Data>
            </div>
          ))}
          <Caption>plan credits · vendor-reported</Caption>
        </div>
      )}
    </Band>
  );
}
