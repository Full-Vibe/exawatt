/**
 * ENG-035 — automatic public-profile sync, governed by one durable preference.
 *
 * Publishing used to be a two-step ritual (preview, then publish) on every
 * sync. The operator's 2026-08-10 direction: "I don't want to preview local
 * stats as a user. Just auto-publish or pause publishing, based on a
 * preference switch." The preference is `operatorProfile.autoPublish` in the
 * Electron settings store — default OFF, and turning it on is the decision
 * `0029` consent act.
 *
 * THE RENDERER OWNS THE SCHEDULE, deliberately. Everything a sync needs lives
 * here and nowhere else: the Supabase session (Electron main has none of its
 * own), the server-verified GitHub identity, the authenticated POST to
 * `/api/operator-stats`, and the allowlisted analytics path (decision `0034`:
 * main never talks to an analytics host). A main-side timer could only ever
 * nudge the renderer to do all of that anyway, over a new IPC channel carrying
 * no information this module cannot read from the settings bridge it already
 * subscribes to. Main keeps what is genuinely its own: the trusted local
 * plan (`operator-stats:plan`), the durable publication record and its
 * diagnostics line (`operator-stats:record`), and the persisted preference.
 *
 * The hard rule, enforced structurally: NO upload may happen while the switch
 * is off or absent. Every trigger — launch delay, interval, flip-on, the
 * panel's Sync now — funnels through one coalesced executor that re-reads the
 * preference at execution time and returns before any network or scan work
 * when it is off. A paused, signed-out, or unlinked state performs no hosted
 * call and therefore never emits `hosted_call_failed`; only a genuine
 * attempt-and-fail does (service `operator_stats`).
 */

import type { Session, UserIdentity } from '@supabase/supabase-js';
import type {
  OperatorStatsPublication,
  OperatorStatsPublicationCursor,
  OperatorStatsPublicationPlan,
  OperatorStatsPublishPayload,
  OperatorStatsSyncEvent,
  OperatorStatsSyncFailure,
  OperatorStatsSyncFailureRecord,
} from '@exawatt/core';
import { isTerminalSyncFailure } from '@exawatt/core';
import {
  getOperatorStatsProfile,
  isCompatibleServiceProblemError,
  isCompatibleServiceProtocolError,
  publishOperatorStats,
} from '@exawatt/core/distribution';
import {
  analyticsSurface,
  captureAnalyticsEvent,
  hostedFailureForStatus,
  type HostedFailure,
} from '@/lib/analytics';
import { createOptionalClient } from '@/lib/supabase/client';
import { isOperatorAutoPublishEnabled } from '@/lib/hosted-features/contract';
import { resolvedDistribution } from '@/lib/distribution/resolved';

export type { OperatorStatsSyncFailure } from '@exawatt/core';

/** Well past startup so a sync never competes with launch work. */
export const OPERATOR_STATS_LAUNCH_SYNC_DELAY_MS = 2 * 60_000;
export const OPERATOR_STATS_SYNC_INTERVAL_MS = 6 * 60 * 60_000;

export type OperatorStatsSyncOutcome =
  /** The switch is off or absent. Nothing was read and nothing left. */
  | 'paused'
  /** No Exawatt session; publishing waits for sign-in. */
  | 'signed-out'
  /** No GitHub identity on the account; nothing is attempted without one. */
  | 'unlinked'
  /** Not the desktop app — there is no local source to scan. */
  | 'unavailable'
  | 'synced'
  | 'failed';

export interface OperatorProfilePublicationState {
  startedAt?: string;
  lastSyncedAt?: string;
  profileEnabled?: boolean;
  publishedThrough?: string;
  publishedDerivation?: number;
  lastFailure?: OperatorStatsSyncFailureRecord;
}

export interface HostedOperatorProfileState {
  enabled: boolean;
  startedAt: string;
  lastSyncedAt: string;
}

export interface OperatorStatsSyncSnapshot {
  runs: number;
  agentMs: number;
  normalizedTokens: number;
}

export interface OperatorStatsSyncResult {
  outcome: OperatorStatsSyncOutcome;
  snapshot: OperatorStatsSyncSnapshot | null;
  failure: OperatorStatsSyncFailure | null;
}

export interface OperatorStatsPlanRequest {
  since: string;
  timezone: string;
  cursor: OperatorStatsPublicationCursor | null;
}

export interface OperatorStatsSyncDeps {
  isAutoPublishEnabled: () => Promise<boolean>;
  getSession: () => Promise<Session | null>;
  getGithubIdentity: () => Promise<UserIdentity | null>;
  getPublicationState: () => Promise<OperatorProfilePublicationState>;
  getHostedProfileState: (accessToken: string) => Promise<{
    ok: boolean;
    status: number;
    profile: HostedOperatorProfileState | null;
  }>;
  recordPublicationState: (
    state: OperatorProfilePublicationState
  ) => Promise<void>;
  plan: (
    request: OperatorStatsPlanRequest
  ) => Promise<OperatorStatsPublicationPlan>;
  post: (
    body: string,
    accessToken: string
  ) => Promise<{ ok: boolean; status: number }>;
  /** Folds one step into the durable record (and main's diagnostics log). */
  recordSync: (event: OperatorStatsSyncEvent) => Promise<void>;
  captureFailure: (failure: HostedFailure, statusCode: number | null) => void;
  now: () => number;
  timezone: () => string;
}

function findGithub(identities: UserIdentity[] | null | undefined) {
  return identities?.find(identity => identity.provider === 'github') ?? null;
}

/** One publication as it is sent — decision `0029`'s allowlisted aggregate
 *  for the dates it covers, plus the GitHub-seeded identity, nothing else. */
export function buildPublishBody(
  publication: OperatorStatsPublication,
  github: UserIdentity
): string {
  const data = github.identity_data ?? {};
  const handle = String(data.user_name ?? data.preferred_username ?? '');
  const payload: OperatorStatsPublishPayload = {
    ...publication,
    identity: {
      provider: 'github',
      providerHandle: handle,
      handle: handle.toLowerCase(),
      displayName: String(data.full_name ?? data.name ?? handle),
      avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
      links: [`https://github.com/${handle}`],
    },
  };
  return JSON.stringify(payload);
}

interface SyncFailure {
  failure: OperatorStatsSyncFailure;
  retryable: boolean;
  status: number | null;
  code: string | null;
  detail: string | null;
}

function syncFailureForStatus(status: number): OperatorStatsSyncFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 409) return 'identity';
  if (status >= 400 && status < 500) return 'rejected';
  return 'service';
}

/** Classifies a hosted call that threw, and counts it (decision `0034`). */
function hostedFailure(
  cause: unknown,
  deps: OperatorStatsSyncDeps
): SyncFailure {
  if (isCompatibleServiceProblemError(cause)) {
    deps.captureFailure(hostedFailureForStatus(cause.status), cause.status);
    return {
      failure: syncFailureForStatus(cause.status),
      retryable: cause.retryable,
      status: cause.status,
      code: cause.code,
      detail: cause.problem.detail ?? null,
    };
  }
  const protocolFailure = isCompatibleServiceProtocolError(cause);
  deps.captureFailure(protocolFailure ? 'invalid_response' : 'network', null);
  return {
    failure: protocolFailure ? 'service' : 'network',
    retryable: !protocolFailure,
    status: null,
    code: null,
    detail: null,
  };
}

function statusFailure(status: number, deps: OperatorStatsSyncDeps) {
  deps.captureFailure(hostedFailureForStatus(status), status);
  const failure = syncFailureForStatus(status);
  return {
    failure,
    retryable: !isTerminalSyncFailure(failure),
    status,
    code: null,
    detail: null,
  } satisfies SyncFailure;
}

function detailOf(cause: unknown): string | null {
  return cause instanceof Error ? cause.message.slice(0, 300) : null;
}

/**
 * One sync attempt, gates first. Pure orchestration over injected deps so the
 * never-when-paused/signed-out/unlinked contract is unit-testable.
 *
 * Main plans; this sends. The plan is a sequence of publications that each
 * fit the hosted contract and each replace only the dates they cover
 * (BUG-164), sent oldest first. Every publication that lands moves the
 * durable cursor, so an interrupted backlog resumes instead of restarting;
 * every failure is recorded durably and in main's diagnostics log, so a
 * profile that stops updating says why.
 */
export async function performOperatorStatsSync(
  deps: OperatorStatsSyncDeps
): Promise<OperatorStatsSyncResult> {
  if (!(await deps.isAutoPublishEnabled())) {
    return { outcome: 'paused', snapshot: null, failure: null };
  }
  const session = await deps.getSession();
  if (!session) return { outcome: 'signed-out', snapshot: null, failure: null };
  const github = await deps.getGithubIdentity();
  if (!github) return { outcome: 'unlinked', snapshot: null, failure: null };

  const failed = async (
    failure: SyncFailure
  ): Promise<OperatorStatsSyncResult> => {
    try {
      await deps.recordSync({
        kind: 'failed',
        at: new Date(deps.now()).toISOString(),
        ...failure,
      });
    } catch {
      // The record is the status line's memory, not the sync's outcome.
    }
    return { outcome: 'failed', snapshot: null, failure: failure.failure };
  };

  let publication: OperatorProfilePublicationState;
  try {
    publication = await deps.getPublicationState();
  } catch (cause) {
    return failed({
      failure: 'local-state',
      retryable: true,
      status: null,
      code: null,
      detail: detailOf(cause),
    });
  }

  let since = publication.startedAt ?? null;
  if (!since) {
    let hosted: Awaited<
      ReturnType<OperatorStatsSyncDeps['getHostedProfileState']>
    >;
    try {
      hosted = await deps.getHostedProfileState(session.access_token);
    } catch (cause) {
      return failed(hostedFailure(cause, deps));
    }
    if (!hosted.ok) return failed(statusFailure(hosted.status, deps));
    // Existing profiles prove an earlier consent boundary. New profiles start
    // exactly now. Persist before scanning so a renderer-port change can never
    // move this anchor or silently backfill pre-consent history.
    since = hosted.profile?.startedAt ?? new Date(deps.now()).toISOString();
    try {
      await deps.recordPublicationState({
        startedAt: since,
        ...(hosted.profile
          ? {
              lastSyncedAt: hosted.profile.lastSyncedAt,
              profileEnabled: hosted.profile.enabled,
            }
          : { profileEnabled: false }),
      });
    } catch (cause) {
      return failed({
        failure: 'local-state',
        retryable: true,
        status: null,
        code: null,
        detail: detailOf(cause),
      });
    }
  }

  const cursor =
    publication.publishedThrough && publication.publishedDerivation
      ? {
          publishedThrough: publication.publishedThrough,
          derivation: publication.publishedDerivation,
        }
      : null;
  let plan: OperatorStatsPublicationPlan;
  try {
    plan = await deps.plan({ since, timezone: deps.timezone(), cursor });
  } catch (cause) {
    // A local read failure is not a hosted call; nothing to count. A planner
    // that produced something the contract refuses is a defect, not a
    // transient: it says so instead of promising a retry.
    const contract = /OperatorStatsContractError/.test(String(cause));
    return failed({
      failure: contract ? 'local-contract' : 'local-scan',
      retryable: !contract,
      status: null,
      code: null,
      detail: detailOf(cause),
    });
  }

  const last = plan.publications.length - 1;
  for (const [index, next] of plan.publications.entries()) {
    // The switch may have flipped while planning or sending. Once it is off,
    // nothing more leaves — re-check before every network write.
    if (!(await deps.isAutoPublishEnabled())) {
      return { outcome: 'paused', snapshot: null, failure: null };
    }
    try {
      const response = await deps.post(
        buildPublishBody(next, github),
        session.access_token
      );
      if (!response.ok) return failed(statusFailure(response.status, deps));
    } catch (cause) {
      return failed(hostedFailure(cause, deps));
    }
    try {
      await deps.recordSync({
        kind: 'published',
        at: new Date(deps.now()).toISOString(),
        coverage: next.coverage,
        ...(index === last ? { derivation: plan.derivation } : {}),
      });
    } catch {
      // Hosted truth already advanced. A lost cursor only means the next sync
      // republishes these dates, which replaces them with the same rows.
    }
  }

  return {
    outcome: 'synced',
    failure: null,
    snapshot: { ...plan.totals },
  };
}

/* ------------------------------------------------------------------ *
 * Live status — one store so the panel renders exactly what the
 * executor is doing, whoever triggered it.
 * ------------------------------------------------------------------ */

export interface OperatorStatsSyncState {
  phase: 'idle' | 'syncing';
  lastOutcome: OperatorStatsSyncOutcome | null;
  lastFailure: OperatorStatsSyncFailure | null;
  /** Epoch ms of the last successful sync from this device, persisted. */
  lastSyncedAt: number | null;
  lastSnapshot: OperatorStatsSyncSnapshot | null;
}

let state: OperatorStatsSyncState = {
  phase: 'idle',
  lastOutcome: null,
  lastFailure: null,
  lastSyncedAt: null,
  lastSnapshot: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<OperatorStatsSyncState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function readOperatorStatsSyncState(): OperatorStatsSyncState {
  return state;
}

/**
 * Adopts the durable publication record. Main writes it after every attempt
 * that got past the gates, so it is the latest truth about publishing even
 * across relaunches: a profile that stopped updating last week still says so
 * on today's first render, instead of reading as quietly up to date.
 */
export function hydrateOperatorStatsSyncState(
  publication: OperatorProfilePublicationState | undefined
): void {
  const parsed = publication?.lastSyncedAt
    ? Date.parse(publication.lastSyncedAt)
    : NaN;
  const lastSyncedAt = Number.isFinite(parsed) ? parsed : state.lastSyncedAt;
  const patch: Partial<OperatorStatsSyncState> = {};
  if (lastSyncedAt !== state.lastSyncedAt) patch.lastSyncedAt = lastSyncedAt;
  if (publication?.lastFailure) {
    if (
      state.lastOutcome !== 'failed' ||
      state.lastFailure !== publication.lastFailure.failure
    ) {
      patch.lastOutcome = 'failed';
      patch.lastFailure = publication.lastFailure.failure;
    }
  } else if (state.lastOutcome === 'failed' && Number.isFinite(parsed)) {
    // A later success anywhere cleared the durable failure.
    patch.lastOutcome = 'synced';
    patch.lastFailure = null;
  }
  if (Object.keys(patch).length > 0) setState(patch);
}

export function subscribeOperatorStatsSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------------ *
 * The real executor — coalesced so overlapping triggers (launch timer,
 * interval, flip-on, Sync now) can never double-post.
 * ------------------------------------------------------------------ */

function defaultDeps(): OperatorStatsSyncDeps | null {
  const distribution = resolvedDistribution();
  const endpoint = distribution.services.operatorStats;
  // Service absence is checked before the desktop bridge, settings, account
  // session, local scan, or fetch. Community is a true no-op, not signed out.
  if (!endpoint) return null;
  const localApi = window.electron?.operatorStats;
  if (!localApi) return null;
  const settingsBridge = window.electron?.settings;
  const supabase = createOptionalClient(distribution);
  return {
    isAutoPublishEnabled: async () => {
      if (!settingsBridge) return false;
      try {
        return isOperatorAutoPublishEnabled(await settingsBridge.get());
      } catch {
        // An unreadable preference is not consent.
        return false;
      }
    },
    getSession: async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
    getGithubIdentity: async () => {
      if (!supabase) return null;
      // Server truth, not the session's snapshot — a stale snapshot is what
      // made a completed link look unfinished (see publish-panel.tsx).
      const { data } = await supabase.auth.getUserIdentities();
      return findGithub(data?.identities);
    },
    getPublicationState: async () => {
      if (!settingsBridge) return {};
      const settings = await settingsBridge.get();
      return settings.operatorProfile ?? {};
    },
    getHostedProfileState: async accessToken => {
      const body = await getOperatorStatsProfile(endpoint, accessToken);
      return {
        ok: true,
        status: 200,
        profile: body.profile,
      };
    },
    recordPublicationState: async publication => {
      if (!settingsBridge?.recordOperatorProfileState) {
        throw new Error('Operator profile state is unavailable');
      }
      const settings =
        await settingsBridge.recordOperatorProfileState(publication);
      hydrateOperatorStatsSyncState(settings.operatorProfile);
    },
    plan: request => localApi.plan(request),
    post: async (body, accessToken) => {
      await publishOperatorStats(
        endpoint,
        accessToken,
        JSON.parse(body) as OperatorStatsPublishPayload
      );
      return { ok: true, status: 200 };
    },
    recordSync: async event => {
      const settings = await localApi.record(event);
      hydrateOperatorStatsSyncState(settings.operatorProfile);
    },
    captureFailure: (failure, statusCode) => {
      captureAnalyticsEvent({
        name: 'hosted_call_failed',
        surface: analyticsSurface(),
        service: 'operator_stats',
        failure,
        statusCode,
      });
    },
    now: Date.now,
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

let inFlight: Promise<OperatorStatsSyncResult> | null = null;

/**
 * Trigger a sync (or join the one already running). Safe to call from
 * anywhere; every gate lives inside.
 */
export function runOperatorStatsSync(): Promise<OperatorStatsSyncResult> {
  if (inFlight) return inFlight;
  if (typeof window === 'undefined') {
    return Promise.resolve({
      outcome: 'unavailable',
      snapshot: null,
      failure: null,
    });
  }
  const deps = defaultDeps();
  if (!deps) {
    return Promise.resolve({
      outcome: 'unavailable',
      snapshot: null,
      failure: null,
    });
  }
  setState({ phase: 'syncing' });
  inFlight = performOperatorStatsSync(deps)
    .catch(
      (): OperatorStatsSyncResult => ({
        outcome: 'failed',
        snapshot: null,
        failure: 'service',
      })
    )
    .then(result => {
      setState({
        phase: 'idle',
        lastOutcome: result.outcome,
        lastFailure: result.failure,
        ...(result.outcome === 'synced'
          ? { lastSyncedAt: Date.now(), lastSnapshot: result.snapshot }
          : {}),
      });
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The schedule: one delayed launch sync, then a long interval, plus a sync the
 * moment the preference flips on anywhere (leaderboard panel or Settings →
 * Privacy — both write the same preference through the same bridge). Returns
 * a stop function, or null when this surface has no local source (web).
 */
export function startOperatorStatsAutoSync(
  run: () => Promise<OperatorStatsSyncResult> = runOperatorStatsSync
): (() => void) | null {
  if (typeof window === 'undefined') return null;
  if (!resolvedDistribution().services.operatorStats) return null;
  const settingsBridge = window.electron?.settings;
  if (!window.electron?.operatorStats || !settingsBridge) return null;

  const launchTimer = window.setTimeout(
    () => void run(),
    OPERATOR_STATS_LAUNCH_SYNC_DELAY_MS
  );
  const interval = window.setInterval(
    () => void run(),
    OPERATOR_STATS_SYNC_INTERVAL_MS
  );

  let last: boolean | null = null;
  void settingsBridge.get().then(
    settings => {
      hydrateOperatorStatsSyncState(settings.operatorProfile);
      if (last === null) last = isOperatorAutoPublishEnabled(settings);
    },
    () => undefined
  );
  const offChanged = settingsBridge.onChanged(settings => {
    hydrateOperatorStatsSyncState(settings.operatorProfile);
    const next = isOperatorAutoPublishEnabled(settings);
    // Only the off→on transition triggers: enabling is the moment the
    // operator expects the profile to appear or refresh. Turning it off
    // schedules nothing — paused means paused.
    if (last === false && next) void run();
    last = next;
  });

  return () => {
    window.clearTimeout(launchTimer);
    window.clearInterval(interval);
    offChanged?.();
  };
}

/** Test seam: forget status and coalescing between suites. */
export function __resetOperatorStatsSyncForTests(): void {
  inFlight = null;
  state = {
    phase: 'idle',
    lastOutcome: null,
    lastFailure: null,
    lastSyncedAt: null,
    lastSnapshot: null,
  };
  listeners.clear();
}
