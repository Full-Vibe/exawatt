'use client';

/**
 * Page chrome for `/usage`: text roles, cards, and the read-state banners
 * (design-system.md, Voice). The account bars themselves live in
 * `@/components/consumption/usage-bars` because the chrome meter's popover
 * and the scenario workbench draw them too.
 *
 * The treatment budget (ENG-008 hierarchy pass, 2026-08-03) still binds: text
 * renders through the page title, `Num`, `MicroLabel`, `Body`, `Data`, and
 * `Caption`. Labels are sentence case (operator rule: no all-caps).
 */
import type { ReactNode } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
} from '@/components/consumption/flux';
import type { LiveScanView } from '@/components/consumption/live-source';
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

/** Role 3 — the section and column label, sentence case. */
export function MicroLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-chrome-meta font-medium ${className}`}
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
/* stopped engine — the third state, not a demo                        */
/* ------------------------------------------------------------------ */

/**
 * The local read is not running (BUG-016). A desktop bridge whose command
 * engine died used to render this page as a complete live read of zero, which
 * claims more than the demo corpus it was mistaken for: it says this machine
 * burned nothing. The banner takes the demo banner's slot and the Consumption
 * channel's own `unknown` ink, because that is what the numbers below are.
 */
export function EngineStoppedBanner() {
  return (
    <div
      data-consumption-engine="paused"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-1.5"
      style={{ borderColor: FLUX.unknownLine }}
    >
      <span
        className="rounded border px-1.5 py-0.5 font-mono text-chrome-micro"
        style={{ borderColor: FLUX.unknownLine, color: FLUX.unknown }}
      >
        Command engine paused
      </span>
      <Caption>
        Nothing on this page was read from this machine · local reads resume
        when the engine starts
      </Caption>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* demo banner — honest assurance labeling, one line                   */
/* ------------------------------------------------------------------ */

export function DemoBanner({ voltaic }: { voltaic: boolean }) {
  return (
    <div
      data-consumption-demo
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-1.5"
      style={{ borderColor: CHROME.border }}
    >
      <span
        className="rounded border px-1.5 py-0.5 text-chrome-micro"
        style={{ borderColor: CHROME.borderStrong, color: CHROME.text }}
      >
        {voltaic ? DEMO_WORKSPACE.name : 'Demo data'}
      </span>
      <Caption>
        {voltaic
          ? `${DEMO_ORGANIZATION.name} · sample accounts`
          : 'Sample accounts, not read from this machine'}
      </Caption>
    </div>
  );
}
