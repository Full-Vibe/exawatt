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

import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  UNIT_COLOR_CSS as UNIT_COLOR,
  UNIT_LABEL,
  UNIT_ORDER,
  consumptionAlpha as withAlpha,
  type UnitKey,
} from './flux';
import { rawTotal, type DisplayUsage } from './model';

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
