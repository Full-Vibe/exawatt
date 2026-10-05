'use client';

/**
 * Chrome meter popover (ENG-008 E6, rebuilt by E15): rung 2 of the iStat
 * ladder. The glyph answers "how does the window that bites first stand";
 * this shows every account card at glance size without leaving the title
 * bar; the click-through opens `/usage` for the same cards at reading size.
 *
 * A projection, never a second computation: it renders `usageOverview` with
 * the same `AccountCard` the page uses, `compact`. The E12 corpus showed every
 * glance-versus-page disagreement came from a glance that ran its own path.
 */
import { CONSUMPTION_CHROME as CHROME } from '../flux';
import type { UsageOverview } from '../accounts';
import { AccountCard } from '../usage-bars';

/** Fixed panel width — the portal wrapper aligns with plain arithmetic. */
export const METER_POPOVER_WIDTH = 320;

export function MeterPopover({ overview }: { overview: UsageOverview }) {
  return (
    <div
      data-meter-popover
      role="tooltip"
      className="exa-material-overlay relative overflow-hidden rounded-md border shadow-2xl"
      style={{ borderColor: CHROME.borderStrong, width: METER_POPOVER_WIDTH }}
    >
      <div
        className="flex flex-col gap-1 border-b px-3 py-2"
        style={{ borderColor: CHROME.border }}
      >
        <span
          className="text-chrome-label font-semibold"
          style={{ color: CHROME.text }}
        >
          Usage
        </span>
      </div>

      {overview.accounts.length > 0 ? (
        overview.accounts.map(account => (
          <div
            key={account.key}
            className="border-t first:border-t-0"
            style={{ borderColor: CHROME.border }}
          >
            <AccountCard
              account={account}
              nowMs={overview.nowMs}
              windowLabel={overview.windowLabel}
              compact
            />
          </div>
        ))
      ) : (
        <p className="px-3 py-2.5 text-chrome-meta" style={{ color: CHROME.textDim }}>
          No agent usage yet.
        </p>
      )}

      <div
        className="flex items-center gap-1.5 border-t px-3 py-1.5"
        style={{ borderColor: CHROME.border, background: CHROME.hover }}
      >
        <span className="text-chrome-micro" style={{ color: CHROME.textDim }}>
          Open Usage
        </span>
        <span
          aria-hidden
          className="ml-auto font-mono text-chrome-micro"
          style={{ color: CHROME.textDim }}
        >
          →
        </span>
      </div>
    </div>
  );
}
