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
 * Refresh policy (the shared `PlanAccountService`): pulled by the composite
 * on snapshot pulls and rescans, throttled to one fetch per
 * `minFetchIntervalMs` (default 5 minutes) plus jitter. The vendor page self-describes as sub-minute fresh; five minutes is
 * deliberately conservative and the renderer's existing 5-minute visible
 * rescan drives the cadence without a dedicated timer.
 */
import { execFile } from 'node:child_process';
import type { PlanWindow, ProviderPlanSpend } from '@exawatt/core';
import {
  PlanAccountService,
  type PlanAccountReader,
  type PlanAccountView,
} from './plan-account-service';

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
  /** e.g. `default_claude_max_20x` — the tier within the plan. */
  rateLimitTier: string | null;
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
        rateLimitTier?: unknown;
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
      rateLimitTier:
        typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
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
): { limitId: string; limitName: string | null; windowMinutes: number } | null {
  const group = row.group ?? (row.kind === 'session' ? 'session' : null);
  if (group === 'session') {
    return {
      limitId: 'claude-session',
      limitName: null,
      windowMinutes: SESSION_MINUTES,
    };
  }
  if (group !== 'weekly') return null;
  if (row.scopeLabel) {
    return {
      limitId: `claude-weekly-${slug(row.scopeLabel)}`,
      // The model the limit is scoped to, in the vendor's own words.
      limitName: row.scopeLabel,
      windowMinutes: WEEK_MINUTES,
    };
  }
  return {
    limitId: 'claude-weekly-all',
    limitName: null,
    windowMinutes: WEEK_MINUTES,
  };
}

/**
 * State written before ENG-008 E15 stored display sentences as `limitName`
 * ("Weekly — Fable"). The field now names only a model scope, so a saved
 * window is re-read in the current meaning rather than rendered verbatim.
 */
export function migratePersistedLimitName(window: PlanWindow): PlanWindow {
  if (window.limitId === 'claude-session' || window.limitId === 'claude-weekly-all') {
    return window.limitName === null ? window : { ...window, limitName: null };
  }
  const legacy = /^Weekly\s+\S\s+(.+)$/u.exec(window.limitName ?? '');
  return legacy ? { ...window, limitName: legacy[1] } : window;
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
          limitName: null,
          windowMinutes: SESSION_MINUTES,
        },
      ],
      [
        body.seven_day,
        {
          limitId: 'claude-weekly-all',
          limitName: null,
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
/* the service — the shared account-read life, with Claude's reader    */
/* ------------------------------------------------------------------ */

export type ClaudePlanAccountView = PlanAccountView;

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

/**
 * One read of the Claude account: Claude Code's own credential, read in
 * place, sent to `api.anthropic.com` only, never when expired, never
 * refreshed here. Null on any failure; the service turns that into absence.
 */
function claudePlanReader(options: {
  fetchFn: typeof fetch;
  readCredential: () => Promise<ClaudeOauthCredential | null>;
  now: () => number;
  timeoutMs: number;
}): PlanAccountReader {
  return async () => {
    const credential = await options.readCredential().catch(() => null);
    if (!credential) return null;
    // An expired token is never sent, and never refreshed here: Claude Code
    // owns that credential's lifecycle. Degrade to absence until it does.
    if (
      credential.expiresAtMs !== null &&
      credential.expiresAtMs <= options.now()
    ) {
      return null;
    }
    let payload: unknown;
    try {
      const response = await options.fetchFn(CLAUDE_USAGE_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'anthropic-beta': CLAUDE_OAUTH_BETA_HEADER,
          'Content-Type': 'application/json',
        },
        // The token must not follow a redirect off api.anthropic.com.
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) return null;
      payload = await response.json();
    } catch {
      return null;
    }
    const observedAt = new Date(options.now()).toISOString();
    const parsed = parseClaudeUsage(
      payload,
      observedAt,
      credential.subscriptionType
    );
    return {
      windows: parsed.windows,
      spend: parsed.spend,
      planType: credential.subscriptionType,
      rateLimitTier: credential.rateLimitTier,
    };
  };
}

export class ClaudePlanAccountService extends PlanAccountService {
  constructor(options: ClaudePlanAccountOptions) {
    const now = options.now ?? Date.now;
    super({
      source: 'claude-code',
      stateDir: options.stateDir,
      stateFileName: STATE_FILE,
      stateLabel: 'Claude plan history',
      enabled: options.enabled,
      remoteReadAllowed: options.remoteReadAllowed,
      read: claudePlanReader({
        fetchFn: options.fetchFn ?? fetch,
        readCredential: options.readCredential ?? readClaudeCredential,
        now,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
      migrateWindow: migratePersistedLimitName,
      now,
      minFetchIntervalMs: options.minFetchIntervalMs,
      jitterMs: options.jitterMs,
    });
  }
}
