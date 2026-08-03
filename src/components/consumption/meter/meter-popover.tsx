'use client';

/**
 * Ambient meter hover popover — rung 2 of the iStat ladder (ENG-008).
 *
 * Glyph (rung 1) answers "how does the tightest window stand"; this answers
 * "which windows, when do they reset, and am I pacing them" without leaving
 * the title bar; the click-through to /consumption (rung 3) owns everything
 * deeper. Deliberately smaller than `CapacityPopover`: no sparklines, no
 * assurance essay — the windows, their resets, the pace verdict, and one
 * line of coaching when (and only when) a window runs hot.
 *
 * The popover stays in chrome neutrals like the meter itself; the FLUX ramp
 * appears per-row only where that row's window has earned it.
 */

import { duration, percent } from '../flux';
import { HARNESS_LABEL, type ConsumptionSourceView } from '../model';
import {
  meterTone,
  paceSentence,
  readAllWindows,
  remediationHint,
  METER_MONO,
  type MeterSnapshot,
} from './meter-model';

const PANEL = {
  bg: 'rgba(13, 15, 21, 0.97)',
  border: 'rgba(255, 255, 255, 0.12)',
  divider: 'rgba(255, 255, 255, 0.07)',
  text: '#e4e4e7',
  dim: '#a1a1aa',
  faint: '#71717a',
} as const;

function WindowRow({
  sourceLabel,
  snapshot,
  reading,
}: {
  sourceLabel: string;
  snapshot: MeterSnapshot;
  reading: NonNullable<MeterSnapshot['reading']>;
}) {
  const tone = meterTone(reading);
  const headline =
    snapshot.reading &&
    snapshot.reading.window.limitId === reading.window.limitId &&
    snapshot.reading.source.key === reading.source.key;
  const used = Math.min(100, reading.usedPercent) / 100;
  const pace = Math.min(100, reading.evenPacePercent) / 100;
  return (
    <div className="flex flex-col gap-1" data-meter-window={reading.window.limitId}>
      <div className="flex items-baseline gap-2">
        <span
          className="whitespace-nowrap font-ui text-chrome-meta"
          style={{ color: PANEL.dim }}
        >
          {reading.window.label}
        </span>
        {headline && (
          // dot, not a word: marks the window the chrome glyph is showing
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 self-center rounded-full"
            style={{ background: tone.fill }}
            title={`The tightest live window across every reporting source — the one the ${sourceLabel} meter is showing.`}
          />
        )}
        <span
          className="ml-auto font-mono text-chrome-label font-medium tabular-nums"
          style={{ color: tone.text }}
        >
          {reading.state === 'exhausted' ? 'spent' : percent(reading.usedPercent)}
        </span>
        <span
          className="whitespace-nowrap font-mono text-chrome-micro tabular-nums"
          style={{ color: PANEL.faint }}
        >
          resets in {duration(reading.msToReset)}
        </span>
      </div>
      <svg width="100%" height={7} aria-hidden className="block">
        <rect x={0} y={1.5} width="100%" height={4} rx={2} fill={tone.track} />
        <rect
          x={0}
          y={1.5}
          width={`${Math.max(1, used * 100)}%`}
          height={4}
          rx={2}
          fill={tone.fill}
        />
        <line
          x1={`${pace * 100}%`}
          y1={0}
          x2={`${pace * 100}%`}
          y2={7}
          stroke={METER_MONO.tick}
          strokeWidth={1}
        />
      </svg>
      <p className="font-ui text-chrome-micro leading-4" style={{ color: PANEL.faint }}>
        {paceSentence(reading)}
        {reading.exhaustsBeforeReset && reading.state !== 'exhausted' && (
          <span style={{ color: tone.colored ? tone.text : PANEL.dim }}>
            {' '}
            · spent in {duration(reading.msToExhaust)} at this pace
          </span>
        )}
      </p>
    </div>
  );
}

function SourceRows({
  source,
  snapshot,
}: {
  source: ConsumptionSourceView;
  snapshot: MeterSnapshot;
}) {
  const readings = readAllWindows(source, snapshot.nowMs);
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <span
        className="font-ui text-chrome-label font-medium"
        style={{ color: PANEL.text }}
      >
        {HARNESS_LABEL[source.harness]}
      </span>
      {readings.length === 0 ? (
        <p className="font-ui text-chrome-micro leading-4" style={{ color: PANEL.faint }}>
          No plan record on disk — this source is unmetered here, not at zero.
        </p>
      ) : (
        readings.map(r => (
          <WindowRow
            key={r.window.limitId}
            sourceLabel={source.label}
            snapshot={snapshot}
            reading={r}
          />
        ))
      )}
    </div>
  );
}

export function MeterPopover({
  snapshot,
  align = 'right',
  layout = 'floating',
}: {
  snapshot: MeterSnapshot;
  align?: 'left' | 'right';
  /** 'static' renders the same panel in flow — the gallery's popover specimen. */
  layout?: 'floating' | 'static';
}) {
  const r = snapshot.reading;
  const hint = r ? remediationHint(r) : null;
  const tone = meterTone(r);
  return (
    <div
      data-meter-popover
      role="tooltip"
      className={`w-[296px] overflow-hidden rounded-md border shadow-2xl ${
        layout === 'floating'
          ? `absolute top-full z-50 mt-1.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150 ${
              align === 'right' ? 'right-0' : 'left-0'
            }`
          : 'relative'
      }`}
      style={{
        borderColor: PANEL.border,
        background: PANEL.bg,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="flex items-baseline gap-2 border-b px-3 py-2"
        style={{ borderColor: PANEL.divider }}
      >
        <span
          className="font-ui text-chrome-label font-semibold"
          style={{ color: PANEL.text }}
        >
          Consumption
        </span>
        {r ? (
          <span
            className="font-ui text-chrome-micro"
            style={{ color: tone.colored ? tone.text : PANEL.dim }}
          >
            {r.state === 'exhausted'
              ? `${r.window.label.toLowerCase()} spent · resets in ${duration(r.msToReset)}`
              : `${r.window.label.toLowerCase()} at ${percent(r.usedPercent)} · ${paceSentence(r)}`}
          </span>
        ) : (
          <span className="font-ui text-chrome-micro" style={{ color: PANEL.faint }}>
            no source reports plan limits
          </span>
        )}
      </div>

      <div className="divide-y" style={{ borderColor: PANEL.divider }}>
        {snapshot.sources.map(s => (
          <div
            key={s.key}
            className="border-t first:border-t-0"
            style={{ borderColor: PANEL.divider }}
          >
            <SourceRows source={s} snapshot={snapshot} />
          </div>
        ))}
      </div>

      {hint && (
        <p
          data-meter-hint
          className="border-t px-3 py-2 font-ui text-chrome-micro leading-4"
          style={{ borderColor: PANEL.divider, color: tone.text }}
        >
          {hint}
        </p>
      )}

      <div
        className="flex items-center gap-1.5 border-t px-3 py-1.5"
        style={{ borderColor: PANEL.divider, background: 'rgba(0,0,0,0.28)' }}
      >
        <span className="font-ui text-chrome-micro" style={{ color: PANEL.faint }}>
          Click for the full consumption picture
        </span>
        <span
          aria-hidden
          className="ml-auto font-mono text-chrome-micro"
          style={{ color: PANEL.faint }}
        >
          →
        </span>
      </div>
    </div>
  );
}
