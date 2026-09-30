/**
 * A vendor plan-account read, independent of the vendor (ENG-038 slice 2).
 *
 * Every credentialed or harness-protocol account read has the same life: a
 * throttled fetch that never blocks a snapshot, a last-known state persisted
 * for warm launches, a bounded history of observations so pace is
 * observable, an operator off switch, and a build-level grant. This class is
 * that life; a vendor supplies only its `read` (Claude: the usage endpoint
 * behind Claude Code's own Keychain sign-in; Codex: its own app-server). A
 * future Agent Source plugin adds an account the same way.
 *
 * Failure semantics: absence, never an error state. A failed read leaves the
 * last successful observation in place with its TRUE `observedAt` (the
 * renderer's freshness rule and the account card's as-of judge it) and marks
 * the account `unavailable`.
 *
 * Persistence holds last-known state only, never credential material.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigFileUnreadableCause } from '@exawatt/core/server';
import {
  WindowObservationAccumulator,
  derivePlanWindowRates,
  type ConsumptionSourceId,
  type PlanCreditBalance,
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

/** Resolves null when the account could not be read this time. */
export type PlanAccountReader = () => Promise<PlanAccountRead | null>;

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
  view(): PlanAccountView;
  maybeRefresh(): Promise<void>;
  onUpdated(listener: () => void): () => void;
}

interface PlanAccountServiceOptions {
  source: ConsumptionSourceId;
  /** Directory this service may write. Its ONLY write path. */
  stateDir: string;
  stateFileName: string;
  /** Names the state file in the unreadable-state log line. */
  stateLabel: string;
  /** Seeded from settings; `setEnabled` applies the toggle live. */
  enabled: boolean;
  /**
   * Immutable runtime capability: false when this build holds no grant to
   * make the read at all, so a settings write cannot open it (BUG-060).
   */
  remoteReadAllowed?: boolean;
  read: PlanAccountReader;
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
  private readonly source: ConsumptionSourceId;
  private readonly stateDir: string;
  private readonly stateFileName: string;
  private readonly read: PlanAccountReader;
  private readonly migrateWindow: (window: PlanWindow) => PlanWindow;
  private readonly now: () => number;
  private readonly minFetchIntervalMs: number;
  private readonly jitterMs: number;
  private readonly remoteReadAllowed: boolean;

  private preferenceEnabled: boolean;
  private last: Omit<PersistedPlanState, 'version' | 'observations'> = {
    observedAt: null,
    planType: null,
    windows: [],
    spend: null,
  };
  private observations = new WindowObservationAccumulator();
  private available = false;
  private revision = 0;
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
    this.remoteReadAllowed = options.remoteReadAllowed ?? true;
    this.read = options.read;
    this.migrateWindow = options.migrateWindow ?? (window => window);
    this.now = options.now ?? Date.now;
    this.minFetchIntervalMs =
      options.minFetchIntervalMs ?? DEFAULT_MIN_FETCH_INTERVAL_MS;
    this.jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
    this.loadPersisted();
  }

  private get enabled(): boolean {
    return this.preferenceEnabled && this.remoteReadAllowed;
  }

  /** Current state, synchronously. Disabled serves ABSENCE (no windows, no
   *  rates) while persisted state stays on disk for a later re-enable. A
   *  build with no grant says so as its own status (BUG-149): the capability
   *  fact and the operator's preference are two different facts. */
  view(): PlanAccountView {
    if (!this.enabled) {
      return {
        windows: [],
        observations: [],
        rates: {},
        account: {
          source: this.source,
          status: this.remoteReadAllowed ? 'disabled' : 'unconfigured',
          observedAt: null,
          planType: null,
          spend: null,
        },
        revision: this.revision,
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
        observedAt: last.observedAt,
        planType: last.planType,
        spend: last.spend,
        ...(last.rateLimitTier != null ? { rateLimitTier: last.rateLimitTier } : {}),
        ...(last.resets ? { resets: last.resets } : {}),
        ...(last.credits ? { credits: last.credits } : {}),
      },
      revision: this.revision,
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
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private async refresh(): Promise<void> {
    if (this.unreadable && this.loadPersisted()) this.bump();
    const read = await this.read().catch(() => null);
    if (this.disposed || !this.enabled) return;
    if (!read || (read.windows.length === 0 && !read.spend && !read.resets)) {
      // Failure, or schema drift into nothing: absence, with the previous
      // observation kept at its true age for freshness to judge.
      this.markUnavailable();
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
    for (const window of read.windows) this.observations.addWindow(window);
    this.persist();
    this.bump();
  }

  private markUnavailable(): void {
    if (!this.available) return; // already absent: nothing changed
    this.available = false;
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
      this.available = this.last.windows.length > 0;
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
