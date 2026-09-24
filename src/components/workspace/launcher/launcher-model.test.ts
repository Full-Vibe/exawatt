// Node suite on purpose: the readiness chain is a pure state machine, and
// "not yet checked" versus "checked and failed" must be a transition a test
// can name without a DOM (BUG-062 / BUG-082).
import { describe, expect, it } from 'vitest';
import {
  AGENT_SOURCE_FACT_FRESH_MS,
  type AgentSourceRegistrySnapshot,
  type AgentSourceSnapshot,
} from '@exawatt/core';
import {
  checkingAgentSourceRegistry,
  fallbackAgentSourceRegistry,
} from '../agent-sources';
import {
  launcherReadiness,
  launcherStatusLine,
  type LauncherReadinessInput,
} from './launcher-model';

const NOW = 1_800_000_000_000;

/** A launch-scope registry whose every source is a complete live `ready`. */
function liveRegistry(
  observedAt = NOW,
  patch: (source: AgentSourceSnapshot) => Partial<AgentSourceSnapshot> = () =>
    ({})
): AgentSourceRegistrySnapshot {
  const base = fallbackAgentSourceRegistry('launch');
  return {
    ...base,
    observedAt,
    sources: base.sources.map(source => ({
      ...source,
      launchable: true,
      state: 'ready' as const,
      stateLabel: 'Ready',
      observedAt,
      observation: { origin: 'live' as const },
      unobservedProbes: [],
      ...patch(source),
    })),
  };
}

function remembered(
  registry: AgentSourceRegistrySnapshot,
  revalidation: null | { unobservedProbes: readonly ('version' | 'authentication')[] } = null
): AgentSourceRegistrySnapshot {
  return {
    ...registry,
    sources: registry.sources.map(source => ({
      ...source,
      observation: {
        origin: 'remembered' as const,
        revalidation: revalidation
          ? { attemptedAt: NOW, unobservedProbes: revalidation.unobservedProbes }
          : null,
      },
    })),
  };
}

function input(
  overrides: Partial<LauncherReadinessInput> & {
    registry?: Partial<LauncherReadinessInput['registry']>;
  } = {}
): LauncherReadinessInput {
  return {
    preferencesReady: true,
    poolReady: true,
    now: NOW,
    ...overrides,
    registry: {
      snapshot: liveRegistry(),
      checking: false,
      painted: 'live',
      ...overrides.registry,
    },
  };
}

const claude = (readiness: ReturnType<typeof launcherReadiness>) =>
  readiness.facts.find(fact => fact.harness === 'claude')!;

describe('launcher readiness chain', () => {
  it('settles the row only behind the saved policy and a painted registry', () => {
    expect(
      launcherReadiness(input({ preferencesReady: false })).phase
    ).toBe('settling');
    expect(launcherReadiness(input({ poolReady: false })).phase).toBe(
      'settling'
    );
    expect(
      launcherReadiness(
        input({
          registry: {
            snapshot: checkingAgentSourceRegistry('launch'),
            checking: true,
            painted: 'none',
          },
        })
      ).phase
    ).toBe('settling');
    expect(launcherReadiness(input()).phase).toBe('ready');
  });

  // The whole point of the memory: the row is ready the moment the
  // last-known-good paints, while the live probe is still running.
  it('is ready from a remembered registry while the live read is still checking', () => {
    const readiness = launcherReadiness(
      input({
        registry: {
          snapshot: remembered(liveRegistry(NOW - 2 * 60 * 60_000)),
          checking: true,
          painted: 'remembered',
        },
      })
    );
    expect(readiness.phase).toBe('ready');
    expect(readiness.checking).toBe(true);
    const fact = claude(readiness);
    expect(fact.freshness).toBe('checking');
    expect(fact.available).toBe(true);
    expect(launcherStatusLine(fact, readiness)).toEqual({
      kind: 'checking',
      text: 'Checking engines…',
    });
  });

  it('never gates the row on a model catalog', () => {
    // No catalog is an input at all: the chain has nothing to wait for.
    expect(Object.keys(input())).not.toContain('catalogs');
    expect(launcherReadiness(input()).phase).toBe('ready');
  });

  describe('not yet checked versus checked and failed', () => {
    it('reads a running first probe with no memory as checking, not unknown', () => {
      const readiness = launcherReadiness(
        input({
          registry: {
            snapshot: checkingAgentSourceRegistry('launch'),
            checking: true,
            painted: 'none',
          },
        })
      );
      expect(claude(readiness).freshness).toBe('checking');
      expect(claude(readiness).verdict.kind).toBe('unproven');
    });

    it('reads a probe that ran and did not answer as unobserved, never as a failure', () => {
      const readiness = launcherReadiness(
        input({
          registry: {
            snapshot: liveRegistry(NOW, () => ({
              launchable: false,
              state: 'unknown',
              stateLabel: 'Unknown',
              unobservedProbes: ['version', 'authentication'],
            })),
            checking: false,
            painted: 'live',
          },
        })
      );
      const fact = claude(readiness);
      expect(fact.freshness).toBe('unobserved');
      expect(fact.verdict.kind).toBe('unproven');
      // The launch attempt is the better probe (BUG-063): Start stays live.
      expect(fact.available).toBe(true);
      expect(launcherStatusLine(fact, readiness)).toEqual({
        kind: 'notice',
        text: 'Claude Code: not checked',
      });
    });

    it('reads a probe that ran and said no as known, with the blocking fact named', () => {
      const readiness = launcherReadiness(
        input({
          registry: {
            snapshot: liveRegistry(NOW, source =>
              source.harness === 'claude'
                ? {
                    launchable: false,
                    state: 'not-installed',
                    stateLabel: 'Not installed',
                  }
                : {}
            ),
            checking: false,
            painted: 'live',
          },
        })
      );
      const fact = claude(readiness);
      expect(fact.freshness).toBe('known');
      expect(fact.available).toBe(false);
      const line = launcherStatusLine(fact, readiness);
      expect(line.kind).toBe('blocked');
      // The fact, never the state label.
      expect(line.text).toBe('Claude Code is not installed.');
      expect(line.text).not.toMatch(/Not installed$|Unknown|Degraded/);
    });

    it('transitions one source from checking to known when the live read lands', () => {
      const before = launcherReadiness(
        input({
          registry: {
            snapshot: remembered(liveRegistry(NOW - 60 * 60_000)),
            checking: true,
            painted: 'remembered',
          },
        })
      );
      const after = launcherReadiness(
        input({
          registry: {
            snapshot: liveRegistry(NOW, source =>
              source.harness === 'claude'
                ? {
                    launchable: false,
                    state: 'not-installed',
                    stateLabel: 'Not installed',
                  }
                : {}
            ),
            checking: false,
            painted: 'live',
          },
        })
      );
      expect(claude(before).freshness).toBe('checking');
      expect(claude(before).available).toBe(true);
      expect(claude(after).freshness).toBe('known');
      expect(claude(after).available).toBe(false);
      expect(after.checking).toBe(false);
    });
  });

  describe('a fact with an age', () => {
    it('keeps a remembered fact whose revalidation did not finish, marked stale by age', () => {
      const readiness = launcherReadiness(
        input({
          registry: {
            snapshot: remembered(liveRegistry(NOW - 3 * 60 * 60_000), {
              unobservedProbes: ['version'],
            }),
            checking: false,
            painted: 'live',
          },
        })
      );
      const fact = claude(readiness);
      expect(fact.freshness).toBe('stale');
      expect(fact.available).toBe(true);
      expect(launcherStatusLine(fact, readiness)).toEqual({
        kind: 'checking',
        text: 'Claude Code: checked 3h ago',
      });
    });

    it('calls a live fact known inside the fresh window and stale past it', () => {
      const fresh = launcherReadiness(
        input({
          registry: {
            snapshot: liveRegistry(NOW - AGENT_SOURCE_FACT_FRESH_MS),
            checking: false,
            painted: 'live',
          },
        })
      );
      const aged = launcherReadiness(
        input({
          registry: {
            snapshot: liveRegistry(NOW - AGENT_SOURCE_FACT_FRESH_MS - 1),
            checking: false,
            painted: 'live',
          },
        })
      );
      expect(claude(fresh).freshness).toBe('known');
      expect(claude(aged).freshness).toBe('stale');
    });

    // Incident 0021: an answered `loggedIn:false` was wrong, and one normal
    // Claude request repaired it. Sign-in informs; it never blocks Start.
    it('names a sign-in negative without blocking, and dates it when stale', () => {
      const signedOut = (observedAt: number) =>
        liveRegistry(observedAt, source =>
          source.harness === 'claude'
            ? {
                launchable: true,
                state: 'action-required',
                stateLabel: 'Action required',
              }
            : {}
        );
      const now = launcherReadiness(
        input({
          registry: { snapshot: signedOut(NOW), checking: false, painted: 'live' },
        })
      );
      expect(claude(now).available).toBe(true);
      expect(launcherStatusLine(claude(now), now)).toEqual({
        kind: 'notice',
        text: 'Claude Code: not signed in',
      });
      const old = launcherReadiness(
        input({
          registry: {
            snapshot: remembered(signedOut(NOW - 2 * 60 * 60_000)),
            checking: false,
            painted: 'live',
          },
        })
      );
      expect(launcherStatusLine(claude(old), old)).toEqual({
        kind: 'notice',
        text: 'Claude Code: not signed in · checked 2h ago',
      });
    });
  });

  it('says nothing under a known, clear source', () => {
    const readiness = launcherReadiness(input());
    expect(launcherStatusLine(claude(readiness), readiness)).toEqual({
      kind: 'none',
      text: '',
    });
    expect(readiness.checking).toBe(false);
  });
});
