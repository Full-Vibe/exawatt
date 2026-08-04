'use client';

/**
 * The drill panel — the one panel every door on the page opens (attribution
 * bars and session-grid rows both select into it). The header answers "how
 * many tokens did THAT use" as a display numeral; a single-session drill
 * adds the run's context-window pressure (peak footprint, compactions)
 * where the source records it — Claude Code records none, so it reads
 * "not recorded", never 0%. The footer holds the page's only dollars,
 * labelled modelled.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  dollars,
  percent,
  pressureColorCss as pressureColor,
  tokens,
} from '@/components/consumption/flux';
import { modelledDollars } from '@/components/consumption/units';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import type { DrillSession, PivotRow } from './derive';
import { Body, Caption, Data, MicroLabel, Num } from './chrome';

export function DrillPanel({ row }: { row: PivotRow | null }) {
  if (!row) {
    return (
      <div
        className="flex min-h-[180px] items-center justify-center rounded-lg border px-4"
        style={{ borderColor: CHROME.border }}
      >
        <Caption>Select a bar or a session row</Caption>
      </div>
    );
  }
  const single = row.sessions === 1 ? row.drill[0] : undefined;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-4"
      style={{
        borderColor: CHROME.borderStrong,
        background: CHROME.surface,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Body className="truncate">{row.label}</Body>
        <Data className="shrink-0 whitespace-nowrap">
          {row.sessions} session{row.sessions === 1 ? '' : 's'}
        </Data>
      </div>
      {row.meta && <Caption>{row.meta}</Caption>}
      {/* the answer to "how many tokens did that use" — one display numeral */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Num>{tokens(row.weighted)} nt</Num>
        <Caption>normalized · {tokens(rawOf(row))} raw</Caption>
      </div>
      {single && (
        <>
          <ContextPressure session={single} />
          {/* the run's own facts — no list for a list of one */}
          <Data>
            {single.agents !== null && single.agents > 0
              ? `${single.agents + 1} agents · `
              : ''}
            {single.interventions !== null
              ? `${single.interventions} interventions`
              : 'no session record'}
            {single.liveNow ? ' · ' : ''}
            {single.liveNow && (
              <span style={{ color: STATUS_LIGHT_META.active.color }}>
                live
              </span>
            )}
          </Data>
        </>
      )}
      {!single && (
      <div className="flex flex-col gap-1">
        {row.drill.slice(0, 6).map(d => (
          <div
            key={d.id}
            className="grid grid-cols-[1fr_64px] items-baseline gap-2 border-t pt-1"
            style={{ borderColor: CHROME.border }}
          >
            <span className="min-w-0">
              <Body className="block truncate">
                {d.title}
                {d.liveNow && (
                  // activity state, not burn: the protocol's Active blue,
                  // never the FLUX ramp (channel-ownership rule)
                  <Data className="ml-1.5" color={STATUS_LIGHT_META.active.color}>
                    live
                  </Data>
                )}
              </Body>
              <Data className="block truncate">
                {d.sourceLabel}
                {d.model ? ` · ${d.model}` : ''}
                {d.agents !== null && d.agents > 0
                  ? ` · ${d.agents + 1} agents`
                  : ''}
                {d.interventions !== null
                  ? ` · ${d.interventions} interventions`
                  : ' · no session record'}
              </Data>
            </span>
            <Data className="text-right">{tokens(d.weighted)} nt</Data>
          </div>
        ))}
        {row.drill.length > 6 && <Data>{row.drill.length - 6} more</Data>}
      </div>
      )}
      <div
        className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t pt-2"
        style={{ borderColor: CHROME.border }}
      >
        <Data bright>≈ {dollars(modelledDollars(row.weighted))} modelled</Data>
        <Caption>list-price model · not billing truth</Caption>
      </div>
    </div>
  );
}

function rawOf(row: PivotRow): number {
  return row.drill.reduce((n, d) => n + d.raw, 0);
}

/**
 * Per-run context-window pressure. Codex rollouts record the model context
 * window and the run's peak footprint; Claude Code records neither — absent
 * renders as "not recorded", never as an empty bar.
 */
function ContextPressure({ session }: { session: DrillSession }) {
  const { contextWindow: win, contextPeakTokens: peak, compactions } = session;
  if (win === null || peak === null) {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <MicroLabel>Context</MicroLabel>
        <Data color={FLUX.unknown}>not recorded</Data>
      </div>
    );
  }
  const pct = Math.min(100, (peak / win) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <MicroLabel>Context</MicroLabel>
        <Data bright>
          peak {percent(pct)} of {tokens(win)}
          {compactions !== null &&
            (compactions > 0
              ? ` · compacted ×${compactions}`
              : ' · never compacted')}
        </Data>
      </div>
      <span
        aria-hidden
        className="inline-block h-1 w-full rounded-[1px]"
        style={{ background: FLUX.track }}
      >
        <span
          className="block h-full rounded-[1px]"
          style={{
            width: `${Math.max(1.5, pct)}%`,
            background: pressureColor(pct),
          }}
        />
      </span>
    </div>
  );
}
