/**
 * ENG-038 — composes the local scanner with the provider plan-account read
 * behind the ONE `ConsumptionScannerLike` seam the IPC layer serves.
 *
 * The two source classes stay structurally separate — the scanner never
 * gains network code, the plan service never reads a local corpus — and this
 * is the only place their outputs meet:
 *
 * - `planWindows`, `windowObservations`, `windowRates`, and
 *   `providerPlanAccounts` merge additively. Window buckets cannot collide:
 *   the vendor read's `limitId`s are its own (`claude-session`, …) and the
 *   local parse emits no `claude-code` window at all (spine §4).
 * - The served `scanState.revision` is scanner revision + plan revision.
 *   Both are monotonic within a launch, so the sum is too, and the
 *   renderer's revision-gated pulls keep working unchanged.
 * - A snapshot pull or rescan nudges `maybeRefresh()` — fire-and-forget and
 *   cadence-throttled in the service, so pulls never block on the network
 *   and the endpoint is never hammered.
 */
import type {
  ConsumptionUpdatedEvent,
  LiveConsumptionSnapshot,
  LiveConsumptionSnapshotRequest,
  ConsumptionScanState,
} from '@exawatt/core';
import { idleScanState } from '@exawatt/core';
import type { ConsumptionScannerLike } from '../consumption-ipc';
import type { ClaudePlanAccountService } from './claude-plan-account';

export class ProviderPlanCompositeSource implements ConsumptionScannerLike {
  /** Last RAW scanner scan state (its own revision, never the composed one). */
  private lastScanState: ConsumptionScanState | null = null;

  constructor(
    private readonly scanner: ConsumptionScannerLike,
    private readonly plan: ClaudePlanAccountService
  ) {}

  async snapshot(
    request?: LiveConsumptionSnapshotRequest
  ): Promise<LiveConsumptionSnapshot> {
    this.plan.maybeRefresh();
    const snapshot = await this.scanner.snapshot(request);
    this.lastScanState = snapshot.scanState;
    const plan = this.plan.view();
    const revision = snapshot.scanState.revision + plan.revision;
    return {
      ...snapshot,
      scanState: { ...snapshot.scanState, revision },
      planWindows: [...snapshot.planWindows, ...plan.windows],
      windowObservations: [
        ...snapshot.windowObservations,
        ...plan.observations,
      ].sort((left, right) => left.observedAtMs - right.observedAtMs),
      windowRates: { ...snapshot.windowRates, ...plan.rates },
      providerPlanAccounts: [plan.account],
    };
  }

  rescan(): void {
    this.plan.maybeRefresh();
    this.scanner.rescan();
  }

  cancelScan(): void {
    this.scanner.cancelScan();
  }

  onUpdated(listener: (event: ConsumptionUpdatedEvent) => void): () => void {
    const compose = (scanState: ConsumptionScanState): ConsumptionUpdatedEvent => {
      const revision = scanState.revision + this.plan.view().revision;
      return { revision, scanState: { ...scanState, revision } };
    };
    const offScanner = this.scanner.onUpdated(event => {
      this.lastScanState = event.scanState;
      listener(compose(event.scanState));
    });
    const offPlan = this.plan.onUpdated(() => {
      listener(compose(this.lastScanState ?? idleScanState()));
    });
    return () => {
      offScanner();
      offPlan();
    };
  }
}
