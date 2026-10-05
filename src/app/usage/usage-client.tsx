'use client';

/**
 * Usage, Overview tab (ENG-008 E15). Route `/usage`.
 *
 * One card per vendor account, in the idiom the frontier vendors converged
 * on: a bar per limit, when it resets, and how much is used. Above the cards
 * sits at most ONE sentence, and only when something runs out before its
 * reset or a banked reset is about to expire (operator pick, 2026-09-29).
 * The breakdown by Project and by Agent lives on the Analytics tab.
 *
 * Per-tenant source (ENG-027): the Demo tenant reads the Voltaic corpus,
 * Personal reads this machine through the live bridge, and the hosted web app
 * falls back to the bannered demo week. Every corpus reaches this page
 * through the same `usageOverview` projection the chrome meter reads.
 */
import { useMemo } from 'react';
import { usageOverview } from '@/components/consumption/accounts';
import { UsageOverviewBody } from '@/components/consumption/usage-overview';
import { spendAccountReset } from '@/components/consumption/live-store';
import { useTenantConsumption } from '@/components/consumption/use-tenant-consumption';
import { UsageShell } from './usage-shell';

export function UsageClient() {
  const tenant = useTenantConsumption();
  const overview = useMemo(() => usageOverview(tenant.view), [tenant.view]);
  // The burn line is a projection of the samples on screen. A demo corpus is
  // authored, so it reads; a live view reads only once a pull has applied
  // and while the engine is up, because a zero computed from samples nobody
  // is reading any more is not a reading (E16).
  const burnRead = !tenant.live || !(tenant.pending || tenant.stopped);
  return (
    <UsageShell tab="overview" tenant={tenant}>
      <UsageOverviewBody
        overview={overview}
        burnRead={burnRead}
        // Only a live read of this machine can spend a reset; the demo and
        // a paused engine show resets as facts.
        onUseReset={
          tenant.live && !tenant.stopped
            ? account => spendAccountReset(account.harness)
            : undefined
        }
      />
    </UsageShell>
  );
}
