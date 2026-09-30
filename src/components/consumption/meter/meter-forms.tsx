'use client';

/**
 * The chrome meter glyph (ENG-008 E6; the operator picked the fraction bar
 * on 2026-08-03 and the other three candidate forms retired with E15).
 *
 * Contract:
 *   - true chrome scale: ≤20px tall at `scale = 1`, drawn in SVG so a zoomed
 *     specimen is the identical geometry at `scale = n`;
 *   - constant footprint: state changes recolor and refill, they never
 *     resize; nothing in the title bar may shift when a window runs hot;
 *   - monochrome until it matters: chrome neutrals through healthy/warm, the
 *     FLUX ramp only at hot/exhausted (`meterTone`);
 *   - the pacing tick: a fixed mark at the even-pace position, so fill ahead
 *     of the tick reads "burning ahead" with zero numerals;
 *   - escalation by state change, never by motion.
 *
 * The glyph renders `aria-hidden`; the interactive wrapper owns the
 * accessible sentence (see `ambient-meter-chrome.tsx`).
 */

import { duration } from '../flux';
import {
  meterTone,
  METER_MONO,
  type MeterReading,
  type MeterTone,
} from './meter-model';

export interface MeterFormProps {
  reading: MeterReading | null;
  /** 1 = true chrome scale. */
  scale?: number;
}

const COLOR_TRANSITION =
  'transition-[color,fill,stroke] duration-200 motion-reduce:transition-none';

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
