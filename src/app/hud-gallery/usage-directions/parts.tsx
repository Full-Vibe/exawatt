'use client';

/**
 * ENG-008 E12 — the atoms all three directions share.
 *
 * Everything here is a projection of `model.ts`; nothing derives. Text uses
 * the shipped `/usage` six-role budget (`@/app/usage/chrome`) so the study
 * cannot fork a seventh treatment, and paint stays inside the channel rules:
 *
 *   - Consumption calm→hot is the ONLY ramp on a window figure.
 *   - The chrome ATTENTION role (amber) marks the one row state that has a
 *     repair verb. Settled facts get the consumption unknown grey, never a
 *     colour. A red dot that is always on trains the operator to ignore it.
 *   - Absence draws the −45° unreported hatch at the SAME height as a tape,
 *     so row geometry is fixed through success and failure.
 */
import type { ReactNode } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  duration,
  expiryHatch,
  percent,
  pressureColorCss as pressureColor,
  projectionHatch,
  tokens,
  unknownHatchCss as unknownHatch,
} from '@/components/consumption/flux';
import { floorTitle } from '@/components/consumption/meter/meter-model';
import { Body, Caption, Data, MicroLabel } from '@/app/usage/chrome';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import { AGENT_SOURCE_META } from '@/components/workspace/agent-sources';
import type { PtyHarness } from '@/types/electron';
import {
  STATE_WORD,
  type RowState,
  type SourceRow,
  type WindowRow,
} from './model';

export const ATTENTION = 'var(--exa-hud-amber)';

/** Row geometry is fixed across all states — this is the one tape height. */
export const TAPE_H = 8;

/* ------------------------------------------------------------------ */
/* state words                                                         */
/* ------------------------------------------------------------------ */

/**
 * The severity ladder is saturation, not hue (YNAB). Exactly one state is
 * saturated: the one the operator can fix.
 */
export function stateColor(state: RowState): string {
  if (state === 'unreadable') return ATTENTION;
  if (state === 'unavailable' || state === 'not-connected') return FLUX.unknown;
  if (state === 'stale') return CHROME.text;
  return CHROME.textDim;
}

export function StateWord({ row }: { row: SourceRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {row.state === 'unreadable' && (
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: ATTENTION }}
        />
      )}
      <Data color={stateColor(row.state)}>{STATE_WORD[row.state]}</Data>
    </span>
  );
}

/**
 * The freshness stamp. Shown only when it attests to something (YNAB: no
 * timestamp beats a misleading one), and rendered as an age plus the clock
 * time it was taken, so it stays readable on a surface that cannot tick.
 */
export function AsOf({ row, nowMs }: { row: SourceRow; nowMs: number }) {
  if (row.asOfMs === null) return <Data color={FLUX.unknown}>never read</Data>;
  const age = nowMs - row.asOfMs;
  const clock = new Date(row.asOfMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (age < 90_000) return <Data>read just now · {clock}</Data>;
  return (
    <Data color={age > 60 * 60_000 ? CHROME.text : CHROME.textDim}>
      read {duration(age)} ago · {clock}
    </Data>
  );
}

export function VendorMark({
  row,
  size = 12,
}: {
  row: SourceRow;
  size?: number;
}) {
  const harness: PtyHarness =
    row.vendor === 'OpenAI'
      ? 'codex'
      : row.vendor === 'xAI'
        ? 'grok'
        : 'claude';
  const meta =
    AGENT_SOURCE_META[
      harness === 'claude' ? 'claude' : harness === 'codex' ? 'codex' : 'grok'
    ];
  return (
    <SourceIdentityMark color={meta.color}>
      <HarnessGlyph harness={harness} size={size} />
    </SourceIdentityMark>
  );
}

/* ------------------------------------------------------------------ */
/* the tape — a window meter with its limits drawn on the scale        */
/* ------------------------------------------------------------------ */

/**
 * One window as a tape. Four marks, all reference geometry rather than fill:
 * the even-pace bug (where an evenly-spent window would sit right now), the
 * projection hatch (where it lands at this burn), the expiry hatch (what
 * dies unused), and the ceiling tick. The fill itself is the only ramp.
 */
export function Tape({
  w,
  height = TAPE_H,
  showExpiry = true,
}: {
  w: WindowRow;
  height?: number;
  showExpiry?: boolean;
}) {
  const r = w.read;
  const color = pressureColor(r.usedPercent);
  const usedW = Math.min(100, r.usedPercent);
  const projW =
    w.ratePerHour === null
      ? 0
      : Math.max(0, Math.min(100 - usedW, r.projectedPercent - r.usedPercent));
  const expiryStart = Math.min(100, usedW + projW);
  const overshoot = r.projectedPercent > 100 && w.ratePerHour !== null;
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
      {showExpiry && w.opportunity && expiryStart < 99.5 && (
        <>
          <span
            className="absolute top-0 h-full"
            style={{
              left: `${expiryStart}%`,
              width: `${100 - expiryStart}%`,
              background: expiryHatch(),
            }}
            title={floorTitle(w.opportunity)}
          />
          <span
            className="absolute top-0 h-full"
            style={{
              left: `calc(${expiryStart}% - 1px)`,
              width: 1,
              background: withAlpha(CHROME.text, 0.55),
            }}
          />
        </>
      )}
      <span
        className="absolute"
        style={{
          left: `calc(${Math.min(100, r.evenPacePercent)}% - 1px)`,
          top: -3,
          width: 2,
          height: height + 6,
          background: withAlpha(CHROME.text, 0.85),
        }}
        title={`even pace would be at ${percent(r.evenPacePercent)}`}
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

/**
 * The absent channel, at exactly a tape's height so a row that cannot report
 * occupies identical space to one that can.
 */
export function AbsentChannel({ height = TAPE_H }: { height?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block w-full rounded-[1px]"
      style={{
        height,
        background: unknownHatch(0.3),
        boxShadow: `inset 0 0 0 1px ${FLUX.unknownLine}`,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* repair                                                              */
/* ------------------------------------------------------------------ */

/**
 * A repair verb appears only on a credential or connection failure — never on
 * a spent plan, which is not a credential problem (CodexBar #2512).
 */
export function Repair({ row }: { row: SourceRow }) {
  if (!row.repair) return null;
  return (
    <button
      type="button"
      className="inline-flex min-h-6 items-center gap-1.5 rounded border px-2 py-0.5 text-chrome-label"
      style={{
        borderColor: withAlpha(ATTENTION, 0.5),
        color: ATTENTION,
        background: withAlpha(ATTENTION, 0.08),
      }}
    >
      {row.repair.label}
      <span
        className="font-mono text-chrome-micro"
        style={{ color: withAlpha(ATTENTION, 0.75) }}
      >
        {row.repair.verb}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* verdict + coverage                                                  */
/* ------------------------------------------------------------------ */

/**
 * The VERDICT — the seventh `/usage` text role, added by the E12 amendment in
 * `docs/engineering/design-system.md`. The six-role budget was written when
 * the glance zone was a number; a multiplexer's two-second answer is a word.
 * `text-display` is an existing rung; colour is data state only, and the role
 * is singular by construction — one per surface, first in reading order.
 */
export function VerdictWord({
  word,
  tone,
  size = 'display',
}: {
  word: string;
  tone: 'calm' | 'hot' | 'unknown';
  size?: 'display' | 'section';
}) {
  const color =
    tone === 'hot' ? FLUX.hot : tone === 'unknown' ? FLUX.unknown : CHROME.text;
  return (
    <span
      className={`${size === 'display' ? 'text-display' : 'text-lg'} font-semibold`}
      style={{ color }}
    >
      {word}
    </span>
  );
}

/**
 * The bound + coverage line. One slot, one sentence, always rendered — and
 * when a pass is still running it says so HERE, beside the number it
 * qualifies, rather than in a footer nobody reads (splitrail #221: "the
 * failure is silent in the place that matters").
 */
export function BoundLine({
  bound,
  coverage,
  scan,
}: {
  bound: { label: string; basis: string; isBound: boolean };
  coverage: { line: string };
  scan?: {
    phase: 'idle' | 'first-scan';
    filesSeen: number;
    filesTotal: number;
  };
}) {
  const running = scan?.phase === 'first-scan';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Data bright>{bound.label}</Data>
      <Caption>· {coverage.line}</Caption>
      <Caption>· {bound.basis}</Caption>
      {running && scan && (
        <Caption>
          · reading local logs,{' '}
          {Math.round((scan.filesSeen / scan.filesTotal) * 100)}% of{' '}
          {scan.filesTotal.toLocaleString('en-US')} files
        </Caption>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* small shared bits                                                   */
/* ------------------------------------------------------------------ */

export function WindowFigure({ w }: { w: WindowRow }) {
  const o = w.opportunity;
  if (o) {
    return (
      <Data bright>
        {o.freePts}% free · resets in {duration(w.read.msToReset)}
      </Data>
    );
  }
  return (
    <Data bright>
      {percent(w.read.usedPercent)} used · resets in{' '}
      {duration(w.read.msToReset)}
    </Data>
  );
}

export function RateFigure({ w }: { w: WindowRow }) {
  if (w.ratePerHour === null) {
    return <Data color={FLUX.unknown}>rate — no prior data</Data>;
  }
  return <Data>{w.ratePerHour.toFixed(2)}%/h</Data>;
}

export function Observed({ row }: { row: SourceRow }) {
  if (row.observedNt === null) {
    return <Data color={FLUX.unknown}>not measurable here</Data>;
  }
  return (
    <Data>
      {tokens(row.observedNt)} nt observed · {row.sessions} sessions
    </Data>
  );
}

export function Section({
  label,
  aside,
  children,
  className = '',
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 ${className}`}
      style={{ borderColor: CHROME.border, background: CHROME.surface }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Needs-attention. Rendered only when non-empty, and always adjacent to the
 *  headline — Copilot Money's adjacency, not Monarch's settings page. */
export function AttentionBlock({
  rows,
  nowMs,
}: {
  rows: SourceRow[];
  nowMs: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
      style={{
        borderColor: withAlpha(ATTENTION, 0.35),
        background: withAlpha(ATTENTION, 0.06),
      }}
    >
      <MicroLabel>Needs attention</MicroLabel>
      {rows.map(row => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span className="flex min-w-0 items-center gap-2">
            <VendorMark row={row} />
            <Body>
              {row.vendor} · {row.account}
            </Body>
            <Caption>
              {row.state === 'unreadable'
                ? 'account read failed — this row shows its last good figures'
                : 'reading has outlived the window it describes'}
            </Caption>
          </span>
          <span className="flex items-center gap-3">
            <AsOf row={row} nowMs={nowMs} />
            <Repair row={row} />
          </span>
        </div>
      ))}
    </div>
  );
}
