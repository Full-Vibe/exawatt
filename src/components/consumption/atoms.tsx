'use client';

/**
 * Shared consumption atoms (ENG-008).
 *
 * Consumed by the production `/usage` surface over the one view-model in
 * `./model`. (The `/hud-gallery/consumption-lab` workbench was the second
 * consumer until it retired on 2026-08-03.) No surface owns a private copy;
 * a change here changes every consumer, which is the point.
 *
 * SPATIAL SEAM: every atom here is pure geometry over the view-model and holds
 * no DOM measurement. A future R3F wattage overlay (flow volume as emissive
 * tubes between Project nodes) would consume the same derivations —
 * `projectWindow`, `sumUsage`, weighted tokens — and render them as instanced
 * meshes. Nothing in this file is built for that today; the seam is the
 * view-model, not a shared component.
 */

import type { ReactNode } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  UNIT_COLOR_CSS as UNIT_COLOR,
  UNIT_LABEL,
  UNIT_ORDER,
  consumptionAlpha as withAlpha,
  duration,
  exact,
  percent,
  pressureColorCss as pressureColor,
  projectionHatch,
  tokens,
  unknownHatchCss as unknownHatch,
  type UnitKey,
} from './flux';
import { useConsumptionClock } from './clock';
import {
  projectWindow,
  rawTotal,
  type CapacityWindowView,
  type DisplayUsage,
} from './model';

/* ------------------------------------------------------------------ */
/* capacity                                                            */
/* ------------------------------------------------------------------ */

export function CapacityBar({
  window: w,
  width,
  height = 6,
  showProjection = true,
}: {
  window: CapacityWindowView;
  width: number | string;
  height?: number;
  showProjection?: boolean;
}) {
  const p = projectWindow(w, useConsumptionClock());
  const color = pressureColor(w.usedPercent);
  const usedW = Math.min(100, w.usedPercent);
  // Clamp the hatch to the track it is drawn inside. The projection can exceed
  // 100% of the window, but the hatch is positioned at `left: usedW%`, and this
  // track is deliberately overflow-visible so the ceiling tick and the overshoot
  // wedge can sit outside it — so an unclamped width paints the hatch straight
  // over the labels beside the bar. Overshoot is carried by the hot ceiling tick
  // and the wedge, which is the whole point of racing a fixed tick.
  const projectedW = Math.max(
    0,
    Math.min(100 - usedW, p.projectedPercent - w.usedPercent)
  );
  const overshoot = p.projectedPercent > 100;

  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0 overflow-visible rounded-[1px]"
      style={{
        width,
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
          boxShadow: `0 0 7px ${withAlpha(color, 0.55)}`,
        }}
      />
      {showProjection && projectedW > 0.5 && (
        <span
          className="absolute top-0 h-full"
          style={{
            left: `${usedW}%`,
            width: `${projectedW}%`,
            background: projectionHatch(withAlpha(color, 0.85)),
          }}
        />
      )}
      {/* the ceiling tick — the thing the projection is racing */}
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
      {overshoot && (
        <span
          className="absolute"
          style={{
            right: -7,
            top: (height - 5) / 2,
            width: 0,
            height: 0,
            borderTop: '2.5px solid transparent',
            borderBottom: '2.5px solid transparent',
            borderLeft: `5px solid ${FLUX.hot}`,
            filter: `drop-shadow(0 0 4px ${FLUX.hot})`,
          }}
        />
      )}
    </span>
  );
}

/**
 * A source that reports no plan data. Deliberately not a bar at 0%: an empty
 * hatched channel with no fill and no percentage, so it can never be misread
 * as "you have used none of your quota".
 */
export function UnreportedBar({
  width,
  height = 6,
}: {
  width: number | string;
  height?: number;
}) {
  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0 rounded-[1px]"
      style={{
        width,
        height,
        background: unknownHatch(0.3),
        boxShadow: `inset 0 0 0 1px ${FLUX.unknownLine}`,
      }}
    />
  );
}

export function Sparkline({
  values,
  width = 72,
  height = 16,
  color = FLUX.calm,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) return null;
  const step = width / (values.length - 1);
  const pts = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - v * (height - 2) - 1).toFixed(1)}`
    )
    .join(' ');
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle
        cx={width}
        cy={height - values[values.length - 1] * (height - 2) - 1}
        r={1.7}
        fill={color}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* raw units                                                           */
/* ------------------------------------------------------------------ */

/**
 * Linear stacked composition of raw units. Deliberately linear: cache reads
 * really do own 85-95% of the volume, and squashing that with a log scale
 * would hide the single most important fact about agent token usage.
 */
export function UnitStack({
  usage,
  width,
  height = 5,
  scaleTo,
  dim = false,
}: {
  usage: DisplayUsage;
  width: number | string;
  height?: number;
  /** Optional shared denominator so sibling rows are comparable. */
  scaleTo?: number;
  dim?: boolean;
}) {
  const total = rawTotal(usage);
  const denom = scaleTo && scaleTo > 0 ? scaleTo : total;
  if (denom <= 0) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-[1px]"
        style={{ width, height, background: FLUX.track }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 overflow-hidden rounded-[1px]"
      style={{ width, height, background: FLUX.track, opacity: dim ? 0.75 : 1 }}
    >
      {UNIT_ORDER.map(key => {
        const v = usage[key] ?? 0;
        if (v <= 0) return null;
        return (
          <span
            key={key}
            style={{
              width: `${(v / denom) * 100}%`,
              background: UNIT_COLOR[key],
            }}
          />
        );
      })}
    </span>
  );
}

export function UnitLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {UNIT_ORDER.map(key => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-[7px] w-[7px] rounded-[1px]"
            style={{ background: UNIT_COLOR[key] }}
          />
          <span
            className={
              compact ? 'font-ui text-chrome-micro' : 'font-ui text-chrome-meta'
            }
            style={{ color: CHROME.textDim }}
          >
            {UNIT_LABEL[key as UnitKey]}
          </span>
        </span>
      ))}
      <span
        className="ml-1 font-ui text-chrome-micro"
        style={{ color: withAlpha(CHROME.textDim, 0.8) }}
      >
        brighter = costlier per token · width = raw volume
      </span>
    </div>
  );
}

/** Right-aligned tabular figure. `null` means the harness never reported it. */
export function Figure({
  value,
  width = 62,
  muted = false,
  title,
}: {
  value: number | null;
  width?: number;
  muted?: boolean;
  title?: string;
}) {
  if (value === null) {
    return (
      <span
        className="shrink-0 text-right font-mono text-chrome-meta tabular-nums"
        style={{ width, color: FLUX.unknown }}
        title="not reported by this harness"
      >
        not rep.
      </span>
    );
  }
  return (
    <span
      className="shrink-0 text-right font-mono text-chrome-meta tabular-nums"
      style={{ width, color: muted ? CHROME.textDim : CHROME.text }}
      title={title ?? exact(value)}
    >
      {value === 0 ? '—' : tokens(value)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* assurance                                                           */
/* ------------------------------------------------------------------ */

export type FacetState = 'holds' | 'absent' | 'none';

export interface Facet {
  key: string;
  label: string;
  state: FacetState;
  detail: string;
}

/**
 * The Event assurance facets kept independent, with unknowns explicit.
 * Deliberately monochrome — assurance is not a pressure signal, and borrowing
 * either the consumption ramp or the status protocol here would imply an
 * urgency that does not exist.
 */
export const CONSUMPTION_FACETS: Facet[] = [
  {
    key: 'reported',
    label: 'reported',
    state: 'holds',
    detail:
      'Both harnesses write these token counts themselves, into their own local session logs.',
  },
  {
    key: 'observed',
    label: 'observed',
    state: 'holds',
    detail:
      'Exawatt read those files directly on this machine. No provider API was called.',
  },
  {
    key: 'authorized',
    label: 'authorized',
    state: 'none',
    detail:
      'No Policy or Budget authorizes this spend — Workspace ceilings do not exist yet.',
  },
  {
    key: 'enforced',
    label: 'enforced',
    state: 'none',
    detail:
      'Nothing here enforces a limit. The provider’s own account limits are the only ceiling.',
  },
  {
    key: 'verified',
    label: 'verified',
    state: 'absent',
    detail:
      'Not reconciled against provider billing. Treat these as the harness’s own accounting.',
  },
];

function FacetMark({ state }: { state: FacetState }) {
  if (state === 'holds') {
    return (
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: CHROME.text }}
      />
    );
  }
  if (state === 'none') {
    return (
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{
          boxShadow: `inset 0 0 0 1px ${withAlpha(CHROME.textDim, 0.65)}`,
        }}
      />
    );
  }
  return (
    <svg aria-hidden width={7} height={7} className="shrink-0">
      <circle
        cx={3.5}
        cy={3.5}
        r={3}
        fill="none"
        stroke={withAlpha(CHROME.textDim, 0.65)}
        strokeWidth={1}
      />
      <line
        x1={1}
        y1={6}
        x2={6}
        y2={1}
        stroke={CHROME.textDim}
        strokeWidth={1}
      />
    </svg>
  );
}

export function AssuranceLine({
  facets = CONSUMPTION_FACETS,
  children,
}: {
  facets?: Facet[];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {facets.map(f => (
          <span
            key={f.key}
            tabIndex={0}
            title={f.detail}
            aria-label={`${f.label}: ${f.detail}`}
            className="inline-flex cursor-help items-center gap-1.5 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)]"
          >
            <FacetMark state={f.state} />
            <span
              className="font-ui text-chrome-meta"
              style={{
                color: f.state === 'holds' ? CHROME.text : CHROME.textDim,
              }}
            >
              {f.label}
            </span>
          </span>
        ))}
      </div>
      {children && (
        <p
          className="font-ui text-chrome-meta leading-4"
          style={{ color: CHROME.textDim }}
        >
          {children}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* misc chrome                                                         */
/* ------------------------------------------------------------------ */

export function Panel({
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
      className={`rounded-md border ${className}`}
      style={{
        borderColor: CHROME.border,
        background: CHROME.surface,
      }}
    >
      {children}
    </section>
  );
}

export function ResetCountdown({ window: w }: { window: CapacityWindowView }) {
  const p = projectWindow(w, useConsumptionClock());
  return (
    <span
      className="font-mono text-chrome-meta tabular-nums"
      style={{ color: CHROME.textDim }}
    >
      resets in {duration(p.msToReset)}
    </span>
  );
}

export function WindowReadout({ window: w }: { window: CapacityWindowView }) {
  const color = pressureColor(w.usedPercent);
  const observedAtMs = w.observedAtMs;
  return (
    <span
      className="font-mono text-chrome-label font-medium tabular-nums"
      style={{ color }}
      title={`${w.usedPercent}% of the ${w.label.toLowerCase()} used, reported by the harness${
        observedAtMs === undefined
          ? ''
          : ` and observed at ${new Date(observedAtMs).toISOString()}`
      }`}
    >
      {percent(w.usedPercent)}
    </span>
  );
}
