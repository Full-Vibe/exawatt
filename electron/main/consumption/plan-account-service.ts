/**
 * A vendor plan-account read, independent of the vendor (ENG-038 slice 2).
 *
 * Every credentialed or harness-protocol account read has the same life: a
 * throttled fetch that never blocks a snapshot, a last-known state persisted
 * for warm launches, a bounded history of observations so pace is
 * observable, and an operator off switch. This class is
 * that life; a vendor supplies only its `read` (Claude: `/usage` through the
 * operator's own `claude` binary; Codex: its own app-server; Google: `/usage`
 * through the operator's own `agy`). A future Agent Source plugin adds an
 * account the same way.
 *
 * Failure semantics: never zero, never fresh. A failed read leaves the last
 * successful observation in place with its TRUE `observedAt` (the renderer's
 * freshness rule and the account card's as-of judge it), marks the account
 * `unavailable`, and carries the reader's named cause when it gave one.
 *
 * Persistence holds last-known state only, never credential material.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigFileUnreadableCause } from '@exawatt/core/server';
import {
  WindowObservationAccumulator,
  derivePlanWindowRates,
  type PlanAccountFailureCause,
  type PlanAccountSourceId,
  type PlanCreditBalance,
  type PlanResetOutcome,
  type PlanResets,
  type PlanWindow,
  type PlanWindowObservation,
  type ProviderPlanAccountState,
  type ProviderPlanSpend,
} from '@exawatt/core';
import {
  UnreadableStateWatch,
  jsonStateGrammar,
  readPersistedStateSync,
} from '../persisted-state-file';

/** One successful account read. */
export interface PlanAccountRead {
  windows: PlanWindow[];
  planType: string | null;
  spend?: ProviderPlanSpend | null;
  rateLimitTier?: string | null;
  resets?: PlanResets;
  credits?: PlanCreditBalance;
}

/** A read that failed for a reason the source can name. */
export interface PlanAccountReadFailure {
  failure: PlanAccountFailureCause;
}

/** Resolves null (cause unknown) or a named failure when the account could
 *  not be read this time. */
export type PlanAccountReader = () => Promise<
  PlanAccountRead | PlanAccountReadFailure | null
>;

function isReadFailure(
  read: PlanAccountRead | PlanAccountReadFailure | null
): read is PlanAccountReadFailure {
  return read !== null && 'failure' in read;
}

export interface PlanAccountView {
  windows: PlanWindow[];
  observations: PlanWindowObservation[];
  rates: Record<string, number>;
  account: ProviderPlanAccountState;
  /** Monotonic within a launch; bumps whenever the view changes. */
  revision: number;
}

/** What the plan composite needs from any account read. */
export interface PlanAccountSource {
  /** Which account this reads: a ledgered source, or a vendor account read
   *  without one (ENG-038 slice 4). Cheap; never builds a view. */
  readonly source: PlanAccountSourceId;
  /** Monotonic within a launch. Cheap; never builds a view. */
  readonly revision: number;
  view(): PlanAccountView;
  maybeRefresh(): Promise<void>;
  onUpdated(listener: () => void): () => void;
  /**
   * Whether the harness this account is read through is present on this
   * machine. The composite learns a LEDGERED harness's presence from the
   * corpus; an account with no ledger states it here, so a machine without
   * that harness is never asked and never carries the account. Absent means
   * the corpus decides.
   */
  installed?(): boolean;
}

interface PlanAccountServiceOptions {
  source: PlanAccountSourceId;
  /** Directory this service may write. Its ONLY write path. */
  stateDir: string;
  stateFileName: string;
  /** Names the state file in the unreadable-state log line. */
  stateLabel: string;
  /** Seeded from settings; `setEnabled` applies the toggle live. */
  enabled: boolean;
  /**
   * Immutable for the life of the service: false in an automated test
   * launch, so no Settings write (which `setEnabled` honours) can start a
   * harness process there. Defaults to true.
   */
  allowed?: boolean;
  read: PlanAccountReader;
  /**
   * Spends one banked reset, the soonest to expire when the vendor named
   * them (ENG-008 E17). Absent when the source cannot spend resets.
   */
  spendReset?: (creditId: string | null) => Promise<PlanResetOutcome>;
  /** Re-reads a saved window in the current meaning (schema moves). */
  migrateWindow?: (window: PlanWindow) => PlanWindow;
  now?: () => number;
  minFetchIntervalMs?: number;
  jitterMs?: number;
}

const DEFAULT_MIN_FETCH_INTERVAL_MS = 5 * 60_000;
const DEFAULT_JITTER_MS = 45_000;

interface PersistedPlanState {
  version: 1;
  observedAt: string | null;
  planType: string | null;
  windows: PlanWindow[];
  observations: PlanWindowObservation[];
  spend: ProviderPlanSpend | null;
  rateLimitTier?: string | null;
  resets?: PlanResets;
  credits?: PlanCreditBalance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const optionalRecords = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every(isRecord));
const optionalText = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string';
const optionalRecord = (value: unknown) =>
  value === undefined || value === null || isRecord(value);

/** A state file of another shape is set aside with its bytes (BUG-247). */
const PLAN_STATE_FILE = jsonStateGrammar<PersistedPlanState>(value => {
  if (!isRecord(value) || value.version !== 1) return null;
  if (
    !optionalRecords(value.windows) ||
    !optionalRecords(value.observations) ||
    !optionalText(value.observedAt) ||
    !optionalText(value.planType) ||
    !optionalText(value.rateLimitTier) ||
    !optionalRecord(value.spend) ||
    !optionalRecord(value.resets) ||
    !optionalRecord(value.credits)
  ) {
    return null;
  }
  return {
    version: 1,
    observedAt: (value.observedAt as string | null | undefined) ?? null,
    planType: (value.planType as string | null | undefined) ?? null,
    windows: (value.windows as PlanWindow[] | undefined) ?? [],
    observations:
      (value.observations as PlanWindowObservation[] | undefined) ?? [],
    spend: (value.spend as ProviderPlanSpend | null | undefined) ?? null,
    ...(typeof value.rateLimitTier === 'string'
      ? { rateLimitTier: value.rateLimitTier }
      : {}),
    ...(isRecord(value.resets) ? { resets: value.resets as unknown as PlanResets } : {}),
    ...(isRecord(value.credits)
      ? { credits: value.credits as unknown as PlanCreditBalance }
      : {}),
  };
});

export class PlanAccountService implements PlanAccountSource {
  readonly source: PlanAccountSourceId;
  private readonly allowed: boolean;
  private readonly stateDir: string;
  private readonly stateFileName: string;
  private readonly read: PlanAccountReader;
  private readonly spendReset:
    | ((creditId: string | null) => Promise<PlanResetOutcome>)
    | null;
  private readonly migrateWindow: (window: PlanWindow) => PlanWindow;
  private readonly now: () => number;
  private readonly minFetchIntervalMs: number;
  private readonly jitterMs: number;

  private preferenceEnabled: boolean;
  private last: Omit<PersistedPlanState, 'version' | 'observations'> = {
    observedAt: null,
    planType: null,
    windows: [],
    spend: null,
  };
  private observations = new WindowObservationAccumulator();
  private available = false;
  /** Why the latest read failed; null while reads succeed. Not persisted. */
  private failure: PlanAccountFailureCause | null = null;
  private revisionCount = 0;
  private nextAllowedAtMs = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  /**
   * Set while the state file exists and cannot be read (BUG-247): the file is
   * never written over, and every refresh reads it again.
   */
  private unreadable: ConfigFileUnreadableCause | null = null;
  private readonly watch: UnreadableStateWatch;

  constructor(options: PlanAccountServiceOptions) {
    this.source = options.source;
    this.stateDir = options.stateDir;
    this.stateFileName = options.stateFileName;
    this.watch = new UnreadableStateWatch(this.stateFile, options.stateLabel);
    this.preferenceEnabled = options.enabled;
    this.allowed = options.allowed ?? true;
    this.read = options.read;
    this.spendReset = options.spendReset ?? null;
    this.migrateWindow = options.migrateWindow ?? (window => window);
    this.now = options.now ?? Date.now;
    this.minFetchIntervalMs =
      options.minFetchIntervalMs ?? DEFAULT_MIN_FETCH_INTERVAL_MS;
    this.jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
    this.loadPersisted();
  }

  private get enabled(): boolean {
    return this.preferenceEnabled && this.allowed;
  }

  get revision(): number {
    return this.revisionCount;
  }

  /** Current state, synchronously. Disabled serves ABSENCE (no windows, no
   *  rates) while persisted state stays on disk for a later re-enable. */
  view(): PlanAccountView {
    if (!this.enabled) {
      return {
        windows: [],
        observations: [],
        rates: {},
        account: {
          source: this.source,
          status: 'disabled',
          observedAt: null,
          planType: null,
          spend: null,
        },
        revision: this.revisionCount,
      };
    }
    const observations = this.observations.list();
    const last = this.last;
    return {
      windows: [...last.windows],
      observations,
      rates: derivePlanWindowRates(observations),
      account: {
        source: this.source,
        status: this.available ? 'ok' : 'unavailable',
        ...(this.failure ? { failure: this.failure } : {}),
        observedAt: last.observedAt,
        planType: last.planType,
        spend: last.spend,
        ...(last.rateLimitTier != null ? { rateLimitTier: last.rateLimitTier } : {}),
        ...(last.resets ? { resets: last.resets } : {}),
        ...(last.credits ? { credits: last.credits } : {}),
        ...(this.spendReset ? { canUseReset: true } : {}),
      },
      revision: this.revisionCount,
    };
  }

  /**
   * Fire-and-forget: never blocks a snapshot, never runs concurrently, never
   * reads more often than the cadence. Callers may invoke it on every pull
   * and must not await it; the returned promise exists for tests.
   */
  maybeRefresh(): Promise<void> {
    if (!this.enabled || this.disposed)
      return this.inFlight ?? Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (this.now() < this.nextAllowedAtMs) return Promise.resolve();
    this.nextAllowedAtMs =
      this.now() + this.minFetchIntervalMs + Math.random() * this.jitterMs;
    this.inFlight = this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Spend one banked reset on the operator's explicit confirm, then read the
   * account again at once, past the cadence, so the card shows the restored
   * window rather than the figure from before. Never retried here: the
   * vendor's idempotency key belongs to one attempt.
   */
  async useReset(): Promise<PlanResetOutcome> {
    if (!this.spendReset || !this.enabled || this.disposed) return 'failed';
    // Soonest to expire first (the readers sort them), and never one that
    // lapsed since the read that listed it.
    const nowMs = this.now();
    const credit =
      this.last.resets?.credits?.find(
        row =>
          row.id && (row.expiresAt === null || Date.parse(row.expiresAt) > nowMs)
      ) ?? null;
    let outcome: PlanResetOutcome;
    try {
      outcome = await this.spendReset(credit?.id ?? null);
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'reset') {
      this.nextAllowedAtMs = 0;
      await (this.inFlight ?? Promise.resolve());
      await this.maybeRefresh();
    }
    return outcome;
  }

  /** The settings toggle, applied before it is announced: off serves absence
   *  on the very next view and no further read is made. */
  setEnabled(enabled: boolean): void {
    if (this.preferenceEnabled === enabled) return;
    this.preferenceEnabled = enabled;
    this.bump();
    if (this.enabled) this.maybeRefresh();
  }

  onUpdated(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /* ---------------------------------------------------------------- */

  private bump(): void {
    this.revisionCount += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private async refresh(): Promise<void> {
    if (this.unreadable && this.loadPersisted()) this.bump();
    const read = await this.read().catch(() => null);
    if (this.disposed || !this.enabled) return;
    if (
      !read ||
      isReadFailure(read) ||
      (read.windows.length === 0 && !read.spend && !read.resets)
    ) {
      // A failure, or an answer with nothing in it: the previous observation
      // is kept at its true age for freshness to judge, and the account says
      // it could not be read. An empty answer is never a zero reading.
      this.markUnavailable(
        read === null
          ? null
          : isReadFailure(read)
            ? read.failure
            : 'unrecognized'
      );
      return;
    }
    const observedAt = new Date(this.now()).toISOString();
    this.last = {
      observedAt,
      planType: read.planType,
      windows: read.windows,
      spend: read.spend ?? null,
      ...(read.rateLimitTier != null ? { rateLimitTier: read.rateLimitTier } : {}),
      ...(read.resets ? { resets: read.resets } : {}),
      ...(read.credits ? { credits: read.credits } : {}),
    };
    this.available = true;
    this.failure = null;
    for (const window of read.windows) this.observations.addWindow(window);
    this.persist();
    this.bump();
  }

  private markUnavailable(cause: PlanAccountFailureCause | null): void {
    // Nothing changed when the account was already unreadable for this cause.
    if (!this.available && this.failure === cause) return;
    this.available = false;
    this.failure = cause;
    this.bump();
  }

  /* ---------------------------------------------------------------- */
  /* persistence: last-known state only, NEVER credential material     */
  /* ---------------------------------------------------------------- */

  private get stateFile(): string {
    return path.join(this.stateDir, this.stateFileName);
  }

  /**
   * Reads the last-known state, merging it under anything observed since.
   * Returns whether the file was read (or found missing, or set aside); false
   * while it stays unreadable.
   */
  private loadPersisted(): boolean {
    const read = readPersistedStateSync(this.stateFile, PLAN_STATE_FILE);
    if (read.status === 'unreadable') {
      this.unreadable = read.cause;
      this.watch.failed(read.cause);
      return false;
    }
    this.unreadable = null;
    this.watch.recovered();
    // Missing is a first launch; set aside is a fresh start with the damaged
    // bytes kept beside the store.
    if (read.status !== 'ok') return true;
    const saved = read.value;
    this.observations = new WindowObservationAccumulator({}, [
      ...saved.observations,
      ...this.observations.list(),
    ]);
    const newer =
      this.last.observedAt === null ||
      (saved.observedAt !== null && saved.observedAt > this.last.observedAt);
    if (newer) {
      const { version: _version, observations: _observations, ...rest } = saved;
      this.last = { ...rest, windows: saved.windows.map(this.migrateWindow) };
      // Any successful read counts: one that carried only resets or spend
      // is still a reading, never "could not read".
      this.available =
        this.last.windows.length > 0 || !!this.last.resets || !!this.last.spend;
    }
    return true;
  }

  private persist(): void {
    // Never write over a file that could not be read; what it holds is
    // merged in first once it can be.
    if (this.unreadable && !this.loadPersisted()) return;
    const state: PersistedPlanState = {
      version: 1,
      ...this.last,
      observations: this.observations.list(),
    };
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, this.stateFile);
    } catch {
      // Persistence is an optimization; the live view is already updated.
    }
  }
}
