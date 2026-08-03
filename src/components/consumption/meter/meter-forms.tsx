'use client';

/**
 * Ambient consumption meter — the four candidate forms (ENG-008 options).
 *
 * Every form obeys the same contract:
 *   - true chrome scale: ≤20px tall at `scale = 1`, drawn in SVG so the
 *     zoomed gallery specimen is the identical geometry at `scale = n`;
 *   - constant footprint: state changes recolor and refill, they never
 *     resize — nothing in the title bar may shift when a window runs hot;
 *   - monochrome until it matters: chrome neutrals through healthy/warm,
 *     the FLUX ramp only at hot/exhausted (`meterTone`);
 *   - the pacing tick: a fixed mark at the even-pace position, so fill
 *     ahead of the tick reads "burning ahead" with zero numerals;
 *   - escalation by state change, never by motion — nothing here animates
 *     beyond a color transition, and that is reduced-motion gated.
 *
 * Forms render `aria-hidden`; the interactive wrapper owns the accessible
 * sentence (see `ambient-meter-chrome.tsx`).
 */

import { Zap } from 'lucide-react';
import { duration } from '../flux';
import {
  meterTone,
  METER_MONO,
  type MeterReading,
  type MeterTone,
} from './meter-model';

export type MeterFormId = 'arc' | 'bar' | 'ring' | 'swap';

export const METER_FORM_LABEL: Record<MeterFormId, string> = {
  arc: 'Arc dial',
  bar: 'Fraction bar',
  ring: 'Glyph ring',
  swap: 'Numeral swap',
};

export interface MeterFormProps {
  reading: MeterReading | null;
  /** 1 = true chrome scale. The gallery zooms with 3–4. */
  scale?: number;
}

const COLOR_TRANSITION =
  'transition-[color,fill,stroke] duration-200 motion-reduce:transition-none';

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
) {
  const a = polar(cx, cy, r, startDeg);
  const b = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/* ------------------------------------------------------------------ */
/* 1 · Arc dial — the operator literally said "dial"                   */
/* ------------------------------------------------------------------ */

/**
 * A 240° gauge sweeping from lower-left to lower-right. Fill is used
 * capacity; the radial tick is even pace. Pure shape — no numeral — so at
 * rest it reads like an instrument, not another figure in the title bar.
 */
export function ArcMeter({ reading, scale = 1 }: MeterFormProps) {
  const s = scale;
  const size = 16 * s;
  const cx = size / 2;
  const cy = size / 2;
  const r = 6 * s;
  const START = 150; // degrees; 240° sweep to 390 (=30)
  const SWEEP = 240;
  const tone = meterTone(reading);
  const used = reading ? Math.min(100, reading.usedPercent) / 100 : 0;
  const pace = reading ? Math.min(100, reading.evenPacePercent) / 100 : null;
  const tick = pace !== null ? START + SWEEP * pace : null;

  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      className={`shrink-0 ${COLOR_TRANSITION}`}
    >
      <path
        d={arcPath(cx, cy, r, START, START + SWEEP)}
        fill="none"
        stroke={tone.track}
        strokeWidth={2 * s}
        strokeLinecap="round"
      />
      {reading ? (
        used > 0 && (
          <path
            d={arcPath(cx, cy, r, START, START + SWEEP * Math.max(0.02, used))}
            fill="none"
            stroke={tone.fill}
            strokeWidth={2 * s}
            strokeLinecap="round"
          />
        )
      ) : (
        // no live window: a broken needle, visibly not a reading
        <line
          x1={cx - 2.5 * s}
          y1={cy + 2.5 * s}
          x2={cx + 2.5 * s}
          y2={cy - 2.5 * s}
          stroke={tone.fill}
          strokeWidth={1.2 * s}
        />
      )}
      {tick !== null && (
        <line
          x1={polar(cx, cy, r - 2.2 * s, tick).x}
          y1={polar(cx, cy, r - 2.2 * s, tick).y}
          x2={polar(cx, cy, r + 2.2 * s, tick).x}
          y2={polar(cx, cy, r + 2.2 * s, tick).y}
          stroke={METER_MONO.tick}
          strokeWidth={Math.max(1, 1 * s)}
        />
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Fraction bar — StarCraft supply / Claude Code `/usage`          */
/* ------------------------------------------------------------------ */

/**
 * A compact horizontal track with the even-pace tick, plus the numeral.
 * The most literal form: fill vs tick is the pacing verdict, the numeral
 * is the headroom. At exhausted the numeral swaps to the reset countdown —
 * "100%" is a dead fact, "48m" is the operative one.
 */
export function BarMeter({ reading, scale = 1 }: MeterFormProps) {
  const s = scale;
  const w = 34 * s;
  const h = 5 * s;
  const tone = meterTone(reading);
  const used = reading ? Math.min(100, reading.usedPercent) / 100 : 0;
  const pace = reading ? Math.min(100, reading.evenPacePercent) / 100 : null;
  const label = barLabel(reading);

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center"
      style={{ gap: 5 * s }}
    >
      <svg width={w} height={h + 4 * s} className={COLOR_TRANSITION}>
        <rect
          x={0}
          y={2 * s}
          width={w}
          height={h}
          rx={1.5 * s}
          fill={tone.track}
        />
        {reading ? (
          used > 0 && (
            <rect
              x={0}
              y={2 * s}
              width={Math.max(2 * s, w * used)}
              height={h}
              rx={1.5 * s}
              fill={tone.fill}
            />
          )
        ) : (
          <line
            x1={2 * s}
            y1={2 * s + h - 1}
            x2={w - 2 * s}
            y2={2 * s + 1}
            stroke={tone.fill}
            strokeWidth={1 * s}
          />
        )}
        {pace !== null && (
          <line
            x1={w * pace}
            y1={0.5 * s}
            x2={w * pace}
            y2={h + 3.5 * s}
            stroke={METER_MONO.tick}
            strokeWidth={Math.max(1, 1 * s)}
          />
        )}
      </svg>
      <MeterNumeral scale={s} tone={tone}>
        {label}
      </MeterNumeral>
    </span>
  );
}

function barLabel(reading: MeterReading | null): string {
  if (!reading) return '—';
  if (reading.state === 'exhausted') return duration(reading.msToReset);
  return `${Math.round(reading.usedPercent)}%`;
}

/* ------------------------------------------------------------------ */
/* 3 · Glyph ring — battery idiom, the most dot-like                   */
/* ------------------------------------------------------------------ */

/**
 * A closed ring filling clockwise from 12 o'clock around the consumption
 * glyph. The calmest form: at a glance it is a dot with a halo, and only
 * the halo's extent (against the pace tick) says how the window stands.
 */
export function RingMeter({ reading, scale = 1 }: MeterFormProps) {
  const s = scale;
  const size = 16 * s;
  const cx = size / 2;
  const cy = size / 2;
  const r = 6.4 * s;
  const tone = meterTone(reading);
  const used = reading ? Math.min(100, reading.usedPercent) / 100 : 0;
  const pace = reading ? Math.min(100, reading.evenPacePercent) / 100 : null;
  const START = -90; // 12 o'clock
  const tick = pace !== null ? START + 360 * pace : null;
  const circumference = 2 * Math.PI * r;

  return (
    <span aria-hidden className="relative inline-flex shrink-0">
      <svg width={size} height={size} className={COLOR_TRANSITION}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={tone.track}
          strokeWidth={1.8 * s}
        />
        {reading ? (
          used > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={tone.fill}
              strokeWidth={1.8 * s}
              strokeLinecap="round"
              strokeDasharray={`${circumference * Math.max(0.02, used)} ${circumference}`}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )
        ) : (
          <line
            x1={cx - r}
            y1={cy}
            x2={cx + r}
            y2={cy}
            stroke={tone.fill}
            strokeWidth={1 * s}
            transform={`rotate(-45 ${cx} ${cy})`}
          />
        )}
        {tick !== null && (
          <line
            x1={polar(cx, cy, r - 1.8 * s, tick).x}
            y1={polar(cx, cy, r - 1.8 * s, tick).y}
            x2={polar(cx, cy, r + 1.8 * s, tick).x}
            y2={polar(cx, cy, r + 1.8 * s, tick).y}
            stroke={METER_MONO.tick}
            strokeWidth={Math.max(1, 0.9 * s)}
          />
        )}
      </svg>
      <Zap
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${COLOR_TRANSITION}`}
        style={{ width: 6.5 * s, height: 6.5 * s, color: tone.text }}
        strokeWidth={2.4}
        fill={tone.colored ? tone.text : 'none'}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Numeral swap — the Usagebar trick                               */
/* ------------------------------------------------------------------ */

/**
 * The smallest footprint: a mono numeral over a hairline fill. Healthy
 * through hot it states headroom ("68%"); exhausted swaps the numeral to
 * the reset countdown, because once a window is spent the only number that
 * matters is when it comes back.
 */
export function SwapMeter({ reading, scale = 1 }: MeterFormProps) {
  const s = scale;
  const w = 24 * s;
  const tone = meterTone(reading);
  const used = reading ? Math.min(100, reading.usedPercent) / 100 : 0;
  const pace = reading ? Math.min(100, reading.evenPacePercent) / 100 : null;
  const label = barLabel(reading);

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 flex-col items-center"
      style={{ width: w, gap: 1.5 * s }}
    >
      <MeterNumeral scale={s} tone={tone}>
        {label}
      </MeterNumeral>
      <svg width={w} height={3 * s} className={COLOR_TRANSITION}>
        <rect x={0} y={s} width={w} height={1.2 * s} rx={0.6 * s} fill={tone.track} />
        {reading ? (
          used > 0 && (
            <rect
              x={0}
              y={s}
              width={Math.max(1.5 * s, w * used)}
              height={1.2 * s}
              rx={0.6 * s}
              fill={tone.fill}
            />
          )
        ) : null}
        {pace !== null && (
          <line
            x1={w * pace}
            y1={0}
            x2={w * pace}
            y2={3 * s}
            stroke={METER_MONO.tick}
            strokeWidth={Math.max(1, 0.9 * s)}
          />
        )}
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */

function MeterNumeral({
  scale,
  tone,
  children,
}: {
  scale: number;
  tone: MeterTone;
  children: React.ReactNode;
}) {
  // 9px at chrome scale = the nano rung (digits and symbols only, mono).
  // The zoomed specimen scales the same geometry, so this is a drawing
  // dimension, not a new type rung.
  return (
    <span
      className={`font-mono font-medium leading-none tabular-nums ${COLOR_TRANSITION}`}
      style={{ fontSize: 9 * scale, color: tone.text }}
    >
      {children}
    </span>
  );
}

export const METER_FORM: Record<
  MeterFormId,
  (props: MeterFormProps) => React.ReactNode
> = {
  arc: ArcMeter,
  bar: BarMeter,
  ring: RingMeter,
  swap: SwapMeter,
};
