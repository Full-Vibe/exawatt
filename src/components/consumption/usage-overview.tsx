'use client';

/**
 * The Usage Overview body (ENG-008 E15): at most one headline sentence, then
 * one card per account. `/usage` renders it over the tenant's corpus and the
 * scenario workbench renders it over each scenario, so a scenario that reads
 * right in the workbench reads right on the page.
 */
import { CONSUMPTION_CHROME as CHROME } from './flux';
import type { PhraseOptions, UsageOverview } from './accounts';
import { ACCOUNT_SCOPE_NOTE } from './model';
import { AccountCard } from './usage-bars';

export function UsageOverviewBody({
  overview,
  phrase,
}: {
  overview: UsageOverview;
  phrase?: PhraseOptions;
}) {
  return (
    <>
      {overview.headline && (
        <p
          data-usage-headline={overview.headline.tone}
          className="text-lg font-semibold leading-snug"
          style={{ color: CHROME.text }}
        >
          {overview.headline.text}
        </p>
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
