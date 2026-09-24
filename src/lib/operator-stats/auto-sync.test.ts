/**
 * ENG-035 — the sync executor's contract (pure, injected deps).
 *
 * The load-bearing assertions: nothing is planned or uploaded while the
 * switch is off/absent, signed out, or unlinked, and a gated state never
 * emits an analytics event — only a genuine attempt-and-fail does. BUG-164
 * adds the other half: every attempt that got past the gates leaves a
 * durable record, and a refusal that retrying cannot fix is never reported
 * as one that will. The schedule and coalescing live in
 * `auto-sync.dom.test.ts`, which has a window.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, UserIdentity } from '@supabase/supabase-js';
import {
  OPERATOR_STATS_DERIVATION_VERSION,
  type OperatorStatsPublication,
  type OperatorStatsPublicationPlan,
  type OperatorStatsSyncEvent,
} from '@exawatt/core';
import { CompatibleServiceProblemError } from '@exawatt/core/distribution';
import {
  __resetOperatorStatsSyncForTests,
  performOperatorStatsSync,
  type OperatorProfilePublicationState,
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

function publication(from: string, through: string): OperatorStatsPublication {
  return {
    schemaVersion: 2,
    consentVersion: 1,
    enabled: true,
    timezone: 'America/Los_Angeles',
    coverage: { from, through },
    days: [
      {
        localDate: through,
        agentMs: 3_600_000,
        runCount: 2,
        peakFleet: 4,
        longestHandsOffMs: 600_000,
        rawTokens: 1_000,
        normalizedTokens: 2_000,
        sources: ['claude-code'],
        assurance: ['derived'],
      },
    ],
    runs: [],
  };
}

function planOf(
  ...publications: OperatorStatsPublication[]
): OperatorStatsPublicationPlan {
  return {
    derivation: OPERATOR_STATS_DERIVATION_VERSION,
    coverage: publications.length
      ? {
          from: publications[0].coverage.from,
          through: publications.at(-1)!.coverage.through,
        }
      : null,
    publications,
    excluded: [],
    receiptsOmitted: 0,
    totals: { runs: 2, agentMs: 3_600_000, normalizedTokens: 2_000 },
  };
}

const PLAN = planOf(publication('2026-08-04', '2026-08-10'));

function buildDeps(overrides: Partial<OperatorStatsSyncDeps> = {}) {
  let publicationState: OperatorProfilePublicationState = {};
  const events: OperatorStatsSyncEvent[] = [];
  const planSpy = vi.fn<OperatorStatsSyncDeps['plan']>(async () => PLAN);
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
    plan: planSpy,
    post: postSpy,
    recordSync: async event => {
      events.push(event);
    },
    captureFailure: captureSpy,
    now: () => 1_762_800_000_000,
    timezone: () => 'America/Los_Angeles',
    ...overrides,
  };
  return {
    ...deps,
    planSpy,
    postSpy,
    captureSpy,
    events,
    publicationState: () => publicationState,
    setPublicationState: (next: OperatorProfilePublicationState) => {
      publicationState = next;
    },
  };
}

afterEach(() => {
  __resetOperatorStatsSyncForTests();
});

describe('performOperatorStatsSync gates', () => {
  it('does nothing at all while the switch is off — no plan, no post, no event', async () => {
    const deps = buildDeps({ isAutoPublishEnabled: async () => false });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('paused');
    expect(deps.planSpy).not.toHaveBeenCalled();
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
    expect(deps.events).toEqual([]);
    // Not even the consent anchor is written: pause means pause.
    expect(deps.publicationState()).toEqual({});
  });

  it('waits for sign-in without attempting or counting anything', async () => {
    const deps = buildDeps({ getSession: async () => null });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('signed-out');
    expect(deps.planSpy).not.toHaveBeenCalled();
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
    expect(deps.events).toEqual([]);
  });

  it('waits for a GitHub link without attempting or counting anything', async () => {
    const deps = buildDeps({ getGithubIdentity: async () => null });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('unlinked');
    expect(deps.planSpy).not.toHaveBeenCalled();
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
    expect(deps.events).toEqual([]);
  });

  it('aborts before the network write when the switch flips off mid-plan', async () => {
    const answers = [true, false];
    const deps = buildDeps({
      isAutoPublishEnabled: async () => answers.shift() ?? false,
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('paused');
    expect(deps.planSpy).toHaveBeenCalledTimes(1);
    expect(deps.postSpy).not.toHaveBeenCalled();
    expect(deps.captureSpy).not.toHaveBeenCalled();
  });

  it('stops between publications when the switch flips off', async () => {
    const answers = [true, true, false];
    const deps = buildDeps({
      isAutoPublishEnabled: async () => answers.shift() ?? false,
      plan: async () =>
        planOf(
          publication('2026-08-04', '2026-09-03'),
          publication('2026-09-04', '2026-09-23')
        ),
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('paused');
    expect(deps.postSpy).toHaveBeenCalledTimes(1);
  });
});

describe('performOperatorStatsSync sync', () => {
  it('posts each planned publication under the GitHub-seeded identity', async () => {
    const deps = buildDeps();

    const result = await performOperatorStatsSync(deps);

    expect(result).toEqual({
      outcome: 'synced',
      failure: null,
      snapshot: { runs: 2, agentMs: 3_600_000, normalizedTokens: 2_000 },
    });
    const [body, accessToken] = deps.postSpy.mock.calls[0];
    expect(accessToken).toBe(SESSION.access_token);
    expect(JSON.parse(body)).toEqual({
      ...PLAN.publications[0],
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

  it('sends a backlog oldest first and moves the cursor after each', async () => {
    const first = publication('2026-08-04', '2026-09-03');
    const second = publication('2026-09-04', '2026-09-23');
    const deps = buildDeps({ plan: async () => planOf(first, second) });

    await performOperatorStatsSync(deps);

    expect(
      deps.postSpy.mock.calls.map(([body]) => JSON.parse(body).coverage)
    ).toEqual([first.coverage, second.coverage]);
    // Only the last publication claims the derivation: an interrupted
    // republish must start over, not resume past history it never replaced.
    expect(deps.events).toEqual([
      expect.objectContaining({ kind: 'published', coverage: first.coverage }),
      {
        kind: 'published',
        at: new Date(deps.now()).toISOString(),
        coverage: second.coverage,
        derivation: OPERATOR_STATS_DERIVATION_VERSION,
      },
    ]);
    expect('derivation' in deps.events[0]).toBe(false);
  });

  it('asks the planner to resume from the published cursor', async () => {
    const deps = buildDeps();
    deps.setPublicationState({
      startedAt: '2026-08-03T18:00:00.000Z',
      publishedThrough: '2026-09-13',
      publishedDerivation: 2,
    });

    await performOperatorStatsSync(deps);

    expect(deps.planSpy).toHaveBeenCalledWith({
      since: '2026-08-03T18:00:00.000Z',
      timezone: 'America/Los_Angeles',
      cursor: { publishedThrough: '2026-09-13', derivation: 2 },
    });
  });

  it('anchors recording at the first sync and never moves it', async () => {
    const deps = buildDeps();

    await performOperatorStatsSync(deps);

    const anchor = deps.publicationState().startedAt;
    expect(anchor).toBe(new Date(deps.now()).toISOString());
    expect(deps.planSpy).toHaveBeenCalledWith({
      since: anchor,
      timezone: 'America/Los_Angeles',
      cursor: null,
    });

    await performOperatorStatsSync(deps);
    expect(deps.publicationState().startedAt).toBe(anchor);
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

    expect(deps.planSpy).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2026-08-03T18:00:00.000Z' })
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

  // BUG-164: the service refused every sync for nine days; the only trace
  // was a status line promising a retry that could never succeed.
  it('records a refused publication as final, with the reason, and stops', async () => {
    const deps = buildDeps({
      plan: async () =>
        planOf(
          publication('2026-08-04', '2026-09-03'),
          publication('2026-09-04', '2026-09-23')
        ),
      post: async () => {
        throw new CompatibleServiceProblemError({
          type: 'about:blank',
          title: 'Invalid request',
          status: 400,
          code: 'invalid_request',
          detail: 'runs[128].elapsedMs is out of bounds',
          retryable: false,
        });
      },
    });

    const result = await performOperatorStatsSync(deps);

    expect(result).toEqual({
      outcome: 'failed',
      failure: 'rejected',
      snapshot: null,
    });
    // One refusal ends the attempt: the second publication is never sent.
    expect(deps.events).toEqual([
      {
        kind: 'failed',
        at: new Date(deps.now()).toISOString(),
        failure: 'rejected',
        retryable: false,
        status: 400,
        code: 'invalid_request',
        detail: 'runs[128].elapsedMs is out of bounds',
      },
    ]);
    expect(deps.captureSpy).toHaveBeenCalledWith('invalid_response', 400);
  });

  it('keeps the cursor of publications that landed before a failure', async () => {
    let calls = 0;
    const deps = buildDeps({
      plan: async () =>
        planOf(
          publication('2026-08-04', '2026-09-03'),
          publication('2026-09-04', '2026-09-23')
        ),
      post: async () => {
        calls += 1;
        if (calls === 2) throw new Error('offline');
        return { ok: true, status: 200 };
      },
    });

    await performOperatorStatsSync(deps);

    expect(deps.events.map(event => event.kind)).toEqual([
      'published',
      'failed',
    ]);
    expect(deps.events[1]).toMatchObject({
      failure: 'network',
      retryable: true,
    });
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

  it('treats a local read failure as failed without counting a hosted call', async () => {
    const deps = buildDeps({
      plan: async () => {
        throw new Error('local source unreadable');
      },
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe('local-scan');
    expect(deps.postSpy).not.toHaveBeenCalled();
    // No hosted call was attempted, so there is nothing to count.
    expect(deps.captureSpy).not.toHaveBeenCalled();
    expect(deps.events).toEqual([
      expect.objectContaining({ failure: 'local-scan', retryable: true }),
    ]);
  });

  it('reports a planner contract violation as a final local defect', async () => {
    const deps = buildDeps({
      plan: async () => {
        throw new Error(
          "Error invoking remote method 'operator-stats:plan': OperatorStatsContractError: planned publication violates the contract"
        );
      },
    });

    const result = await performOperatorStatsSync(deps);

    expect(result.failure).toBe('local-contract');
    expect(deps.events).toEqual([
      expect.objectContaining({
        failure: 'local-contract',
        retryable: false,
        detail: expect.stringContaining('violates the contract'),
      }),
    ]);
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
