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
import { emptyLiveConsumptionSnapshot } from '@exawatt/core';
import { handleTrusted } from './ipc-security';
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

export function registerConsumptionIPC(
  windows: () => readonly BrowserWindow[],
  scanner: ConsumptionScannerLike = new StubConsumptionScanner()
): () => void {
  handleTrusted(
    'consumption:snapshot',
    (_event, request?: LiveConsumptionSnapshotRequest) => {
      const sinceMs = request?.sinceMs;
      if (sinceMs !== undefined && typeof sinceMs !== 'number') {
        throw new Error('Invalid consumption snapshot request');
      }
      return scanner.snapshot(sinceMs === undefined ? undefined : { sinceMs });
    }
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
