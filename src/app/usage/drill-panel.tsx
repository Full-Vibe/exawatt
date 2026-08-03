'use client';

/**
 * The drill panel — the one panel every door on the page opens (attribution
 * bars and session-grid rows both select into it), and the ONLY place the
 * page shows dollars, labelled modelled.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  dollars,
  tokens,
} from '@/components/consumption/flux';
import { modelledDollars } from '@/components/consumption/units';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import type { PivotRow } from './derive';

export function DrillPanel({ row }: { row: PivotRow | null }) {
  if (!row) {
    return (
      <div
        className="flex min-h-[180px] items-center justify-center rounded-lg border px-4 text-chrome-meta"
        style={{ borderColor: CHROME.border, color: CHROME.textDim }}
      >
        Select a bar or a session row
      </div>
    );
  }
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-4"
      style={{
        borderColor: withAlpha(FLUX.mid, 0.3),
        background: CHROME.surface,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="truncate text-chrome-title font-semibold"
          style={{ color: CHROME.text }}
        >
          {row.label}
        </span>
        <span
          className="font-mono text-chrome-meta tabular-nums"
          style={{ color: CHROME.textDim }}
        >
          {row.sessions} session{row.sessions === 1 ? '' : 's'}
        </span>
      </div>
      {row.meta && (
        <span className="text-chrome-meta" style={{ color: CHROME.textDim }}>
          {row.meta}
        </span>
      )}
      <div className="flex flex-col gap-1">
        {row.drill.slice(0, 6).map(d => (
          <div
            key={d.id}
            className="grid grid-cols-[1fr_64px] items-baseline gap-2 border-t pt-1"
            style={{ borderColor: CHROME.border }}
          >
            <span className="min-w-0">
              <span
                className="block truncate text-chrome-label"
                style={{ color: CHROME.text }}
              >
                {d.title}
                {d.liveNow && (
                  // activity state, not burn: the protocol's Active blue,
                  // never the FLUX ramp (channel-ownership rule)
                  <span
                    className="ml-1.5 font-mono text-chrome-micro"
                    style={{ color: STATUS_LIGHT_META.active.color }}
                  >
                    live
                  </span>
                )}
              </span>
              <span
                className="block truncate font-mono text-chrome-micro"
                style={{ color: CHROME.textDim }}
              >
                {d.sourceLabel}
                {d.model ? ` · ${d.model}` : ''}
                {d.agents !== null && d.agents > 0
                  ? ` · ${d.agents + 1} agents`
                  : ''}
                {d.interventions !== null
                  ? ` · ${d.interventions} interventions`
                  : ' · no session record'}
              </span>
            </span>
            <span
              className="text-right font-mono text-chrome-meta tabular-nums"
              style={{ color: CHROME.textDim }}
            >
              {tokens(d.weighted)} nt
            </span>
          </div>
        ))}
        {row.drill.length > 6 && (
          <span
            className="pt-1 font-mono text-chrome-micro"
            style={{ color: CHROME.textDim }}
          >
            {row.drill.length - 6} more
          </span>
        )}
      </div>
      <div
        className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t pt-2"
        style={{ borderColor: CHROME.border }}
      >
        <span
          className="font-mono text-chrome-label tabular-nums"
          style={{ color: CHROME.text }}
        >
          ≈ {dollars(modelledDollars(row.weighted))} modelled
        </span>
        <span className="text-chrome-micro" style={{ color: FLUX.unknown }}>
          list-price model · not billing truth
        </span>
      </div>
    </div>
  );
}
