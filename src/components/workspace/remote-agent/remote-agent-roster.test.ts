import { describe, expect, it } from 'vitest';
import {
  STATUS_LIGHT_META,
  statusLightWord,
} from '@/components/status-light/protocol';
import { projectCoworkers, type RemoteRoster } from './remote-agent-roster';
import type { RemoteAgentView } from '@/types/electron';

/**
 * ENG-010: what the roster is allowed to say about a coworker.
 *
 * Nothing here names a host, an address, a user, or a key. The fixture is a
 * plausible source with a plain label, because the point under test is the
 * projection, not the transport.
 */
function remoteAgent(
  overrides: Partial<RemoteAgentView> = {}
): RemoteAgentView {
  return {
    id: 'remote-abc123',
    displayName: 'Tyler',
    projectId: 'project-field',
    projectLabel: 'Field Work',
    discoveryState: 'configured',
    placement: 'customer-hosted',
    placementLabel: 'Remote',
    adapterId: 'openclaw',
    source: { id: 'alpha', displayName: 'Workshop box' },
    nativeAgentId: 'tyler',
    primaryContextId: 'agent:tyler:main',
    workState: 'idle',
    contextCount: 3,
    observedAt: 5_000,
    createdAt: 1_000,
    lastActiveAt: 4_000,
    connection: {
      state: 'live',
      label: 'Live',
      detail: 'Live',
      observationAgeMs: 0,
      stalePresentation: false,
      failure: null,
    },
    projectionVersion: 1,
    ...overrides,
  };
}

function rosterOf(agents: RemoteAgentView[]): RemoteRoster {
  return { sources: [], agents, authorities: [], loaded: true };
}

describe('the coworker work state a tile may show (ENG-010)', () => {
  it('reads a source that reported nothing as unreported', () => {
    const [tile] = projectCoworkers(
      rosterOf([remoteAgent({ workState: null })])
    );
    expect(tile!.workState).toBe('unreported');
    expect(statusLightWord(tile!.workState)).toBe('Not reported');
    expect(statusLightWord(tile!.workState)).not.toBe(
      STATUS_LIGHT_META.off.label
    );
  });

  it('reads a source that reported idle as idle', () => {
    const [tile] = projectCoworkers(
      rosterOf([remoteAgent({ workState: 'idle' })])
    );
    expect(tile!.workState).toBe('off');
    expect(statusLightWord(tile!.workState)).toBe('Idle');
  });

  it('separates the two on the same roster', () => {
    const tiles = projectCoworkers(
      rosterOf([
        remoteAgent({
          id: 'a',
          nativeAgentId: 'a',
          displayName: 'Ada',
          workState: 'idle',
        }),
        remoteAgent({
          id: 'b',
          nativeAgentId: 'b',
          displayName: 'Bo',
          workState: null,
        }),
      ])
    );
    const words = tiles.map(tile => statusLightWord(tile.workState));
    expect(new Set(words).size).toBe(2);
    expect(words).toEqual(['Idle', 'Not reported']);
  });

  it('does not let a lost connection edit the work state in either direction', () => {
    const offline = {
      state: 'unavailable' as const,
      label: 'Unavailable',
      detail: 'Not reachable',
      observationAgeMs: 60_000,
      stalePresentation: true,
      failure: 'host-unreachable' as const,
    };
    const [working] = projectCoworkers(
      rosterOf([remoteAgent({ workState: 'working', connection: offline })])
    );
    expect(working!.workState).toBe('active');
    const [silent] = projectCoworkers(
      rosterOf([remoteAgent({ workState: null, connection: offline })])
    );
    // Still unreported, not "stopped", not "idle", not the connection's word.
    expect(silent!.workState).toBe('unreported');
    expect(statusLightWord(silent!.workState)).not.toMatch(
      /stopped|paused|lost|ended|finished|stale|unavailable/i
    );
  });

  it('carries every reported state through untouched', () => {
    const reported = {
      working: 'active',
      reviewing: 'active',
      complete: 'result',
      blocked: 'needs-you',
      error: 'fault',
      idle: 'off',
    } as const;
    for (const [status, expected] of Object.entries(reported)) {
      const [tile] = projectCoworkers(
        rosterOf([remoteAgent({ workState: status as keyof typeof reported })])
      );
      expect(tile!.workState).toBe(expected);
    }
  });
});
