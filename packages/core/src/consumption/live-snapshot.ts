/**
 * ENG-008 E5 — the live local-consumption IPC contract.
 *
 * The one shape Electron main hands the renderer when Consumption goes live.
 * Main owns the incremental watermarked scanner (the corpus is 2.66 GB — a
 * cold scan costs 19.3 s and can never run inline, see
 * `docs/engineering/projects/consumption-spine.md` §5); the renderer owns the
 * view-model. This file is the seam both sides import, so it carries types and
 * pure constructors only — no Electron, no Node, no React.
 *
 * Channels (registered in `electron/main/consumption-ipc.ts`, exposed by the
 * preload as `window.electron.consumption`):
 *
 * - `consumption:snapshot`   invoke(request?) -> `LiveConsumptionSnapshot`.
 *   The first call this launch starts the BACKGROUND first scan; the call
 *   itself returns immediately with whatever is known (persisted state, or an
 *   empty snapshot whose `scanState` says a first scan is running). It never
 *   blocks on scanning.
 * - `consumption:updated`    push `ConsumptionUpdatedEvent` — deliberately
 *   tiny (revision + scan state, never samples). The renderer pulls a fresh
 *   snapshot when it cares about the new revision.
 * - `consumption:rescan`     invoke() -> void. Request an incremental pass
 *   now (debounced; a no-op while a pass is already running).
 * - `consumption:cancel-scan` invoke() -> void. Cancel the in-flight pass.
 *   Work already done is kept: samples stay, completed files keep their
 *   watermarks, and `scanState.cancelled` reads true until the next pass.
 *
 * Honesty rules the snapshot inherits from the spine:
 *
 * - Claude Code reports NO plan window anywhere on disk (definitive, §4).
 *   The LOCAL parse therefore never emits a `claude-code` window, and
 *   `SOURCE_CAPABILITIES` still states that capability truthfully. Claude
 *   windows that DO appear here arrived through ENG-038's separate
 *   credentialed source class (`origin: 'provider-account'`, the vendor's
 *   own account endpoint) — never from a local file, and never fabricated.
 *   When that read is off or failing, the entries are simply absent again.
 * - Degenerate windows (`windowMinutes <= 0`) are discarded before the
 *   snapshot, but counted in `discardedDegenerateWindows` — dropped from use,
 *   never dropped in silence.
 * - `planWindows` is keyed by `limitId` (plan identity is not global — two
 *   limitIds appear on one real machine), holds the LATEST observation per
 *   window bucket, and carries `observedAt` so the renderer's existing
 *   `windowFreshness` rule (live / stale / expired) keeps working unchanged.
 * - Until `scanState.firstScanComplete` is true the samples are a PARTIAL
 *   corpus and every surface must say so rather than presenting a low total
 *   as truth.
 */
import type { ConsumptionSourceId } from './types';
import type {
  ConsumptionDiagnostics,
  ConsumptionSample,
  PlanWindow,
} from './types';
import { emptyDiagnostics } from './types';

/**
 * ENG-038 — one provider's plan-account read, as carried on the snapshot.
 *
 * This is the OTHER source class beside the local parse: a credentialed,
 * remote, read-only fetch of the vendor's own account state (for Claude, the
 * endpoint Claude Code's `/usage` consults). Its windows enter
 * `LiveConsumptionSnapshot.planWindows` with `origin: 'provider-account'`
 * and flow through the same freshness rules; this record carries the
 * account-level facts that are not windows.
 *
 * Honesty rules:
 * - `unavailable` (endpoint failed, token expired, schema drifted) presents
 *   as ABSENCE downstream, never as an error state, and any windows still on
 *   the snapshot keep their true (old) `observedAt` for the freshness rule
 *   to judge.
 * - `disabled` means the operator switched the read off: nothing is fetched
 *   and no windows from this account ride the snapshot at all.
 * - `spend` is the vendor's usage-credit figure (the spend-class dimension,
 *   captured for the model; deliberately no UI in ENG-038 slice 1).
 */
export type ProviderPlanAccountStatus = 'ok' | 'unavailable' | 'disabled';

/** Vendor-reported usage-credit spend, in minor currency units. */
export interface ProviderPlanSpend {
  /** e.g. 20160 with exponent 2 = $201.60. */
  usedMinor: number;
  /** null when the vendor reports no limit. */
  limitMinor: number | null;
  currency: string;
  exponent: number;
  /** Vendor's own 0-100 figure when reported. */
  percent: number | null;
  /** Whether extra usage / credits are currently enabled on the account. */
  enabled: boolean;
}

export interface ProviderPlanAccountState {
  source: ConsumptionSourceId;
  status: ProviderPlanAccountStatus;
  /** ISO 8601 instant of the last SUCCESSFUL fetch; null before one. */
  observedAt: string | null;
  /** The account's own plan identity, e.g. `max`. */
  planType: string | null;
  spend: ProviderPlanSpend | null;
}

export const LIVE_CONSUMPTION_SNAPSHOT_VERSION = 1 as const;

/**
 * What the scanner is doing right now.
 *
 * - `idle`         — no pass running. Before the first snapshot request the
 *                    scanner has not started at all.
 * - `first-scan`   — the explicitly backgrounded, cancellable full corpus
 *                    read. Only ever runs when no usable persisted state
 *                    exists; progress is meaningful and worth rendering.
 * - `incremental`  — a cheap watermarked pass over changed files only.
 */
export type ConsumptionScanPhase = 'idle' | 'first-scan' | 'incremental';

export interface ConsumptionScanProgress {
  /** Files inspected so far in this pass. */
  filesSeen: number;
  /** Files this pass intends to inspect. */
  filesTotal: number;
  /** Bytes actually read so far in this pass. */
  bytesRead: number;
}

export interface ConsumptionScanState {
  phase: ConsumptionScanPhase;
  /** Present only while a pass is running; null when `phase` is `idle`. */
  progress: ConsumptionScanProgress | null;
  /** ISO 8601 instant the last COMPLETED pass finished. null before one has. */
  lastScanAt: string | null;
  /** Total on-disk bytes of the corpus at the last completed pass. */
  corpusBytes: number | null;
  /**
   * A full scan has completed at least once — this launch or a previous one
   * whose state persisted. Until true, `samples` is a partial corpus.
   */
  firstScanComplete: boolean;
  /**
   * Monotonic within a launch; bumps whenever snapshot contents change.
   * `consumption:updated` carries it so the renderer can skip stale pulls.
   */
  revision: number;
  /** The most recent pass was cancelled before it finished. */
  cancelled: boolean;
}

/**
 * One durable-Session ↔ provider-conversation link, from the main-owned
 * identity index (`SessionIdentityStore`). This is the E2 attribution join:
 * samples carry `providerSessionId`/`cwd`/`gitBranch`, and this record is how
 * the renderer rolls a provider conversation up into the Exawatt Session that
 * launched it — main exposes the index, the renderer never re-derives it.
 * A provider session with no link here is honestly outside the fleet record.
 */
export interface LiveSessionIdentityLink {
  source: ConsumptionSourceId;
  providerSessionId: string;
  durableSessionId: string;
  /** Launch directory the identity was recorded under. */
  cwd: string;
}

/**
 * One point of a plan window's observed history, downsampled and bounded by
 * main. `PlanWindow` is the latest state; this series is how pace becomes
 * observable (%/h needs two observations spaced in time). Bucket identity is
 * `planWindowKey()` from `./plan-window-history` — never `limitId` alone,
 * because one limitId carries both a primary and a secondary window.
 */
export interface PlanWindowObservation {
  source: ConsumptionSourceId;
  limitId: string | null;
  scope: 'primary' | 'secondary';
  windowMinutes: number;
  usedPercent: number;
  /** ms epoch of the harness's own observation instant. */
  observedAtMs: number;
}

export interface LiveConsumptionSnapshot {
  version: typeof LIVE_CONSUMPTION_SNAPSHOT_VERSION;
  /** ms epoch instant main assembled this snapshot. */
  generatedAtMs: number;
  scanState: ConsumptionScanState;
  /**
   * Corpus-globally merged samples (E0's idempotency-key rule — parent and
   * subagent records never double-count), sorted ascending by `at`. Bounded
   * by `LiveConsumptionSnapshotRequest.sinceMs` when the caller sets it.
   */
  samples: ConsumptionSample[];
  /**
   * Capacity truth (E1): the latest observation per plan-window bucket,
   * keyed by `limitId` — never by source. Degenerate records are already
   * discarded; freshness stays the renderer's judgment via `observedAt`.
   * Contains no entry at all for a source that reports nothing (Claude Code).
   */
  planWindows: PlanWindow[];
  /** `windowMinutes <= 0` records discarded from `planWindows`. */
  discardedDegenerateWindows: number;
  /** Bounded observed history per window, ascending by `observedAtMs`. */
  windowObservations: PlanWindowObservation[];
  /**
   * Observed consumption rate in percent per hour, derived by main from
   * `windowObservations` within the current reset cycle. Keyed by
   * `planWindowKey()` (`./plan-window-history`) — limitId + scope +
   * windowMinutes, since one limitId carries two windows. A bucket ABSENT
   * from this record has no derivable rate yet (a single observation cannot
   * state a pace) — absent, never zero; a genuinely flat window reports `0`.
   */
  windowRates: Record<string, number>;
  /**
   * ENG-038 — per-provider plan-account reads (the credentialed source
   * class). Their windows already ride `planWindows` with
   * `origin: 'provider-account'`; this carries the account-level state.
   * Absent on snapshots produced before the field existed and when no
   * account source is configured — absent, never an empty claim.
   */
  providerPlanAccounts?: ProviderPlanAccountState[];
  /** The durable-Session identity index. See `LiveSessionIdentityLink`. */
  sessionIdentities: LiveSessionIdentityLink[];
  /** Accumulated scan diagnostics — everything unused is counted, not lost. */
  diagnostics: ConsumptionDiagnostics;
  /** Sources whose corpus directory held zero files (harness not installed). */
  emptySources: ConsumptionSourceId[];
}

export interface LiveConsumptionSnapshotRequest {
  /**
   * Only samples with `at >= sinceMs` are returned. The full corpus is ~96k
   * samples; a surface that renders a window should ask for that window
   * rather than shipping the whole history over IPC on every pull.
   * `planWindows`, identities, diagnostics, and scan state are unaffected.
   */
  sinceMs?: number;
}

/** Payload of every `consumption:updated` push. Small on purpose. */
export interface ConsumptionUpdatedEvent {
  revision: number;
  scanState: ConsumptionScanState;
}

export function idleScanState(): ConsumptionScanState {
  return {
    phase: 'idle',
    progress: null,
    lastScanAt: null,
    corpusBytes: null,
    firstScanComplete: false,
    revision: 0,
    cancelled: false,
  };
}

export function emptyLiveConsumptionSnapshot(
  generatedAtMs: number
): LiveConsumptionSnapshot {
  return {
    version: LIVE_CONSUMPTION_SNAPSHOT_VERSION,
    generatedAtMs,
    scanState: idleScanState(),
    samples: [],
    planWindows: [],
    discardedDegenerateWindows: 0,
    windowObservations: [],
    windowRates: {},
    sessionIdentities: [],
    diagnostics: emptyDiagnostics(),
    emptySources: [],
  };
}
