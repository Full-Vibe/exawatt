'use client';

/**
 * The Usage Overview body (ENG-008 E15, E16, E17): the burn line, then one
 * card per account, facts only. No prose summary across accounts (operator,
 * 2026-10-05); a window on course to run out says so on its own meter, and in
 * a notification. `/usage` renders it over the tenant's corpus and the
 * scenario workbench renders it over each scenario, so a scenario that reads
 * right in the workbench reads right on the page.
 *
 * The burn line is `usageOverview`'s own projection of the samples the cards
 * count (E16): tokens per minute and modelled dollars per hour over a short
 * trailing window, per account with a local ledger. Zero is a true reading
 * there; a log nobody is reading is not, so a live view whose read is pending
 * or whose engine stopped says so instead of printing a zero.
 */
import { CONSUMPTION_CHROME as CHROME, tokens } from './flux';
import type { PhraseOptions, UsageBurn, UsageOverview } from './accounts';
import { ACCOUNT_SCOPE_NOTE } from './model';
import { modelledHourly } from './units';
import { AccountCard } from './usage-bars';
import type { UseAccountReset } from './use-reset-control';

/** What this machine is drawing right now, per vendor. */
function BurnLine({ burn, read }: { burn: UsageBurn; read: boolean }) {
  const burning = burn.tokens > 0;
  return (
    <section
      aria-label="Burn rate"
      data-usage-burn={read ? (burning ? 'burning' : 'idle') : 'unread'}
      className="flex flex-col gap-1.5 rounded-lg border px-5 py-3"
      style={{ borderColor: CHROME.border }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold" style={{ color: CHROME.text }}>
          Burning now
        </span>
        <span
          className="ml-auto text-chrome-meta"
          style={{ color: CHROME.textDim }}
        >
          {read
            ? `${burn.windowLabel} · dollars modelled at list price`
            : burn.windowLabel}
        </span>
      </div>
      {read ? (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span
            data-usage-burn-total
            className="text-lg tabular-nums"
            style={{ color: CHROME.text }}
          >
            {tokens(Math.round(burn.tokensPerMinute))} tokens/min
          </span>
          <span
            className="text-sm tabular-nums"
            style={{ color: CHROME.textDim }}
          >
            about {modelledHourly(burn.dollarsPerHour)}
          </span>
          {burn.vendors.map(vendor => (
            <span
              key={vendor.accountKey}
              data-usage-burn-vendor={vendor.accountKey}
              className="text-sm tabular-nums"
              style={{ color: CHROME.textDim }}
            >
              <span style={{ color: CHROME.text }}>{vendor.name}</span>{' '}
              {tokens(Math.round(vendor.tokensPerMinute))}/min ·{' '}
              {modelledHourly(vendor.dollarsPerHour)}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: CHROME.textDim }}>
          Not read from this machine yet.
        </p>
      )}
    </section>
  );
}

export function UsageOverviewBody({
  overview,
  phrase,
  onUseReset,
  burnRead = true,
}: {
  overview: UsageOverview;
  phrase?: PhraseOptions;
  /** Spends a banked reset; present only on a live read that can. */
  onUseReset?: UseAccountReset;
  /** False while the samples on screen are not a reading (a live pull still
   *  pending, or the engine stopped): the burn line then prints no zero. */
  burnRead?: boolean;
}) {
  return (
    <>
      {overview.burn.vendors.length > 0 && (
        <BurnLine burn={overview.burn} read={burnRead} />
      )}

      {overview.accounts.length > 0 ? (
        <div className="flex flex-col gap-4">
          {overview.accounts.map(account => (
            <AccountCard
              key={account.key}
              account={account}
              nowMs={overview.nowMs}
              windowLabel={overview.windowLabel}
              phrase={phrase}
              onUseReset={onUseReset}
            />
          ))}
        </div>
      ) : (
        <div
          data-usage-empty
          className="rounded-lg border px-5 py-6 text-chrome-meta"
          style={{ borderColor: CHROME.border, color: CHROME.textDim }}
        >
          No agent usage yet. Accounts appear here once an Agent runs.
        </div>
      )}

      {overview.accounts.some(a => a.meters.length > 0) && (
        <p className="text-chrome-meta" style={{ color: CHROME.textDim }}>
          {ACCOUNT_SCOPE_NOTE}
        </p>
      )}
    </>
  );
}
