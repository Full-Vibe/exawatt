/**
 * ENG-038 slice 2 — the Codex plan-account read.
 *
 * Codex writes its rate limits into rollout logs, which the local scanner
 * already reads, but only when a Codex turn runs: after the operator spent a
 * banked reset on 2026-09-29 the logs still said 78% while the account said
 * 45%, for hours. The account also holds what no log carries: the banked
 * "Full reset" credits with their expiry, and the prepaid credit balance.
 *
 * Codex's own app-server answers `account/rateLimits/read` with all of it
 * (verified live against a Pro account, codex-cli 0.158.0). The request
 * leaves through the operator's own `codex` binary and sign-in, so custody is
 * SOURCE-OWNED, like the re-entry recap: Exawatt never reads
 * `~/.codex/auth.json`, holds no token, and makes no network call itself.
 * That is also why no distribution capability gates it (BUG-060 gates reads
 * that leave through Exawatt's own network identity).
 *
 * Windows enter the snapshot with `origin: 'provider-account'` under the same
 * bucket keys the local scanner uses (`codex|codex|primary|10080`), so the
 * fresher of the two readings wins per bucket and the pace history is one
 * series.
 */
import type {
  PlanAccountFailureCause,
  PlanCreditBalance,
  PlanResetCredit,
  PlanResets,
  PlanWindow,
} from '@exawatt/core';
import {
  CodexAppServerClient,
  isPermanentVerdict,
} from '../harness-events/codex-app-server';
import {
  PlanAccountService,
  type PlanAccountRead,
  type PlanAccountReader,
  type PlanAccountReadFailure,
} from './plan-account-service';

const STATE_FILE = 'codex-plan.json';

type Json = Record<string, unknown>;

const record = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const isoFromSeconds = (value: unknown): string | null => {
  const seconds = finite(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
};

function windowsOf(snapshot: Json, observedAt: string): PlanWindow[] {
  const planType = text(snapshot.planType);
  const limitId = text(snapshot.limitId);
  const limitName = text(snapshot.limitName);
  const out: PlanWindow[] = [];
  for (const scope of ['primary', 'secondary'] as const) {
    const window = record(snapshot[scope]);
    if (!window) continue;
    const usedPercent = finite(window.usedPercent);
    const windowMinutes = finite(window.windowDurationMins);
    // A window with no length has no denominator; absence over a guess.
    if (usedPercent === null || windowMinutes === null || windowMinutes <= 0) {
      continue;
    }
    out.push({
      source: 'codex',
      limitId,
      limitName,
      scope,
      usedPercent,
      windowMinutes: Math.trunc(windowMinutes),
      resetsAt: isoFromSeconds(window.resetsAt),
      planType,
      observedAt,
      providerSessionId: '',
      origin: 'provider-account',
    });
  }
  return out;
}

function resetsOf(value: unknown): PlanResets | undefined {
  const summary = record(value);
  const available = finite(summary?.availableCount);
  if (!summary || available === null) return undefined;
  const rows = Array.isArray(summary.credits) ? summary.credits : null;
  const credits: PlanResetCredit[] | null = rows
    ? rows
        .map(record)
        .filter((row): row is Json => row !== null && row.status === 'available')
        .map(row => ({
          title: text(row.title),
          expiresAt: isoFromSeconds(row.expiresAt),
          grantedAt: isoFromSeconds(row.grantedAt),
        }))
        .sort(
          (a, b) =>
            (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) -
            (b.expiresAt ? Date.parse(b.expiresAt) : Infinity)
        )
    : null;
  return { available: Math.max(0, Math.trunc(available)), credits };
}

function creditsOf(snapshot: Json | null | undefined): PlanCreditBalance | undefined {
  const credits = record(snapshot?.credits);
  if (!credits) return undefined;
  const balance = text(credits.balance);
  const parsed = balance === null ? null : Number(balance);
  return {
    balance: parsed === null || !Number.isFinite(parsed) ? null : parsed,
    unlimited: credits.unlimited === true,
  };
}

/**
 * `account/rateLimits/read` result -> the account read. Pure and throw-free:
 * anything unrecognizable contributes nothing, and a result with no window
 * and no reset summary is null (absence), never an empty account.
 */
export function parseCodexAccountRateLimits(
  result: unknown,
  observedAt: string
): PlanAccountRead | null {
  const body = record(result);
  if (!body) return null;
  const primary = record(body.rateLimits);
  const byId = record(body.rateLimitsByLimitId);
  const snapshots = byId
    ? Object.values(byId).map(record).filter((s): s is Json => s !== null)
    : primary
      ? [primary]
      : [];
  const windows = snapshots.flatMap(s => windowsOf(s, observedAt));
  const resets = resetsOf(body.rateLimitResetCredits);
  if (windows.length === 0 && !resets) return null;
  // The balance is account-wide; read it from whichever snapshot carries it.
  const credits =
    creditsOf(primary) ?? snapshots.map(creditsOf).find(c => c !== undefined);
  return {
    windows,
    planType: text(primary?.planType) ?? text(snapshots[0]?.planType),
    spend: null,
    ...(resets ? { resets } : {}),
    ...(credits ? { credits } : {}),
  };
}

/** Why one app-server read failed, in the account card's vocabulary. */
function codexFailureCause(error: unknown): PlanAccountFailureCause {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/iu.test(message)) return 'timed-out';
  // A login shell that cannot find `codex` exits 127.
  if (/exited \(127\)|command not found|ENOENT/iu.test(message)) {
    return 'not-installed';
  }
  return 'exited';
}

/** The production reader: a short-lived read-side app-server per read. */
function codexPlanReader(options: {
  readRateLimits?: () => Promise<unknown>;
  now: () => number;
}): PlanAccountReader {
  const readRateLimits =
    options.readRateLimits ??
    (async () => {
      const client = new CodexAppServerClient();
      try {
        await client.connect();
        return await client.accountRateLimits();
      } finally {
        client.close();
      }
    });
  // A permanent verdict (an app-server too old to speak the protocol) holds
  // for this launch, the way the delegation observer remembers it (BUG-146):
  // asking again every five minutes would only spawn the same refusal.
  let verdict: PlanAccountReadFailure | null = null;
  return async () => {
    if (verdict) return verdict;
    let result: unknown;
    try {
      result = await readRateLimits();
    } catch (error) {
      if (isPermanentVerdict(error)) {
        verdict = { failure: 'unrecognized' };
        return verdict;
      }
      return { failure: codexFailureCause(error) };
    }
    return parseCodexAccountRateLimits(
      result,
      new Date(options.now()).toISOString()
    );
  };
}

interface CodexPlanAccountOptions {
  stateDir: string;
  enabled: boolean;
  /** False in automated test launches: no Settings write can start it. */
  allowed?: boolean;
  /** The app-server call; injectable so tests replay a recorded answer. */
  readRateLimits?: () => Promise<unknown>;
  now?: () => number;
  minFetchIntervalMs?: number;
  jitterMs?: number;
}

export class CodexPlanAccountService extends PlanAccountService {
  constructor(options: CodexPlanAccountOptions) {
    const now = options.now ?? Date.now;
    super({
      source: 'codex',
      stateDir: options.stateDir,
      stateFileName: STATE_FILE,
      stateLabel: 'Codex plan history',
      enabled: options.enabled,
      allowed: options.allowed,
      read: codexPlanReader({ readRateLimits: options.readRateLimits, now }),
      now,
      minFetchIntervalMs: options.minFetchIntervalMs,
      jitterMs: options.jitterMs,
    });
  }
}
