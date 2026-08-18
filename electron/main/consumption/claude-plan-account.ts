/**
 * ENG-038 slice 1 — the Claude plan-account read.
 *
 * Claude Code definitively records no plan, quota, or rate-limit data in its
 * local files (`docs/engineering/projects/consumption-spine.md` §4), so plan
 * truth for Claude can only come from the vendor: the endpoint Claude Code's
 * own `/usage` consults, `GET https://api.anthropic.com/api/oauth/usage`.
 * That makes this module the OTHER consumption source class — CREDENTIALED,
 * REMOTE, read-only — and it is deliberately a SIBLING of the scanner
 * service, never part of it: the local-parse spine's no-credential/no-network
 * thesis is load-bearing and untouched.
 *
 * Custody invariants (unit-pinned in `claude-plan-account.test.ts`):
 *
 * - The OAuth token is the one Claude Code itself already holds on this
 *   machine (macOS Keychain, service `Claude Code-credentials`). It is READ
 *   where it lives, held only in a local variable for the duration of one
 *   request, and never copied, persisted, logged, or included in any error
 *   or state object.
 * - Requests go to `api.anthropic.com` and nowhere else; redirects are
 *   refused (`redirect: 'error'`) so the token cannot be replayed to another
 *   host.
 * - An expired token is never sent, and this module NEVER refreshes it —
 *   rotating the refresh token would race Claude Code's own credential
 *   handling. Claude Code refreshes it in normal use; until then the read
 *   degrades to absence.
 *
 * Failure semantics: absence, never an error state. A failed fetch, expired
 * token, revoked scope, or drifted schema leaves the last successful
 * observation in place with its TRUE `observedAt` (the renderer's existing
 * freshness rule judges it) and, when nothing was ever observed, leaves
 * Claude exactly as it read before ENG-038 — "unmetered here, not at zero".
 *
 * Refresh policy: pulled by the composite on snapshot pulls and rescans,
 * throttled to one fetch per `minFetchIntervalMs` (default 5 minutes) plus
 * jitter. The vendor page self-describes as sub-minute fresh; five minutes is
 * deliberately conservative and the renderer's existing 5-minute visible
 * rescan drives the cadence without a dedicated timer.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  WindowObservationAccumulator,
  derivePlanWindowRates,
  type PlanWindow,
  type PlanWindowObservation,
  type ProviderPlanAccountState,
  type ProviderPlanSpend,
} from '@exawatt/core';

/** The one host this module may speak to. */
export const CLAUDE_USAGE_ENDPOINT =
  'https://api.anthropic.com/api/oauth/usage';

/** The beta header the endpoint requires for OAuth bearer tokens. */
export const CLAUDE_OAUTH_BETA_HEADER = 'oauth-2025-04-20';

/** Keychain item Claude Code stores its own OAuth credential under. */
export const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';

/**
 * Credentialed account reads belong to a build with a DURABLE network
 * identity, and the distribution contract is what declares one (BUG-060).
 *
 * Packaging alone was the pre-split proxy and is not the boundary: a
 * contributor's ad-hoc package reports `app.isPackaged === true` and presents
 * Little Snitch a new CDHash on every Electron revision, which is exactly the
 * approval churn incident `0011` recorded. Decision `0036` §6 therefore moves
 * the grant into schema V2's `ownAccount.claudePlanUsage`, which the
 * distributor sets beside its own signing custody. Community declares none.
 *
 * Packaging remains NECESSARY, not sufficient: an unpackaged run built from an
 * official contract is still ad-hoc-signed Electron, so it is still `0011`.
 * A focused developer may opt in explicitly when exercising this exact
 * integration; routine dev and eval launches stay local.
 */
export function isClaudePlanRemoteReadAllowed(options: {
  /** `ownAccount.claudePlanUsage === 'stable-signed'` in the resolved
   *  distribution contract. The grant. */
  stableSignedIdentity: boolean;
  /** The running artifact is a package, not an unpackaged dev runtime. */
  packaged: boolean;
  testMode?: boolean;
  developmentOptIn?: string;
}): boolean {
  return (
    options.developmentOptIn === '1' ||
    (options.stableSignedIdentity &&
      options.packaged &&
      options.testMode !== true)
  );
}

const STATE_FILE = 'claude-plan.json';
const DEFAULT_MIN_FETCH_INTERVAL_MS = 5 * 60_000;
const DEFAULT_JITTER_MS = 45_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* credential — read where it lives, never kept                        */
/* ------------------------------------------------------------------ */

export interface ClaudeOauthCredential {
  accessToken: string;
  /** ms epoch; null when the record does not state one. */
  expiresAtMs: number | null;
  /** e.g. `max` — the plan identity the account itself reports. */
  subscriptionType: string | null;
}

function runSecurity(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error('keychain read failed'));
        else resolve(stdout);
      }
    );
  });
}

/**
 * Reads Claude Code's own credential from the Keychain. Returns null on any
 * failure — a missing item, an unparsable payload, no signed-in OAuth block.
 * The rejection above deliberately carries a fixed message: the real error
 * could echo command output, and nothing token-adjacent may reach a log.
 */
export async function readClaudeCredential(
  run: () => Promise<string> = runSecurity
): Promise<ClaudeOauthCredential | null> {
  let raw: string;
  try {
    raw = await run();
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: unknown;
        expiresAt?: unknown;
        subscriptionType?: unknown;
      };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
      return null;
    }
    return {
      accessToken: oauth.accessToken,
      expiresAtMs:
        typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt)
          ? oauth.expiresAt
          : null,
      subscriptionType:
        typeof oauth.subscriptionType === 'string'
          ? oauth.subscriptionType
          : null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* response parse — pure, fixture-drivable                             */
/* ------------------------------------------------------------------ */

export interface ClaudeUsageParse {
  windows: PlanWindow[];
  spend: ProviderPlanSpend | null;
}

const WEEK_MINUTES = 7 * 24 * 60;
const SESSION_MINUTES = 5 * 60;

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface LimitRow {
  kind: string | null;
  group: string | null;
  percent: number | null;
  resetsAt: string | null;
  scopeLabel: string | null;
}

function readLimitRow(candidate: unknown): LimitRow | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const row = candidate as {
    kind?: unknown;
    group?: unknown;
    percent?: unknown;
    resets_at?: unknown;
    scope?: unknown;
  };
  let scopeLabel: string | null = null;
  if (row.scope && typeof row.scope === 'object') {
    const scope = row.scope as {
      model?: { display_name?: unknown } | null;
      surface?: unknown;
    };
    if (typeof scope.model?.display_name === 'string') {
      scopeLabel = scope.model.display_name;
    } else if (typeof scope.surface === 'string') {
      scopeLabel = scope.surface;
    }
  }
  return {
    kind: typeof row.kind === 'string' ? row.kind : null,
    group: typeof row.group === 'string' ? row.group : null,
    percent: finiteOrNull(row.percent),
    resetsAt: isoOrNull(row.resets_at),
    scopeLabel,
  };
}

/**
 * `limits[]` row → window identity. The window LENGTH comes from the vendor's
 * own `group` vocabulary (`session` = 5h, `weekly` = 7d) so a renamed `kind`
 * still parses; an unknown group is skipped — absence over a guessed
 * denominator. `limitId` is the stable per-window bucket id ENG-038 requires.
 */
function limitIdentity(
  row: LimitRow
): { limitId: string; limitName: string; windowMinutes: number } | null {
  const group = row.group ?? (row.kind === 'session' ? 'session' : null);
  if (group === 'session') {
    return {
      limitId: 'claude-session',
      limitName: 'Current session',
      windowMinutes: SESSION_MINUTES,
    };
  }
  if (group !== 'weekly') return null;
  if (row.scopeLabel) {
    return {
      limitId: `claude-weekly-${slug(row.scopeLabel)}`,
      limitName: `Weekly — ${row.scopeLabel}`,
      windowMinutes: WEEK_MINUTES,
    };
  }
  return {
    limitId: 'claude-weekly-all',
    limitName: 'Weekly — all models',
    windowMinutes: WEEK_MINUTES,
  };
}

function parseSpend(payload: {
  spend?: unknown;
  extra_usage?: unknown;
}): ProviderPlanSpend | null {
  if (payload.spend && typeof payload.spend === 'object') {
    const spend = payload.spend as {
      used?: { amount_minor?: unknown; currency?: unknown; exponent?: unknown };
      limit?: { amount_minor?: unknown } | null;
      percent?: unknown;
      enabled?: unknown;
    };
    const usedMinor = finiteOrNull(spend.used?.amount_minor);
    if (usedMinor !== null) {
      return {
        usedMinor,
        limitMinor: finiteOrNull(spend.limit?.amount_minor),
        currency:
          typeof spend.used?.currency === 'string'
            ? spend.used.currency
            : 'USD',
        exponent: finiteOrNull(spend.used?.exponent) ?? 2,
        percent: finiteOrNull(spend.percent),
        enabled: spend.enabled === true,
      };
    }
  }
  if (payload.extra_usage && typeof payload.extra_usage === 'object') {
    const extra = payload.extra_usage as {
      used_credits?: unknown;
      monthly_limit?: unknown;
      utilization?: unknown;
      currency?: unknown;
      decimal_places?: unknown;
      is_enabled?: unknown;
    };
    const usedMinor = finiteOrNull(extra.used_credits);
    if (usedMinor !== null) {
      return {
        usedMinor,
        limitMinor: finiteOrNull(extra.monthly_limit),
        currency: typeof extra.currency === 'string' ? extra.currency : 'USD',
        exponent: finiteOrNull(extra.decimal_places) ?? 2,
        percent: finiteOrNull(extra.utilization),
        enabled: extra.is_enabled === true,
      };
    }
  }
  return null;
}

/**
 * Response → plan windows + spend. Pure, throw-free: anything unrecognizable
 * contributes nothing. The self-describing `limits[]` array is primary (it is
 * what claude.ai's own usage page renders); the legacy `five_hour`/`seven_day`
 * fields are the fallback for an older response shape. The legacy top-level
 * bucket names beyond those two are experiment codenames observed to churn
 * (`tangelo`, `nimbus_quill`, …) and are deliberately not parsed.
 */
export function parseClaudeUsage(
  payload: unknown,
  observedAt: string,
  planType: string | null
): ClaudeUsageParse {
  if (!payload || typeof payload !== 'object') {
    return { windows: [], spend: null };
  }
  const body = payload as {
    limits?: unknown;
    five_hour?: unknown;
    seven_day?: unknown;
    spend?: unknown;
    extra_usage?: unknown;
  };

  const shared = {
    source: 'claude-code' as const,
    scope: 'primary' as const,
    planType,
    observedAt,
    providerSessionId: '',
    origin: 'provider-account' as const,
  };

  const byId = new Map<string, PlanWindow>();

  if (Array.isArray(body.limits)) {
    for (const candidate of body.limits) {
      const row = readLimitRow(candidate);
      if (!row || row.percent === null) continue;
      const identity = limitIdentity(row);
      if (!identity) continue;
      byId.set(identity.limitId, {
        ...shared,
        ...identity,
        usedPercent: row.percent,
        resetsAt: row.resetsAt,
      });
    }
  }

  if (byId.size === 0) {
    const legacy: Array<[unknown, ReturnType<typeof limitIdentity>]> = [
      [
        body.five_hour,
        {
          limitId: 'claude-session',
          limitName: 'Current session',
          windowMinutes: SESSION_MINUTES,
        },
      ],
      [
        body.seven_day,
        {
          limitId: 'claude-weekly-all',
          limitName: 'Weekly — all models',
          windowMinutes: WEEK_MINUTES,
        },
      ],
    ];
    for (const [candidate, identity] of legacy) {
      if (!candidate || typeof candidate !== 'object' || !identity) continue;
      const bucket = candidate as {
        utilization?: unknown;
        resets_at?: unknown;
      };
      const percent = finiteOrNull(bucket.utilization);
      if (percent === null) continue;
      byId.set(identity.limitId, {
        ...shared,
        ...identity,
        usedPercent: percent,
        resetsAt: isoOrNull(bucket.resets_at),
      });
    }
  }

  return { windows: [...byId.values()], spend: parseSpend(body) };
}

/* ------------------------------------------------------------------ */
/* the service                                                         */
/* ------------------------------------------------------------------ */

export interface ClaudePlanAccountView {
  windows: PlanWindow[];
  observations: PlanWindowObservation[];
  rates: Record<string, number>;
  account: ProviderPlanAccountState;
  /** Monotonic within a launch; bumps whenever the view changes. */
  revision: number;
}

export interface ClaudePlanAccountOptions {
  /** Directory this service may write. Its ONLY write path. */
  stateDir: string;
  /** Seeded from settings; `setEnabled` applies the toggle live. */
  enabled: boolean;
  /**
   * Immutable runtime capability. False for unsigned development copies so a
   * settings write cannot accidentally open this credentialed network path.
   */
  remoteReadAllowed?: boolean;
  fetchFn?: typeof fetch;
  readCredential?: () => Promise<ClaudeOauthCredential | null>;
  now?: () => number;
  minFetchIntervalMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
}

interface PersistedPlanState {
  version: 1;
  observedAt: string | null;
  planType: string | null;
  windows: PlanWindow[];
  observations: PlanWindowObservation[];
  spend: ProviderPlanSpend | null;
}

export class ClaudePlanAccountService {
  private readonly stateDir: string;
  private readonly fetchFn: typeof fetch;
  private readonly readCredential: () => Promise<ClaudeOauthCredential | null>;
  private readonly now: () => number;
  private readonly minFetchIntervalMs: number;
  private readonly jitterMs: number;
  private readonly timeoutMs: number;
  private readonly remoteReadAllowed: boolean;

  private preferenceEnabled: boolean;
  private windows: PlanWindow[] = [];
  private observations = new WindowObservationAccumulator();
  private spend: ProviderPlanSpend | null = null;
  private planType: string | null = null;
  private observedAt: string | null = null;
  private available = false;
  private revision = 0;
  private nextAllowedAtMs = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(options: ClaudePlanAccountOptions) {
    this.stateDir = options.stateDir;
    this.preferenceEnabled = options.enabled;
    this.remoteReadAllowed = options.remoteReadAllowed ?? true;
    this.fetchFn = options.fetchFn ?? fetch;
    this.readCredential = options.readCredential ?? readClaudeCredential;
    this.now = options.now ?? Date.now;
    this.minFetchIntervalMs =
      options.minFetchIntervalMs ?? DEFAULT_MIN_FETCH_INTERVAL_MS;
    this.jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.loadPersisted();
  }

  private get enabled(): boolean {
    return this.preferenceEnabled && this.remoteReadAllowed;
  }

  /** Current state, synchronously. Disabled serves ABSENCE — no windows,
   *  no rates — while persisted state stays on disk for a later re-enable. */
  view(): ClaudePlanAccountView {
    if (!this.enabled) {
      return {
        windows: [],
        observations: [],
        rates: {},
        account: {
          source: 'claude-code',
          status: 'disabled',
          observedAt: null,
          planType: null,
          spend: null,
        },
        revision: this.revision,
      };
    }
    const observations = this.observations.list();
    return {
      windows: [...this.windows],
      observations,
      rates: derivePlanWindowRates(observations),
      account: {
        source: 'claude-code',
        status: this.available ? 'ok' : 'unavailable',
        observedAt: this.observedAt,
        planType: this.planType,
        spend: this.spend,
      },
      revision: this.revision,
    };
  }

  /**
   * Fire-and-forget: never blocks a snapshot, never runs concurrently, never
   * fetches more often than the cadence. Callers may invoke it on every pull
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
   *  on the very next view and no further request is constructed. */
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
    const credential = await this.readCredential().catch(() => null);
    if (this.disposed || !this.enabled) return;
    if (!credential) {
      this.markUnavailable();
      return;
    }
    // An expired token is never sent, and never refreshed here — Claude Code
    // owns that credential's lifecycle. Degrade to absence until it does.
    if (
      credential.expiresAtMs !== null &&
      credential.expiresAtMs <= this.now()
    ) {
      this.markUnavailable();
      return;
    }
    let payload: unknown;
    try {
      const response = await this.fetchFn(CLAUDE_USAGE_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'anthropic-beta': CLAUDE_OAUTH_BETA_HEADER,
          'Content-Type': 'application/json',
        },
        // The token must not follow a redirect off api.anthropic.com.
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        this.markUnavailable();
        return;
      }
      payload = await response.json();
    } catch {
      this.markUnavailable();
      return;
    }
    if (this.disposed || !this.enabled) return;
    const observedAt = new Date(this.now()).toISOString();
    const parsed = parseClaudeUsage(
      payload,
      observedAt,
      credential.subscriptionType
    );
    if (parsed.windows.length === 0 && parsed.spend === null) {
      // Schema drift or an account with nothing to report: absence, with any
      // previous observation kept at its true age for freshness to judge.
      this.markUnavailable();
      return;
    }
    this.windows = parsed.windows;
    this.spend = parsed.spend;
    this.planType = credential.subscriptionType;
    this.observedAt = observedAt;
    this.available = true;
    for (const window of parsed.windows) this.observations.addWindow(window);
    this.persist();
    this.bump();
  }

  private markUnavailable(): void {
    if (!this.available) return; // already absent — nothing changed
    this.available = false;
    this.bump();
  }

  /* ---------------------------------------------------------------- */
  /* persistence — last-known state only, NEVER credential material    */
  /* ---------------------------------------------------------------- */

  private get stateFile(): string {
    return path.join(this.stateDir, STATE_FILE);
  }

  private loadPersisted(): void {
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedPlanState;
      if (parsed.version !== 1) return;
      this.windows = Array.isArray(parsed.windows) ? parsed.windows : [];
      this.observations = new WindowObservationAccumulator(
        {},
        Array.isArray(parsed.observations) ? parsed.observations : []
      );
      this.spend = parsed.spend ?? null;
      this.planType = parsed.planType ?? null;
      this.observedAt = parsed.observedAt ?? null;
      this.available = this.windows.length > 0;
    } catch {
      // No persisted state is a normal first launch.
    }
  }

  private persist(): void {
    const state: PersistedPlanState = {
      version: 1,
      observedAt: this.observedAt,
      planType: this.planType,
      windows: this.windows,
      observations: this.observations.list(),
      spend: this.spend,
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
