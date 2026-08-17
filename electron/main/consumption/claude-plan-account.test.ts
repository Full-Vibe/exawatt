/**
 * ENG-038 slice 1 — the Claude plan-account read.
 *
 * Two families of pins:
 * - the adapter: the real endpoint shape (fixture below mirrors a live
 *   2026-08-11 response), the legacy fallback, and schema drift → absence;
 * - the custody invariants: an expired token is never sent, the token never
 *   reaches persisted state or the served view, failures degrade to absence
 *   (never an error state, never a stale figure presented as fresh — the
 *   old `observedAt` is preserved for the freshness rule to judge).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planWindowKey } from '@exawatt/core';
import {
  CLAUDE_USAGE_ENDPOINT,
  ClaudePlanAccountService,
  isClaudePlanRemoteReadAllowed,
  parseClaudeUsage,
  readClaudeCredential,
  type ClaudeOauthCredential,
} from './claude-plan-account';
import { ProviderPlanCompositeSource } from './provider-plan-composite';
import type { ConsumptionScannerLike } from '../consumption-ipc';
import {
  emptyLiveConsumptionSnapshot,
  type ConsumptionUpdatedEvent,
  type LiveConsumptionSnapshot,
} from '@exawatt/core';

const FAKE_TOKEN = 'sk-ant-oat01-FIXTURE-NEVER-A-REAL-TOKEN';

/** Mirrors the live `/api/oauth/usage` response shape observed 2026-08-11. */
const USAGE_RESPONSE = {
  five_hour: { utilization: 16.0, resets_at: '2026-08-11T22:39:59.709988+00:00' },
  seven_day: { utilization: 38.0, resets_at: '2026-08-17T08:59:59.710005+00:00' },
  seven_day_opus: null,
  // Experiment codenames the endpoint carries and churns; never parsed.
  tangelo: null,
  nimbus_quill: { utilization: 0.0, resets_at: null },
  extra_usage: {
    is_enabled: false,
    monthly_limit: 20000,
    used_credits: 20160.0,
    utilization: 100.0,
    currency: 'USD',
    decimal_places: 2,
  },
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 16,
      severity: 'normal',
      resets_at: '2026-08-11T22:39:59.709988+00:00',
      scope: null,
      is_active: false,
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 38,
      severity: 'normal',
      resets_at: '2026-08-17T08:59:59.710005+00:00',
      scope: null,
      is_active: false,
    },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 68,
      severity: 'normal',
      resets_at: '2026-08-17T08:59:59.710162+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      is_active: true,
    },
  ],
  spend: {
    used: { amount_minor: 20160, currency: 'USD', exponent: 2 },
    limit: { amount_minor: 20000, currency: 'USD', exponent: 2 },
    percent: 100,
    severity: 'critical',
    enabled: false,
  },
} as const;

const OBSERVED_AT = '2026-08-11T21:00:00.000Z';

describe('Claude plan runtime network boundary', () => {
  it('allows installed builds and keeps routine unpackaged launches local', () => {
    expect(isClaudePlanRemoteReadAllowed({ packaged: true })).toBe(true);
    expect(isClaudePlanRemoteReadAllowed({ packaged: false })).toBe(false);
    expect(isClaudePlanRemoteReadAllowed({
      packaged: true,
      testMode: true,
    })).toBe(false);
    expect(isClaudePlanRemoteReadAllowed({
      packaged: false,
      testMode: true,
      developmentOptIn: '1',
    })).toBe(true);
    expect(isClaudePlanRemoteReadAllowed({
      packaged: false,
      developmentOptIn: 'true',
    })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* adapter                                                             */
/* ------------------------------------------------------------------ */

describe('parseClaudeUsage', () => {
  it('maps the self-describing limits[] array to three distinct plan windows', () => {
    const parsed = parseClaudeUsage(USAGE_RESPONSE, OBSERVED_AT, 'max');
    expect(parsed.windows).toHaveLength(3);
    const byId = new Map(parsed.windows.map(w => [w.limitId, w]));

    const session = byId.get('claude-session');
    expect(session).toMatchObject({
      source: 'claude-code',
      limitName: 'Current session',
      usedPercent: 16,
      windowMinutes: 300,
      resetsAt: '2026-08-11T22:39:59.709988+00:00',
      planType: 'max',
      origin: 'provider-account',
      providerSessionId: '',
      observedAt: OBSERVED_AT,
    });

    expect(byId.get('claude-weekly-all')).toMatchObject({
      limitName: 'Weekly — all models',
      usedPercent: 38,
      windowMinutes: 10080,
    });
    expect(byId.get('claude-weekly-fable')).toMatchObject({
      limitName: 'Weekly — Fable',
      usedPercent: 68,
      windowMinutes: 10080,
    });
  });

  it('gives every window a distinct bucket key (the plan-window bucket rule)', () => {
    const parsed = parseClaudeUsage(USAGE_RESPONSE, OBSERVED_AT, 'max');
    const keys = new Set(parsed.windows.map(planWindowKey));
    expect(keys.size).toBe(3);
  });

  it('captures the usage-credit spend (the spend-class dimension) without UI', () => {
    const parsed = parseClaudeUsage(USAGE_RESPONSE, OBSERVED_AT, 'max');
    expect(parsed.spend).toEqual({
      usedMinor: 20160,
      limitMinor: 20000,
      currency: 'USD',
      exponent: 2,
      percent: 100,
      enabled: false,
    });
  });

  it('falls back to extra_usage when the spend block is absent', () => {
    const { spend, ...rest } = USAGE_RESPONSE;
    const parsed = parseClaudeUsage(rest, OBSERVED_AT, 'max');
    expect(parsed.spend).toMatchObject({ usedMinor: 20160, limitMinor: 20000 });
  });

  it('falls back to the legacy five_hour/seven_day buckets when limits[] is absent', () => {
    const parsed = parseClaudeUsage(
      {
        five_hour: { utilization: 12.5, resets_at: OBSERVED_AT },
        seven_day: { utilization: 44, resets_at: OBSERVED_AT },
      },
      OBSERVED_AT,
      null
    );
    expect(parsed.windows.map(w => w.limitId).sort()).toEqual([
      'claude-session',
      'claude-weekly-all',
    ]);
    expect(parsed.windows.every(w => w.origin === 'provider-account')).toBe(true);
  });

  it('never parses the churning experiment codename buckets', () => {
    const parsed = parseClaudeUsage(
      { nimbus_quill: { utilization: 55, resets_at: OBSERVED_AT } },
      OBSERVED_AT,
      null
    );
    expect(parsed.windows).toEqual([]);
  });

  it('drifted or empty schema parses to absence, never a throw', () => {
    for (const drift of [null, 42, 'nope', {}, { limits: 'wat' }, { limits: [{}] }]) {
      const parsed = parseClaudeUsage(drift, OBSERVED_AT, null);
      expect(parsed.windows).toEqual([]);
    }
  });

  it('skips rows with an unknown window length instead of guessing a denominator', () => {
    const parsed = parseClaudeUsage(
      {
        limits: [
          { kind: 'monthly_mystery', group: 'monthly', percent: 10, resets_at: OBSERVED_AT },
          { kind: 'session', group: 'session', percent: 5, resets_at: OBSERVED_AT },
        ],
      },
      OBSERVED_AT,
      null
    );
    expect(parsed.windows.map(w => w.limitId)).toEqual(['claude-session']);
  });
});

describe('readClaudeCredential', () => {
  const keychainPayload = JSON.stringify({
    claudeAiOauth: {
      accessToken: FAKE_TOKEN,
      refreshToken: 'sk-ant-ort01-FIXTURE',
      expiresAt: 1786489274838,
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_20x',
    },
  });

  it('reads the token, expiry, and plan identity from the Keychain payload', async () => {
    const credential = await readClaudeCredential(async () => keychainPayload);
    expect(credential).toEqual({
      accessToken: FAKE_TOKEN,
      expiresAtMs: 1786489274838,
      subscriptionType: 'max',
    });
  });

  it('returns null on a failed read, non-JSON, or a signed-out payload', async () => {
    expect(await readClaudeCredential(async () => Promise.reject(new Error('x')))).toBeNull();
    expect(await readClaudeCredential(async () => 'not json')).toBeNull();
    expect(await readClaudeCredential(async () => '{}')).toBeNull();
    expect(
      await readClaudeCredential(async () => JSON.stringify({ claudeAiOauth: {} }))
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* service — custody invariants and honest failure                     */
/* ------------------------------------------------------------------ */

describe('ClaudePlanAccountService', () => {
  let stateDir: string;
  let nowMs: number;

  const credential = (over: Partial<ClaudeOauthCredential> = {}): ClaudeOauthCredential => ({
    accessToken: FAKE_TOKEN,
    expiresAtMs: nowMs + 3_600_000,
    subscriptionType: 'max',
    ...over,
  });

  const okFetch = () =>
    vi.fn(async () => new Response(JSON.stringify(USAGE_RESPONSE), { status: 200 }));

  const service = (over: {
    fetchFn?: typeof fetch;
    readCredential?: () => Promise<ClaudeOauthCredential | null>;
    enabled?: boolean;
    remoteReadAllowed?: boolean;
    minFetchIntervalMs?: number;
  } = {}) =>
    new ClaudePlanAccountService({
      stateDir,
      enabled: over.enabled ?? true,
      remoteReadAllowed: over.remoteReadAllowed,
      fetchFn: (over.fetchFn ?? okFetch()) as typeof fetch,
      readCredential: over.readCredential ?? (async () => credential()),
      now: () => nowMs,
      minFetchIntervalMs: over.minFetchIntervalMs ?? 5 * 60_000,
      jitterMs: 0,
    });

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-plan-'));
    nowMs = Date.parse('2026-08-11T21:00:00.000Z');
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('serves the vendor windows, plan identity, and spend after a refresh', async () => {
    const fetchFn = okFetch();
    const svc = service({ fetchFn: fetchFn as unknown as typeof fetch });
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.windows).toHaveLength(3);
    expect(view.account).toMatchObject({
      source: 'claude-code',
      status: 'ok',
      planType: 'max',
      observedAt: new Date(nowMs).toISOString(),
    });
    expect(view.account.spend?.usedMinor).toBe(20160);
    expect(view.revision).toBeGreaterThan(0);
  });

  it('speaks only to api.anthropic.com and refuses redirects', async () => {
    const fetchFn = okFetch();
    const svc = service({ fetchFn: fetchFn as unknown as typeof fetch });
    await svc.maybeRefresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CLAUDE_USAGE_ENDPOINT);
    expect(new URL(url).host).toBe('api.anthropic.com');
    expect(init.redirect).toBe('error');
    expect(init.method).toBe('GET');
  });

  it('never fetches more often than the cadence', async () => {
    const fetchFn = okFetch();
    const svc = service({ fetchFn: fetchFn as unknown as typeof fetch });
    await svc.maybeRefresh();
    await svc.maybeRefresh();
    nowMs += 60_000; // one minute later — still inside the five-minute cadence
    await svc.maybeRefresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    nowMs += 5 * 60_000;
    await svc.maybeRefresh();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('NEVER sends an expired token — no request is constructed at all', async () => {
    const fetchFn = okFetch();
    const svc = service({
      fetchFn: fetchFn as unknown as typeof fetch,
      readCredential: async () => credential({ expiresAtMs: nowMs - 1 }),
    });
    await svc.maybeRefresh();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(svc.view().windows).toEqual([]);
    expect(svc.view().account.status).toBe('unavailable');
  });

  it('degrades to absence on network failure, missing credential, and 401', async () => {
    for (const broken of [
      service({ fetchFn: vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch }),
      service({ readCredential: async () => null }),
      service({ fetchFn: vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch }),
    ]) {
      await broken.maybeRefresh();
      const view = broken.view();
      expect(view.windows).toEqual([]);
      expect(view.account.status).toBe('unavailable');
    }
  });

  it('keeps the last observation at its TRUE age when the endpoint later drifts', async () => {
    const fetchFn = okFetch();
    const svc = service({ fetchFn: fetchFn as unknown as typeof fetch, minFetchIntervalMs: 0 });
    await svc.maybeRefresh();
    const firstObservedAt = new Date(nowMs).toISOString();

    nowMs += 10 * 60_000;
    fetchFn.mockImplementation(async () => new Response('{"shape":"changed"}', { status: 200 }));
    await svc.maybeRefresh();

    const view = svc.view();
    expect(view.account.status).toBe('unavailable');
    // The old windows survive with their old observedAt — the freshness rule
    // judges them; nothing pretends the failed fetch produced a fresh figure.
    expect(view.windows).toHaveLength(3);
    expect(view.windows.every(w => w.observedAt === firstObservedAt)).toBe(true);
    expect(view.account.observedAt).toBe(firstObservedAt);
  });

  it('disabled serves absence and constructs no request; re-enabling recovers', async () => {
    const fetchFn = okFetch();
    const svc = service({ fetchFn: fetchFn as unknown as typeof fetch, enabled: false });
    await svc.maybeRefresh();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(svc.view().account.status).toBe('disabled');
    expect(svc.view().windows).toEqual([]);

    svc.setEnabled(true);
    await svc.maybeRefresh();
    expect(svc.view().windows).toHaveLength(3);
  });

  it('an unsigned runtime cannot be opened by changing the setting', async () => {
    const fetchFn = okFetch();
    const readCredential = vi.fn(async () => credential());
    const svc = service({
      fetchFn: fetchFn as unknown as typeof fetch,
      readCredential,
      remoteReadAllowed: false,
    });

    await svc.maybeRefresh();
    svc.setEnabled(false);
    svc.setEnabled(true);
    await svc.maybeRefresh();

    expect(readCredential).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(svc.view().account.status).toBe('disabled');
  });

  it('switching off mid-life hides the windows on the very next view', async () => {
    const svc = service();
    await svc.maybeRefresh();
    expect(svc.view().windows).toHaveLength(3);
    const before = svc.view().revision;
    svc.setEnabled(false);
    expect(svc.view().windows).toEqual([]);
    expect(svc.view().account.status).toBe('disabled');
    expect(svc.view().revision).toBeGreaterThan(before);
  });

  it('persists last-known state for warm launches — WITHOUT the token', async () => {
    const svc = service();
    await svc.maybeRefresh();

    const stateFile = path.join(stateDir, 'claude-plan.json');
    const persisted = fs.readFileSync(stateFile, 'utf8');
    expect(persisted).not.toContain(FAKE_TOKEN);
    expect(persisted.toLowerCase()).not.toContain('accesstoken');

    const warm = service({ fetchFn: vi.fn() as unknown as typeof fetch });
    const view = warm.view();
    expect(view.windows).toHaveLength(3);
    expect(view.account.observedAt).toBe(new Date(nowMs).toISOString());
    // Nothing else was written anywhere: the state dir holds exactly one file.
    expect(fs.readdirSync(stateDir)).toEqual(['claude-plan.json']);
  });

  it('the served view never contains the token', async () => {
    const svc = service();
    await svc.maybeRefresh();
    expect(JSON.stringify(svc.view())).not.toContain(FAKE_TOKEN);
  });

  it('window rates become observable from two spaced vendor observations', async () => {
    const fetchFn = okFetch();
    const svc = service({ fetchFn: fetchFn as unknown as typeof fetch, minFetchIntervalMs: 0 });
    await svc.maybeRefresh();

    nowMs += 60 * 60_000; // one hour later the weekly-all window moved 38 → 40
    const later = JSON.parse(JSON.stringify(USAGE_RESPONSE)) as typeof USAGE_RESPONSE & {
      limits: Array<{ kind: string; percent: number }>;
    };
    later.limits.find(l => l.kind === 'weekly_all')!.percent = 40;
    fetchFn.mockImplementation(async () => new Response(JSON.stringify(later), { status: 200 }));
    await svc.maybeRefresh();

    const view = svc.view();
    const weeklyAll = view.windows.find(w => w.limitId === 'claude-weekly-all')!;
    expect(view.rates[planWindowKey(weeklyAll)]).toBeCloseTo(2, 5);
  });
});

/* ------------------------------------------------------------------ */
/* composite — one seam, two source classes                            */
/* ------------------------------------------------------------------ */

describe('ProviderPlanCompositeSource', () => {
  const scannerSnapshot = (revision: number): LiveConsumptionSnapshot => {
    const snapshot = emptyLiveConsumptionSnapshot(0);
    snapshot.scanState.revision = revision;
    snapshot.windowRates = { 'codex|codex|primary|300': 9.4 };
    return snapshot;
  };

  function fakeScanner(revision = 3) {
    const listeners = new Set<(event: ConsumptionUpdatedEvent) => void>();
    const scanner: ConsumptionScannerLike & {
      push(revision: number): void;
      rescans: number;
    } = {
      rescans: 0,
      snapshot: async () => scannerSnapshot(revision),
      rescan() {
        this.rescans += 1;
      },
      cancelScan: () => {},
      onUpdated(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      push(rev: number) {
        const state = scannerSnapshot(rev).scanState;
        for (const listener of listeners) listener({ revision: rev, scanState: state });
      },
    };
    return scanner;
  }

  function planService(stateDir: string) {
    return new ClaudePlanAccountService({
      stateDir,
      enabled: true,
      fetchFn: (async () =>
        new Response(JSON.stringify(USAGE_RESPONSE), {
          status: 200,
        })) as unknown as typeof fetch,
      readCredential: async () => ({
        accessToken: FAKE_TOKEN,
        expiresAtMs: Date.now() + 3_600_000,
        subscriptionType: 'max',
      }),
      minFetchIntervalMs: 0,
      jitterMs: 0,
    });
  }

  let stateDir: string;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-composite-'));
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('merges vendor windows, rates, and account state into the one snapshot', async () => {
    const scanner = fakeScanner();
    const plan = planService(stateDir);
    const composite = new ProviderPlanCompositeSource(scanner, plan);

    await plan.maybeRefresh();
    const snapshot = await composite.snapshot();

    expect(snapshot.planWindows.map(w => w.limitId).sort()).toEqual([
      'claude-session',
      'claude-weekly-all',
      'claude-weekly-fable',
    ]);
    expect(snapshot.windowRates['codex|codex|primary|300']).toBe(9.4);
    expect(snapshot.providerPlanAccounts?.[0]).toMatchObject({
      source: 'claude-code',
      status: 'ok',
    });
    // Composed revision: scanner revision + plan revision, monotonic.
    expect(snapshot.scanState.revision).toBe(3 + plan.view().revision);
  });

  it('re-emits scanner events with the composed revision and emits on plan bumps', async () => {
    const scanner = fakeScanner();
    const plan = planService(stateDir);
    const composite = new ProviderPlanCompositeSource(scanner, plan);
    const events: ConsumptionUpdatedEvent[] = [];
    composite.onUpdated(event => events.push(event));

    scanner.push(5);
    expect(events.at(-1)?.revision).toBe(5 + plan.view().revision);

    await plan.maybeRefresh(); // success bumps the plan revision → an event
    expect(events.at(-1)?.revision).toBe(5 + plan.view().revision);
    expect(events.at(-1)!.revision).toBeGreaterThan(events[0].revision);
    // The event's scanState carries the same composed revision the next
    // snapshot pull will serve, so the renderer's stale-drop keeps working.
    expect(events.at(-1)?.scanState.revision).toBe(events.at(-1)?.revision);
  });

  it('rescan nudges the plan refresh alongside the scanner pass', () => {
    const scanner = fakeScanner();
    const plan = planService(stateDir);
    const spy = vi.spyOn(plan, 'maybeRefresh');
    new ProviderPlanCompositeSource(scanner, plan).rescan();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scanner.rescans).toBe(1);
  });
});
