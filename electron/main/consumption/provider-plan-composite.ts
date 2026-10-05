/**
 * ENG-038 — composes the local scanner with every provider plan-account read
 * behind the ONE `ConsumptionScannerLike` seam the IPC layer serves.
 *
 * The two source classes stay structurally separate — the scanner never
 * gains network code, an account read never reads a local corpus — and this
 * is the only place their outputs meet:
 *
 * - `planWindows`, `windowObservations`, and `providerPlanAccounts` merge
 *   additively, and `windowRates` is derived once from the merged history. An account read MAY report a
 *   bucket the local scanner also reports (Codex writes its windows into
 *   rollout logs too): both stay on the snapshot and the renderer keeps the
 *   fresher per bucket (`latestPlanWindows`), which is exactly what a banked
 *   reset needs, since the logs only catch up on the next Codex turn.
 * - The served `scanState.revision` is the scanner revision plus every
 *   account's revision. All are monotonic within a launch, so the sum is
 *   too, and the renderer's revision-gated pulls keep working unchanged.
 * - A snapshot pull or rescan nudges each account's `maybeRefresh()`, fire
 *   and forget and cadence-throttled in the service, so pulls never block on
 *   a read. An account whose harness left no local files at all is not read:
 *   a machine without Codex never starts a Codex app-server.
 */
import type {
  ConsumptionScanState,
  ConsumptionSourceId,
  ConsumptionUpdatedEvent,
  LiveConsumptionSnapshot,
  LiveConsumptionSnapshotRequest,
} from '@exawatt/core';
import { derivePlanWindowRates, idleScanState } from '@exawatt/core';
import type { ConsumptionScannerLike } from '../consumption-ipc';
import type { PlanAccountSource } from './plan-account-service';

export class ProviderPlanCompositeSource implements ConsumptionScannerLike {
  /** Last RAW scanner scan state (its own revision, never the composed one). */
  private lastScanState: ConsumptionScanState | null = null;
  /** Sources whose corpus held zero files at the last snapshot. */
  private emptySources: readonly ConsumptionSourceId[] = [];

  constructor(
    private readonly scanner: ConsumptionScannerLike,
    private readonly accounts: readonly PlanAccountSource[]
  ) {}

  /** Nudges each account whose harness the corpus has shown to exist. Until a
   *  full scan has said which harnesses left files, no account is asked: a
   *  machine without Codex must never start a Codex app-server. */
  private refreshAccounts(): void {
    if (!this.lastScanState?.firstScanComplete) return;
    for (const account of this.accounts) {
      if (this.emptySources.includes(account.source)) continue;
      account.maybeRefresh();
    }
  }

  private accountRevision(): number {
    return this.accounts.reduce((n, account) => n + account.revision, 0);
  }

  async snapshot(
    request?: LiveConsumptionSnapshotRequest
  ): Promise<LiveConsumptionSnapshot> {
    const snapshot = await this.scanner.snapshot(request);
    this.lastScanState = snapshot.scanState;
    this.emptySources = snapshot.emptySources;
    this.refreshAccounts();
    const views = this.accounts.map(account => account.view());
    const revision =
      snapshot.scanState.revision + views.reduce((n, v) => n + v.revision, 0);
    const windowObservations = [
      ...snapshot.windowObservations,
      ...views.flatMap(v => v.observations),
    ].sort((left, right) => left.observedAtMs - right.observedAtMs);
    return {
      ...snapshot,
      scanState: { ...snapshot.scanState, revision },
      planWindows: [...snapshot.planWindows, ...views.flatMap(v => v.windows)],
      windowObservations,
      // One pace per bucket from the merged history: a bucket both the logs
      // and the account report is one series, not two competing rates.
      windowRates: derivePlanWindowRates(windowObservations),
      providerPlanAccounts: views.map(v => v.account),
    };
  }

  rescan(): void {
    this.refreshAccounts();
    this.scanner.rescan();
  }

  cancelScan(): void {
    this.scanner.cancelScan();
  }

  onUpdated(listener: (event: ConsumptionUpdatedEvent) => void): () => void {
    const compose = (scanState: ConsumptionScanState): ConsumptionUpdatedEvent => {
      const revision = scanState.revision + this.accountRevision();
      return { revision, scanState: { ...scanState, revision } };
    };
    const offScanner = this.scanner.onUpdated(event => {
      this.lastScanState = event.scanState;
      listener(compose(event.scanState));
    });
    const offAccounts = this.accounts.map(account =>
      account.onUpdated(() => {
        listener(compose(this.lastScanState ?? idleScanState()));
      })
    );
    return () => {
      offScanner();
      for (const off of offAccounts) off();
    };
  }
}
