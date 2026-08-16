'use client';

/**
 * THE tenant-aware consumption seam (ENG-008; live swap E5).
 *
 * Every consumption consumer — the ambient chrome meter, `/usage`, the
 * entity burn carriers — reads the corpus through this one hook, so the
 * title bar and the page are structurally incapable of disagreeing about
 * which corpus (and which clock) is on screen.
 *
 * Per-tenant source:
 * - the Demo tenant reads the Voltaic fortnight on the demo shell's clock —
 *   Demo Mode is first-class forever and never merges with Personal;
 * - the Personal tenant reads THIS machine's live local corpus through the
 *   E5 bridge (`live-store.ts`, one IPC subscription for the whole
 *   renderer). While the first pull is in flight the view is an honest
 *   empty live view — absent states, never demo numbers wearing a live
 *   face;
 * - without the bridge (the hosted web app) Personal falls back to the
 *   authored demo week, explicitly bannered as demo data — the only honest
 *   option where no local filesystem exists.
 *
 * Render "now" is always `view.nowMs` — the corpus's own pinned instant
 * (Demo corpora pin authored clocks; the live view re-pins on every store
 * rebuild) — never a per-consumer clock.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';
import { demoConsumption, type DemoConsumption } from './demo-source';
import type { LiveScanView } from './live-source';
import {
  getLiveConsumption,
  getServerLiveConsumption,
  subscribeLiveConsumption,
} from './live-store';
import { voltaicConsumption } from './voltaic-source';

export interface TenantConsumption {
  view: DemoConsumption;
  /** The Demo tenant's Voltaic corpus is on screen, not the Personal one. */
  voltaic: boolean;
  /** The Personal tenant's live local read is on screen (E5). */
  live: boolean;
  /** Scan state for the live read; null on demo corpora. */
  scan: LiveScanView | null;
  /**
   * The local command engine is not running, so nothing on screen was read
   * from this machine (BUG-016). Distinct from `!live`, which means there is
   * no desktop bridge at all and the demo corpus is the honest answer.
   */
  stopped: boolean;
}

export function useTenantConsumption(): TenantConsumption {
  const tenancy = useOptionalWorkspaceTenancy();
  const voltaic =
    (tenancy?.hydrated ?? false) &&
    tenancy?.activeWorkspace.id === DEMO_WORKSPACE_ID;
  const liveState = useSyncExternalStore(
    subscribeLiveConsumption,
    getLiveConsumption,
    getServerLiveConsumption
  );
  const live =
    !voltaic && liveState.status !== 'unavailable' && liveState.view !== null;
  // A stopped engine stays on the LIVE side of the seam: the demo corpus is
  // the honest answer where no local filesystem exists, never a substitute for
  // one that could not be read. The page says so instead of showing numbers.
  const stopped = live && liveState.status === 'paused';
  const view = useMemo(
    () =>
      voltaic
        ? voltaicConsumption()
        : live
          ? (liveState.view as DemoConsumption)
          : demoConsumption(),
    [voltaic, live, liveState.view]
  );
  return { view, voltaic, live, stopped, scan: live ? liveState.scan : null };
}
