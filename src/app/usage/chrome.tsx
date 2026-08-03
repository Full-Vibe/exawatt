'use client';

/**
 * Page chrome for `/usage` — labels, values, and states only
 * (design-system.md, Voice). Every rung cited from the kernel: chrome type
 * roles, FLUX consumption channel, unknown-grey for absence, 4px spacing
 * grid. Descended from the ENG-008 design-options workbench chrome
 * (`src/app/hud-gallery/consumption-redesign/shared.tsx`), which stays as
 * the design record.
 */
import type { ReactNode } from 'react';
import { HUD, withAlpha } from '@/components/hud';
import {
  FLUX,
  duration,
  percent,
  pressureColor,
  projectionHatch,
  tokens,
  unknownHatch,
} from '@/components/consumption/flux';
import type { DemoConsumption } from '@/components/consumption/demo-source';
import type { WindowPace } from './derive';

/* ------------------------------------------------------------------ */
/* demo banner — honest assurance labeling, one line                   */
/* ------------------------------------------------------------------ */

export function DemoBanner({
  demo,
  raw,
  voltaic,
}: {
  demo: DemoConsumption;
  raw: number;
  /** The Demo tenant's Voltaic corpus is on screen, not the Personal week. */
  voltaic: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-1.5"
      style={{
        borderColor: withAlpha(FLUX.mid, 0.28),
        background: withAlpha(FLUX.mid, 0.05),
      }}
    >
      <span
        className="rounded px-1.5 py-0.5 font-mono text-chrome-micro"
        style={{
          border: `1px solid ${withAlpha(FLUX.mid, 0.5)}`,
          color: FLUX.mid,
        }}
      >
        {voltaic ? 'Demo Workspace' : 'Demo data'}
      </span>
      <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
        {voltaic ? 'Voltaic Grid Systems · ' : ''}
        {demo.windowLabel} · {demo.workspace.sessionCount} sessions ·{' '}
        {tokens(raw)} raw tokens · same rollup path as a live local read · not
        reconciled against provider billing
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* pace bar — headroom + reset + even-burn marker                      */
/* ------------------------------------------------------------------ */

/**
 * The pacing bar: fill = used, hatch = projected by reset, hollow tick =
 * where even burn would put you now. The delta between fill edge and tick IS
 * the pace read.
 */
export function PaceBar({
  pace,
  height = 8,
}: {
  pace: WindowPace;
  height?: number;
}) {
  const w = pace.window;
  const color = pressureColor(w.usedPercent);
  const usedW = Math.min(100, w.usedPercent);
  const projW = Math.max(
    0,
    Math.min(100 - usedW, pace.projectedPercent - w.usedPercent)
  );
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
          boxShadow: `0 0 7px ${withAlpha(color, 0.5)}`,
        }}
      />
      {projW > 0.5 && (
        <span
          className="absolute top-0 h-full"
          style={{
            left: `${usedW}%`,
            width: `${projW}%`,
            background: projectionHatch(withAlpha(color, 0.85)),
          }}
        />
      )}
      {/* even-burn marker — a reference tick, not a fill */}
      <span
        className="absolute"
        style={{
          left: `calc(${Math.min(100, pace.evenPercent)}% - 1px)`,
          top: -3,
          width: 2,
          height: height + 6,
          background: withAlpha(HUD.text, 0.85),
        }}
        title={`even burn would be at ${percent(pace.evenPercent)}`}
      />
      {/* ceiling tick */}
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

/** Pace read as words: state label + delta value. */
export function paceLabel(pace: WindowPace): {
  text: string;
  color: string;
} {
  const d = pace.deltaPercent;
  if (pace.exhaustsBeforeReset) {
    return {
      text: `exhausts in ${duration(pace.msToExhaust)} — before reset`,
      color: FLUX.hot,
    };
  }
  if (Math.abs(d) < 4) return { text: 'on even pace', color: FLUX.calm };
  if (d > 0) {
    return {
      text: `${Math.round(d)} pts ahead of even burn`,
      color: pressureColor(pace.window.usedPercent),
    };
  }
  return { text: `${Math.round(-d)} pts behind even burn`, color: FLUX.calm };
}

/** The absent channel for a source that reports no plan data. */
export function UnreportedChannel({
  observed,
  reason,
  height = 8,
}: {
  /** Raw tokens observed in this source's logs over the trailing 5h. */
  observed: number;
  reason?: string;
  height?: number;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span
        aria-hidden
        className="inline-block w-full rounded-[1px]"
        style={{
          height,
          background: unknownHatch(0.3),
          boxShadow: `inset 0 0 0 1px ${FLUX.unknownLine}`,
        }}
      />
      <span
        className="font-mono text-chrome-meta tabular-nums"
        style={{ color: HUD.textDim }}
      >
        {tokens(observed)} raw observed · 5h
      </span>
      {reason && (
        <span className="text-chrome-meta" style={{ color: FLUX.unknown }}>
          {reason}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* micro-chrome                                                        */
/* ------------------------------------------------------------------ */

export function MicroLabel({
  children,
  color = HUD.textDim,
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      className="font-mono text-chrome-micro uppercase tracking-[0.14em]"
      style={{ color }}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`rounded-lg border p-4 ${className}`}
      style={{
        borderColor: 'rgba(150,120,255,0.16)',
        background:
          'linear-gradient(180deg, rgba(14,11,30,0.9), rgba(7,8,18,0.92))',
      }}
    >
      {children}
    </section>
  );
}
