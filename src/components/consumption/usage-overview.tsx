'use client';

/**
 * The Usage Overview body (ENG-008 E15, E17): one card per account, facts
 * only. No prose summary across accounts (operator, 2026-10-05); a window
 * on course to run out says so on its own meter, and in a notification. `/usage` renders it over the tenant's corpus and the
 * scenario workbench renders it over each scenario, so a scenario that reads
 * right in the workbench reads right on the page.
 */
import { CONSUMPTION_CHROME as CHROME } from './flux';
import type { PhraseOptions, UsageOverview } from './accounts';
import { ACCOUNT_SCOPE_NOTE } from './model';
import { AccountCard } from './usage-bars';
import type { UseAccountReset } from './use-reset-control';

export function UsageOverviewBody({
  overview,
  phrase,
  onUseReset,
}: {
  overview: UsageOverview;
  phrase?: PhraseOptions;
  /** Spends a banked reset; present only on a live read that can. */
  onUseReset?: UseAccountReset;
}) {
  return (
    <>
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
