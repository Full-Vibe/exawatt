/**
 * ENG-035 — the sync executor's contract (pure, injected deps).
 *
 * The load-bearing assertions: nothing is scanned or uploaded while the
 * switch is off/absent, signed out, or unlinked, and a gated state never
 * emits an analytics event — only a genuine attempt-and-fail does. The
 * schedule and coalescing live in `auto-sync.dom.test.ts`, which has a
 * window.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, UserIdentity } from '@supabase/supabase-js';
import {
  __resetOperatorStatsSyncForTests,
  performOperatorStatsSync,
  type LocalOperatorStatsPreview,
  type OperatorStatsSyncDeps,
} from './auto-sync';

const SESSION = {
  access_token: 'header.payload.signature',
  user: { id: 'user-1' },
} as unknown as Session;

const GITHUB = {
  provider: 'github',
  identity_data: {
    user_name: 'Operator',
    full_name: 'The Operator',
    avatar_url: 'https://avatars.example/1',
  },
} as unknown as UserIdentity;

const PREVIEW: LocalOperatorStatsPreview = {
  schemaVersion: 1,
  consentVersion: 1,
  enabled: true,
  timezone: 'America/Los_Angeles',
  days: [
    {
      localDate: '2026-08-10',
      agentMs: 3_600_000,
      runCount: 2,
      peakFleet: 4,
      longestHandsOffMs: 600_000,
      rawTokens: 1_000,
      normalizedTokens: 2_000,
      sources: ['claude-code'],
      assurance: { reported: 0, observed: 0, derived: 2, unavailable: 0 },
    },
  ],
  runs: [],
} as unknown as LocalOperatorStatsPreview;

function buildDeps(overrides: Partial<OperatorStatsSyncDeps> = {}) {
  let publicationState: {
    startedAt?: string;
    lastSyncedAt?: string;
    profileEnabled?: boolean;
  } = {};
  const scanSpy = vi.fn<OperatorStatsSyncDeps['scan']>(async () => PREVIEW);
  const postSpy = vi.fn<OperatorStatsSyncDeps['post']>(async () => ({
    ok: true,
    status: 200,
  }));
  const captureSpy = vi.fn<OperatorStatsSyncDeps['captureFailure']>();
  const deps: OperatorStatsSyncDeps = {
    isAutoPublishEnabled: async () => true,
    getSession: async () => SESSION,
    getGithubIdentity: async () => GITHUB,
    getPublicationState: async () => publicationState,
    getHostedProfileState: async () => ({
      ok: true,
      status: 200,
      profile: null,
    }),
    recordPublicationState: async next => {
      publicationState = { ...publicationState, ...next };
    },
    scan: scanSpy,
    post: postSpy,
    captureFailure: captureSpy,
    now: () => 1_762_800_000_000,
    timezone: () => 'America/Los_Angeles',
    ...overrides,
  };
  return {
    ...deps,
    scanSpy,
    postSpy,
    captureSpy,
    publicationState: () => publicationState,
  };
}

afterEach(() => {
  __resetOperatorStatsSyncForTests();
});

describe('performOperatorStatsSync gates', () => {
  it('does nothing at all while the switch is off — no scan, no post, no event', async () => {
    const deps = buildDeps({ isAutoPublishEnabled: async () => false });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('paused');
    expect(deps.scanSpy).not.toHaveBeenCalled();
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
    // Not even the consent anchor is written: pause means pause.
    expect(deps.publicationState()).toEqual({});
  });

  it('waits for sign-in without attempting or counting anything', async () => {
    const deps = buildDeps({ getSession: async () => null });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('signed-out');
    expect(deps.scanSpy).not.toHaveBeenCalled();
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });

  it('waits for a GitHub link without attempting or counting anything', async () => {
    const deps = buildDeps({ getGithubIdentity: async () => null });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('unlinked');
    expect(deps.scanSpy).not.toHaveBeenCalled();
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });

  it('aborts before the network write when the switch flips off mid-scan', async () => {
    const answers = [true, false];
    const deps = buildDeps({
      isAutoPublishEnabled: async () => answers.shift() ?? false,
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('paused');
    expect(deps.scanSpy).toHaveBeenCalledTimes(1);
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });
});

describe('performOperatorStatsSync sync', () => {
  it('posts the allowlisted aggregate under the GitHub-seeded identity', async () => {
    const deps = buildDeps();

    const result = await performOperatorStatsSync(deps);

    expect(result).toEqual({
      outcome: 'synced',
      failure: null,
      snapshot: { runs: 0, agentMs: 3_600_000, normalizedTokens: 2_000 },
    });
    const [body, accessToken] = deps.postSpy.mock.calls[0];
    expect(accessToken).toBe(SESSION.access_token);
    const payload = JSON.parse(body);
    expect(payload).toEqual({
      ...PREVIEW,
      identity: {
        provider: 'github',
        providerHandle: 'Operator',
        handle: 'operator',
        displayName: 'The Operator',
        avatarUrl: 'https://avatars.example/1',
        links: ['https://github.com/Operator'],
      },
    });
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });

  it('anchors recording at the first sync and never moves it', async () => {
    const deps = buildDeps();

    await performOperatorStatsSync(deps);

    const anchor = deps.publicationState().startedAt;
    expect(anchor).toBe(new Date(deps.now()).toISOString());
    expect(deps.scanSpy).toHaveBeenCalledWith(anchor, 'America/Los_Angeles');

    await performOperatorStatsSync(deps);
    expect(deps.publicationState().startedAt).toBe(anchor);
  });

  it('records hosted publication truth on success', async () => {
    const deps = buildDeps();

    await performOperatorStatsSync(deps);

    expect(deps.publicationState()).toEqual({
      startedAt: new Date(deps.now()).toISOString(),
      lastSyncedAt: new Date(deps.now()).toISOString(),
      profileEnabled: true,
    });
  });

  it('recovers an existing profile boundary before reading local history', async () => {
    const deps = buildDeps({
      getHostedProfileState: async () => ({
        ok: true,
        status: 200,
        profile: {
          enabled: true,
          startedAt: '2026-08-03T18:00:00.000Z',
          lastSyncedAt: '2026-08-04T19:00:00.000Z',
        },
      }),
    });

    await performOperatorStatsSync(deps);

    expect(deps.scanSpy).toHaveBeenCalledWith(
      '2026-08-03T18:00:00.000Z',
      'America/Los_Angeles'
    );
    expect(deps.publicationState().startedAt).toBe('2026-08-03T18:00:00.000Z');
  });
});

describe('performOperatorStatsSync failures', () => {
  it('counts an HTTP refusal as operator_stats with the canonical class', async () => {
    const deps = buildDeps({ post: async () => ({ ok: false, status: 401 }) });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe('unauthorized');
    expect(deps.captureSpy).toHaveBeenCalledTimes(1);
    expect(deps.captureSpy).toHaveBeenCalledWith('unauthorized', 401);
  });

  it('counts a transport failure as network with no status', async () => {
    const deps = buildDeps({
      post: async () => {
        throw new Error('offline');
      },
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe('network');
    expect(deps.captureSpy).toHaveBeenCalledWith('network', null);
  });

  it('treats a local scan failure as failed without counting a hosted call', async () => {
    const deps = buildDeps({
      scan: async () => {
        throw new Error('local source unreadable');
      },
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe('local-scan');
    expect(deps.postSpy).not.toHaveBeenCalled();
    // No hosted call was attempted, so there is nothing to count.
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });

  it('never emits even a failure event while paused, whatever post would do', async () => {
    // Mutation-style guard: a broken post is irrelevant when the gate holds.
    const deps = buildDeps({
      isAutoPublishEnabled: async () => false,
      post: async () => {
        throw new Error('this must never run');
      },
    });

    await performOperatorStatsSync(deps);

    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });
});
