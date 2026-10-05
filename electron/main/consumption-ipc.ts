/**
 * ENG-008 E5 — live local-consumption IPC.
 *
 * The contract (channels, snapshot shape, honesty rules) lives in
 * `@exawatt/core`'s `consumption/live-snapshot.ts` so main and the renderer
 * import one seam. This module registers the channels and delegates to the
 * incremental scanner service.
 */
import type { BrowserWindow } from 'electron';
import type {
  ConsumptionUpdatedEvent,
  LiveConsumptionSnapshot,
  LiveConsumptionSnapshotRequest,
} from '@exawatt/core';
import {
  emptyLiveConsumptionSnapshot,
  type PlanResetOutcome,
} from '@exawatt/core';
import { handleBounded } from './ipc-arguments';
import { handleTrusted } from './ipc-security';
import {
  setClaudePlanWindowsEnabled,
  setCodexPlanWindowsEnabled,
  setUsageAlertLeadMinutes,
  setUsageAlerts,
} from './settings-store';
import { broadcastToWindows } from './window-broadcast';

export interface ConsumptionScannerLike {
  /** Never blocks on scanning; the first call starts the background scan. */
  snapshot(
    request?: LiveConsumptionSnapshotRequest
  ): Promise<LiveConsumptionSnapshot>;
  rescan(): void;
  cancelScan(): void;
  /** Subscribe to revision bumps. Returns a disposer. */
  onUpdated(listener: (event: ConsumptionUpdatedEvent) => void): () => void;
}

/**
 * Placeholder until the scanner service lands: an empty corpus at rest.
 * `scanState.firstScanComplete: false` keeps every consumer honest — this is
 * explicitly "nothing scanned yet", never a measured zero.
 */
class StubConsumptionScanner implements ConsumptionScannerLike {
  async snapshot(): Promise<LiveConsumptionSnapshot> {
    return emptyLiveConsumptionSnapshot(Date.now());
  }
  rescan(): void {}
  cancelScan(): void {}
  onUpdated(): () => void {
    return () => {};
  }
}

/** An account read the operator can switch off from Settings, Privacy, and
 *  that may spend a banked reset on the operator's confirm. */
interface SwitchableAccount {
  setEnabled(enabled: boolean): void;
  useReset(): Promise<PlanResetOutcome>;
}

export function registerConsumptionIPC(
  windows: () => readonly BrowserWindow[],
  scanner: ConsumptionScannerLike = new StubConsumptionScanner(),
  accounts: { claude?: SwitchableAccount; codex?: SwitchableAccount } = {},
  usageAlerts?: { check(): Promise<void> }
): () => void {
  if (usageAlerts) {
    // ENG-008 E17: the operator's alert choices. A change re-checks at once,
    // so turning alerts on speaks for a window already on course.
    handleBounded('settings:set-usage-alerts', (_event, enabled) => {
      const settings = setUsageAlerts(enabled);
      broadcastToWindows(windows(), 'settings:changed', settings);
      void usageAlerts.check();
      return settings;
    });
    handleBounded('settings:set-usage-alert-lead', (_event, minutes) => {
      const settings = setUsageAlertLeadMinutes(minutes);
      broadcastToWindows(windows(), 'settings:changed', settings);
      void usageAlerts.check();
      return settings;
    });
  }
  const planAccount = accounts.claude;
  // ENG-008 E17: spend a banked reset, only from the confirm on its card.
  handleBounded('consumption:use-reset', async (_event, source) => {
    const account =
      source === 'claude-code' ? accounts.claude : source === 'codex' ? accounts.codex : undefined;
    return account ? account.useReset() : 'failed';
  });
  if (accounts.codex) {
    const codex = accounts.codex;
    // ENG-038 slice 2: the same contract for the Codex account read. Off is
    // applied before it is announced, so no app-server starts after it.
    handleBounded('settings:set-codex-plan-windows', (_event, enabled) => {
      codex.setEnabled(enabled);
      const settings = setCodexPlanWindowsEnabled(enabled);
      broadcastToWindows(windows(), 'settings:changed', settings);
      return settings;
    });
  }
  if (planAccount) {
    // ENG-038: the off switch for the Claude plan-window read. Applied to the
    // service BEFORE the write is announced, so no process can be started
    // after the operator has switched the read off; the
    // service's own revision bump then pushes `consumption:updated`, and the
    // next pull serves absence.
    handleBounded('settings:set-claude-plan-windows', (_event, enabled) => {
      planAccount.setEnabled(enabled);
      const settings = setClaudePlanWindowsEnabled(enabled);
      broadcastToWindows(windows(), 'settings:changed', settings);
      return settings;
    });
  }
  handleBounded('consumption:snapshot', (_event, request) =>
    scanner.snapshot(request)
  );
  handleTrusted('consumption:rescan', () => {
    scanner.rescan();
  });
  handleTrusted('consumption:cancel-scan', () => {
    scanner.cancelScan();
  });
  return scanner.onUpdated(event => {
    broadcastToWindows(windows(), 'consumption:updated', event);
  });
}
