'use client';

/**
 * Page chrome for `/usage` — labels, values, and states only
 * (design-system.md, Voice). Descended from the ENG-008 design-options
 * workbench chrome (`consumption-redesign/shared.tsx`, retired 2026-08-03 —
 * design record in git history and the E8 milestone log).
 *
 * THE TREATMENT BUDGET (ENG-008 hierarchy pass, 2026-08-03). The whole page
 * renders text through exactly these roles — the operator-review complaint
 * ("all the different text treatments") was the count itself, so the count
 * is now a contract:
 *
 *   1. page title    — `text-surface-title font-semibold` (once, usage-client)
 *   2. Num           — mono display numeral; the hero % and the drill total
 *   3. MicroLabel    — mono uppercase tracked micro; section + column labels
 *   4. Body          — `text-sm` sans; names, verdict words, row labels
 *   5. Data          — mono chrome-meta tabular; every figure in a row
 *   6. Caption       — sans chrome-meta dim; legends, banners, footnotes
 *
 * Color is data-state only: the FLUX ramp on consumption numerals and fills,
 * `FLUX.hot` on a genuinely overheating window, `FLUX.unknown` on absence,
 * status Active blue on live markers, Project identity on ticks. All other
 * text is neutral bright/dim. New text on this page picks one of the six
 * roles or amends this header.
 */
import type { ReactNode } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  expiryHatch,
  percent,
  pressureColorCss as pressureColor,
  projectionHatch,
  tokens,
  unknownHatchCss as unknownHatch,
} from '@/components/consumption/flux';
import {
  floorTitle,
  opportunityOf,
} from '@/components/consumption/meter/meter-model';
import type { DemoConsumption } from '@/components/consumption/demo-source';
import type { LiveScanView } from '@/components/consumption/live-source';
import type { WindowPace } from './derive';
import { DEMO_ORGANIZATION } from '@exawatt/core';
import { DEMO_WORKSPACE } from '@/lib/tenancy/workspace-scope';

/* ------------------------------------------------------------------ */
/* the six text roles                                                  */
/* ------------------------------------------------------------------ */

/** Role 2 — the display numeral (hero % and the drill total). */
export function Num({
  children,
  color = CHROME.text,
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      className="font-mono text-display font-semibold tabular-nums"
      style={{ color }}
    >
      {children}
    </span>
  );
}

/** Role 3 — mono uppercase tracked micro-label (sections, columns). */
export function MicroLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-chrome-micro uppercase tracking-[0.14em] ${className}`}
      style={{ color: CHROME.textDim }}
    >
      {children}
    </span>
  );
}

/** Role 4 — body value: names, verdict words, row labels. */
export function Body({
  children,
  color = CHROME.text,
  className = '',
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span className={`text-sm ${className}`} style={{ color }}>
      {children}
    </span>
  );
}

/** Role 5 — mono data figure. Dim by default; bright for a row's key figure. */
export function Data({
  children,
  bright = false,
  color,
  className = '',
}: {
  children: ReactNode;
  bright?: boolean;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-chrome-meta tabular-nums ${className}`}
      style={{ color: color ?? (bright ? CHROME.text : CHROME.textDim) }}
    >
      {children}
    </span>
  );
}

/** Role 6 — muted caption: legends, banners, footnotes. */
export function Caption({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`text-chrome-meta ${className}`} style={{ color: CHROME.textDim }}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* cards and bands                                                     */
/* ------------------------------------------------------------------ */

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
        borderColor: CHROME.border,
        background: CHROME.surface,
      }}
    >
      {children}
    </section>
  );
}

/** A question band: one micro-label heading, optional right-side aside. */
export function Band({
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
    <Card label={label} className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {aside}
      </div>
      {children}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* live scan captions — minimal honest state, one Caption line (E5)    */
/* ------------------------------------------------------------------ */

/**
 * The live read's only chrome: one quiet line while the first scan runs
 * (with its progress) or while the corpus is a partial read; nothing at all
 * once the read is complete — the numbers then speak for themselves. The
 * freshness fact (`read Xm ago`) lives in the page footer.
 */
export function LiveScanNotice({ scan }: { scan: LiveScanView | null }) {
  if (!scan) return null;
  if (scan.phase === 'first-scan') {
    const p = scan.progress;
    return (
      <div className="px-0.5">
        <Caption>
          Reading local logs
          {p && p.filesTotal > 0
            ? ` · ${p.filesSeen.toLocaleString()} of ${p.filesTotal.toLocaleString()} files`
            : '…'}
        </Caption>
      </div>
    );
  }
  if (!scan.firstScanComplete) {
    return (
      <div className="px-0.5">
        <Caption>
          Partial read of local logs
          {scan.cancelled ? ' · last scan cancelled' : ''}
        </Caption>
      </div>
    );
  }
  return null;
}

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
      style={{ borderColor: CHROME.border }}
    >
      <span
        className="rounded border px-1.5 py-0.5 font-mono text-chrome-micro"
        style={{ borderColor: CHROME.borderStrong, color: CHROME.text }}
      >
        {voltaic ? DEMO_WORKSPACE.name : 'Demo data'}
      </span>
      <Caption>
        {voltaic ? `${DEMO_ORGANIZATION.name} · ` : ''}
        {demo.windowLabel} · {demo.workspace.sessionCount} sessions ·{' '}
        {tokens(raw)} raw tokens · same rollup path as a live local read · not
        reconciled against provider billing
      </Caption>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* pace bar — headroom + reset + even-pace marker                      */
/* ------------------------------------------------------------------ */

/**
 * The pacing bar: fill = used, hatch = projected by reset, hollow tick =
 * where even pace would put you now. The delta between fill edge and tick
 * IS the pace read.
 *
 * E9 (Direction B, operator pick 2026-08-11): when the shared opportunity
 * trigger fires, the bar additionally draws the region that dies unused if
 * the pace holds — projected landing point to the ceiling, in the +45°
 * neutral expiry hatch behind a hairline boundary tick. Magnitude as area,
 * never as color; a bar inside pace draws nothing extra. `/usage` bars
 * only — the popover mini bars proved too small for this region to read.
 */
export function PaceBar({
  pace,
  height = 8,
}: {
  pace: WindowPace;
  height?: number;
}) {
  const w = pace.window;
  const color = paceFill(pace);
  const usedW = Math.min(100, w.usedPercent);
  const projW = Math.max(
    0,
    Math.min(100 - usedW, pace.projectedPercent - w.usedPercent)
  );
  const o = opportunityOf(pace);
  const expiryStart = Math.min(100, usedW + projW);
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
      {/* expiry region — dies unused at this pace (opportunity states only) */}
      {o && expiryStart < 99.5 && (
        <>
          <span
            className="absolute top-0 h-full"
            style={{
              left: `${expiryStart}%`,
              width: `${100 - expiryStart}%`,
              background: expiryHatch(),
            }}
            title={floorTitle(o)}
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
      {/* even-pace marker — a reference tick, not a fill */}
      <span
        className="absolute"
        style={{
          left: `calc(${Math.min(100, pace.evenPacePercent)}% - 1px)`,
          top: -3,
          width: 2,
          height: height + 6,
          background: withAlpha(CHROME.text, 0.85),
        }}
        title={`even pace would be at ${percent(pace.evenPacePercent)}`}
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

/** Pace words come from the one shared derivation — never re-phrased here. */
export { paceLabel } from '@/components/consumption/meter/meter-model';

/** Consumption fill for a window — always the FLUX ramp (data, not chrome). */
export function paceFill(pace: WindowPace): string {
  return pressureColor(pace.window.usedPercent);
}

/**
 * Text color for a pace verdict under the page's color diet: neutral until
 * the window genuinely overheats, then the consumption channel's hot — the
 * meter's monochrome-until-it-matters idiom applied to words.
 */
export function verdictColor(pace: WindowPace): string {
  return pace.exhaustsBeforeReset || pace.state === 'exhausted'
    ? FLUX.hot
    : CHROME.text;
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
      <Data>{tokens(observed)} raw observed · 5h</Data>
      {reason && <Caption>{reason}</Caption>}
    </div>
  );
}
