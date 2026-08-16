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
 * subscribes to. Main keeps what is genuinely its own: the trusted local scan
 * (`operator-stats:scan`) and the persisted preference.
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
import type { OperatorStatsPublishPayload } from '@exawatt/core';
import {
  analyticsSurface,
  captureAnalyticsEvent,
  hostedFailureForStatus,
  type HostedFailure,
} from '@/lib/analytics';
import { createClient } from '@/lib/supabase/client';
import { isOperatorAutoPublishEnabled } from '@/lib/hosted-features/contract';

/** Well past startup so a sync never competes with launch work. */
export const OPERATOR_STATS_LAUNCH_SYNC_DELAY_MS = 2 * 60_000;
export const OPERATOR_STATS_SYNC_INTERVAL_MS = 6 * 60 * 60_000;

export type LocalOperatorStatsPreview = Pick<
  OperatorStatsPublishPayload,
  'schemaVersion' | 'consentVersion' | 'enabled' | 'timezone' | 'days' | 'runs'
>;

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

export type OperatorStatsSyncFailure =
  | 'local-scan'
  | 'local-state'
  | 'network'
  | 'unauthorized'
  | 'identity'
  | 'rejected'
  | 'service';

export interface OperatorProfilePublicationState {
  startedAt?: string;
  lastSyncedAt?: string;
  profileEnabled?: boolean;
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
  scan: (since: string, timezone: string) => Promise<LocalOperatorStatsPreview>;
  post: (
    body: string,
    accessToken: string
  ) => Promise<{ ok: boolean; status: number }>;
  captureFailure: (failure: HostedFailure, statusCode: number | null) => void;
  now: () => number;
  timezone: () => string;
}

function findGithub(identities: UserIdentity[] | null | undefined) {
  return identities?.find(identity => identity.provider === 'github') ?? null;
}

/** The exact upload the old publish action made — decision `0029`'s
 *  allowlisted aggregate plus the GitHub-seeded identity, nothing else. */
export function buildPublishBody(
  preview: LocalOperatorStatsPreview,
  github: UserIdentity
): string {
  const data = github.identity_data ?? {};
  const handle = String(data.user_name ?? data.preferred_username ?? '');
  return JSON.stringify({
    ...preview,
    identity: {
      provider: 'github',
      providerHandle: handle,
      handle: handle.toLowerCase(),
      displayName: String(data.full_name ?? data.name ?? handle),
      avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
      links: [`https://github.com/${handle}`],
    },
  });
}

/**
 * One sync attempt, gates first. Pure orchestration over injected deps so the
 * never-when-paused/signed-out/unlinked contract is unit-testable.
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

  let publication: OperatorProfilePublicationState;
  try {
    publication = await deps.getPublicationState();
  } catch {
    return { outcome: 'failed', snapshot: null, failure: 'local-state' };
  }

  let since = publication.startedAt ?? null;
  if (!since) {
    let hosted: Awaited<
      ReturnType<OperatorStatsSyncDeps['getHostedProfileState']>
    >;
    try {
      hosted = await deps.getHostedProfileState(session.access_token);
    } catch {
      deps.captureFailure('network', null);
      return { outcome: 'failed', snapshot: null, failure: 'network' };
    }
    if (!hosted.ok) {
      deps.captureFailure(hostedFailureForStatus(hosted.status), hosted.status);
      return {
        outcome: 'failed',
        snapshot: null,
        failure: syncFailureForStatus(hosted.status),
      };
    }
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
    } catch {
      return { outcome: 'failed', snapshot: null, failure: 'local-state' };
    }
  }

  let preview: LocalOperatorStatsPreview;
  try {
    preview = await deps.scan(since, deps.timezone());
  } catch {
    // A local read failure is not a hosted call; nothing to count.
    return { outcome: 'failed', snapshot: null, failure: 'local-scan' };
  }

  // The switch may have flipped during the scan. Once it is off, nothing
  // leaves — re-check at the last moment before the only network write.
  if (!(await deps.isAutoPublishEnabled())) {
    return { outcome: 'paused', snapshot: null, failure: null };
  }

  try {
    const response = await deps.post(
      buildPublishBody(preview, github),
      session.access_token
    );
    if (!response.ok) {
      deps.captureFailure(
        hostedFailureForStatus(response.status),
        response.status
      );
      return {
        outcome: 'failed',
        snapshot: null,
        failure: syncFailureForStatus(response.status),
      };
    }
  } catch {
    deps.captureFailure('network', null);
    return { outcome: 'failed', snapshot: null, failure: 'network' };
  }

  const syncedAt = deps.now();
  try {
    await deps.recordPublicationState({
      startedAt: since,
      lastSyncedAt: new Date(syncedAt).toISOString(),
      profileEnabled: true,
    });
  } catch {
    // Hosted truth already advanced. Keep the successful outcome honest and
    // let the next sync rehydrate the local cache from the owner-only GET.
  }
  return {
    outcome: 'synced',
    failure: null,
    snapshot: {
      runs: preview.runs.length,
      agentMs: preview.days.reduce((sum, day) => sum + day.agentMs, 0),
      normalizedTokens: preview.days.reduce(
        (sum, day) => sum + day.normalizedTokens,
        0
      ),
    },
  };
}

function syncFailureForStatus(status: number): OperatorStatsSyncFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 409) return 'identity';
  if (status >= 400 && status < 500) return 'rejected';
  return 'service';
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

export function hydrateOperatorStatsSyncState(
  publication: OperatorProfilePublicationState | undefined
): void {
  const parsed = publication?.lastSyncedAt
    ? Date.parse(publication.lastSyncedAt)
    : NaN;
  if (Number.isFinite(parsed) && parsed !== state.lastSyncedAt) {
    setState({ lastSyncedAt: parsed });
  }
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
  const scanApi = window.electron?.operatorStats;
  if (!scanApi) return null;
  const settingsBridge = window.electron?.settings;
  let supabase: ReturnType<typeof createClient> | null;
  try {
    supabase = createClient();
  } catch {
    supabase = null;
  }
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
      const response = await fetch('/api/operator-stats', {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        return { ok: false, status: response.status, profile: null };
      }
      const body = (await response.json()) as {
        profile?: HostedOperatorProfileState | null;
      };
      return {
        ok: true,
        status: response.status,
        profile: body.profile ?? null,
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
    scan: (since, timezone) => scanApi.scan(since, timezone),
    post: async (body, accessToken) => {
      const response = await fetch('/api/operator-stats', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body,
      });
      return { ok: response.ok, status: response.status };
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
