'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClosedSessionEntry } from '@/types/electron';

interface ClosedSessionCountApi {
  closedSessions: () => Promise<ClosedSessionEntry[]>;
  onClosedSessionsChanged?: (handler: (count: number) => void) => () => void;
}

/**
 * Main owns the durable ledger count; the renderer owns only in-flight closes.
 * Subscribing before hydration and versioning the initial read prevents a stale
 * snapshot from overwriting a newer archive/reopen/reap event.
 */
export function useClosedSessionCount(
  ready: boolean,
  injectedApi?: ClosedSessionCountApi | null
): {
  closedSessionCount: number;
  beginPendingClose: () => () => void;
} {
  const [ledgerCount, setLedgerCount] = useState(0);
  const [pendingCloseCount, setPendingCloseCount] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const api = injectedApi ?? window.electron?.pty;
    if (!api?.closedSessions) return;
    let cancelled = false;
    let revision = 0;
    const unsubscribe = api.onClosedSessionsChanged?.(count => {
      revision += 1;
      if (!cancelled) setLedgerCount(Math.max(0, count));
    });
    const hydrationRevision = revision;
    void api.closedSessions().then(
      entries => {
        if (!cancelled && revision === hydrationRevision) {
          setLedgerCount(entries.length);
        }
      },
      () => {
        // Stay conservatively at the last main-owned value. A later ledger
        // event heals the projection without manufacturing availability.
      }
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [injectedApi, ready]);

  const beginPendingClose = useCallback(() => {
    let settled = false;
    setPendingCloseCount(current => current + 1);
    return () => {
      if (settled) return;
      settled = true;
      setPendingCloseCount(current => Math.max(0, current - 1));
    };
  }, []);

  return {
    // Pending work may make recovery available immediately, but it cannot
    // authoritatively predict the resulting ledger size (main may replace or
    // reap entries). Use it only as a non-zero availability overlay.
    closedSessionCount:
      pendingCloseCount > 0 ? Math.max(1, ledgerCount) : ledgerCount,
    beginPendingClose,
  };
}
