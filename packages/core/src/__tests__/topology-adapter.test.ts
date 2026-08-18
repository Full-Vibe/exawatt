import { describe, expect, it } from 'vitest';
import {
  AGENT_PROJECTION_VERSION,
  projectAgentTopology,
  type AgentProjectionMapping,
  type AgentSourceTopologySnapshot,
  type SourceContextRecord,
} from '../agent-projection';
import {
  adaptOpenClawTopology,
  classifySessionKey,
  type OpenClawTopologyInput,
  type OpenClawTopologyIssue,
  type OpenClawTopologyResult,
} from '../oc/topology-adapter';

/*
 * Every identifier here is invented. Nothing in this file was copied from a
 * live installation, endpoint, credential, or filesystem. The `/example/...`
 * workspace strings exist only so the leak assertions have something to catch.
 */
const SOURCE_ID = 'fixture-openclaw-source';
const GATEWAY_ID = 'fixture-openclaw-gateway';
const OBSERVED_AT = 1_800_000_000_000;
const MINUTE_MS = 60_000;

type SessionPayloadEntry = Record<string, unknown>;

function adapted(result: OpenClawTopologyResult): AgentSourceTopologySnapshot {
  if (!result.ok) {
    throw new Error(
      `Expected adaptation success, got: ${result.issues
        .map(issue => issue.code)
        .join(', ')}`
    );
  }
  return result.snapshot;
}

function codes(result: OpenClawTopologyResult): string[] {
  return result.issues.map(issue => issue.code);
}

function input(
  overrides: Partial<OpenClawTopologyInput> = {}
): OpenClawTopologyInput {
  return {
    configuredSourceId: SOURCE_ID,
    gatewayId: GATEWAY_ID,
    placement: 'customer-hosted',
    evidenceBasis: 'observed',
    observedAt: OBSERVED_AT,
    agentsList: { agents: [] },
    sessionLists: [],
    ...overrides,
  };
}

function agentEntry(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name: id,
    workspace: `/example/workspace/${id}`,
    workspaceGit: false,
    agentRuntime: { id: 'invented-runtime', source: 'provider' },
    model: 'invented-model-primary',
    isDefault: false,
    ...overrides,
  };
}

function sessionEntry(
  key: string,
  overrides: SessionPayloadEntry = {}
): SessionPayloadEntry {
  return {
    key,
    kind: 'direct',
    displayName: '',
    updatedAt: OBSERVED_AT - MINUTE_MS,
    sessionId: `invented-session-${key}`,
    archived: false,
    pinned: false,
    ...overrides,
  };
}

/** Deliberately accepts junk so malformed-entry cases stay expressible. */
function sessionsPayload(
  sessions: readonly unknown[]
): Record<string, unknown> {
  return {
    ts: OBSERVED_AT,
    path: '/example/state/sessions',
    count: sessions.length,
    totalCount: sessions.length,
    hasMore: false,
    sessions,
  };
}

/** A realistic two-Agent Gateway: one conversed with, one automation-only. */
function realisticInput(): OpenClawTopologyInput {
  return input({
    agentsList: {
      defaultId: 'alpha',
      mainKey: 'main',
      scope: 'per-sender',
      agents: [
        agentEntry('alpha', {
          name: 'Alpha',
          identityName: 'Alpha Rivera',
          isDefault: true,
          model: {
            primary: 'invented-model-primary',
            fallbacks: ['invented-model-fallback'],
          },
        }),
        agentEntry('writer', { name: 'writer', bindings: 0 }),
      ],
    },
    sessionLists: [
      {
        nativeAgentId: 'alpha',
        payload: sessionsPayload([
          sessionEntry('agent:alpha:main', {
            updatedAt: OBSERVED_AT - 5 * MINUTE_MS,
          }),
          sessionEntry('agent:alpha:channel:invented-channel-1'),
          sessionEntry('agent:alpha:subagent:invented-spawn-1'),
        ]),
      },
      {
        nativeAgentId: 'writer',
        payload: sessionsPayload([
          sessionEntry('agent:writer:cron:invented-job-1', {
            label: 'Cron: nightly-sweep',
          }),
          sessionEntry('agent:writer:helper-thread-invented-4'),
        ]),
      },
    ],
  });
}

function contextById(
  snapshot: AgentSourceTopologySnapshot,
  nativeContextId: string
): SourceContextRecord {
  const found = snapshot.contexts.find(
    context => context.nativeContextId === nativeContextId
  );
  if (!found) throw new Error(`Missing context ${nativeContextId}`);
  return found;
}

function planFor(snapshot: AgentSourceTopologySnapshot): {
  projectionVersion: number;
  mappings: AgentProjectionMapping[];
} {
  return {
    projectionVersion: AGENT_PROJECTION_VERSION,
    mappings: snapshot.agents.map(agent => ({
      configuredSourceId: agent.configuredSourceId,
      nativeAgentId: agent.nativeAgentId,
      exawattAgentId: `exawatt-${agent.nativeAgentId}`,
      projectId: 'fixture-project',
      displayNameOverride: null,
    })),
  };
}

describe('classifySessionKey', () => {
  it('classifies each known key segment', () => {
    expect(classifySessionKey('agent:writer:main')?.kind).toBe('main');
    expect(classifySessionKey('agent:writer:cron:invented-job')?.kind).toBe(
      'cron'
    );
    expect(classifySessionKey('agent:writer:subagent:invented-id')?.kind).toBe(
      'spawned'
    );
    expect(classifySessionKey('agent:writer:channel:invented-room')?.kind).toBe(
      'channel'
    );
  });

  it('treats an unrecognised segment as a helper thread', () => {
    expect(
      classifySessionKey('agent:writer:helper-thread-invented-4')?.kind
    ).toBe('helper');
    expect(classifySessionKey('agent:writer:something-new')?.kind).toBe(
      'helper'
    );
  });

  it('reports the embedded Agent id and the lossless suffix', () => {
    expect(classifySessionKey('agent:writer:main')).toEqual({
      nativeAgentId: 'writer',
      kind: 'main',
      nativeSuffix: 'main',
    });
    expect(classifySessionKey('agent:alpha:cron:invented-job:retry')).toEqual({
      nativeAgentId: 'alpha',
      kind: 'cron',
      nativeSuffix: 'cron:invented-job:retry',
    });
  });

  it('rejects keys that are not addressable Agent sessions', () => {
    expect(classifySessionKey('session:writer:main')).toBeNull();
    expect(classifySessionKey('agent:writer')).toBeNull();
    expect(classifySessionKey('agent::main')).toBeNull();
    expect(classifySessionKey('agent:writer:')).toBeNull();
    expect(classifySessionKey('')).toBeNull();
  });
});

describe('adaptOpenClawTopology classification', () => {
  it('classifies from the key even when the label claims otherwise', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              // A cron session reports kind "direct" and a "Cron: …" label.
              sessionEntry('agent:writer:cron:invented-job-1', {
                kind: 'direct',
                label: 'Cron: nightly-sweep',
              }),
              // …and a helper thread can carry a cron-looking label.
              sessionEntry('agent:writer:helper-thread-invented-4', {
                kind: 'direct',
                label: 'Cron: nightly-sweep',
                displayName: 'Cron: nightly-sweep',
              }),
              // …while a main session can be labelled like a cron job.
              sessionEntry('agent:writer:main', {
                kind: 'direct',
                label: 'Cron: not really',
              }),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(contextById(snapshot, 'agent:writer:cron:invented-job-1').kind).toBe(
      'cron'
    );
    expect(
      contextById(snapshot, 'agent:writer:helper-thread-invented-4').kind
    ).toBe('helper');
    expect(contextById(snapshot, 'agent:writer:main').kind).toBe('main');
  });

  it('keeps the payload kind verbatim and defaults it to unknown', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main', { kind: 'direct' }),
              sessionEntry('agent:writer:channel:invented-room', {
                kind: undefined,
              }),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(contextById(snapshot, 'agent:writer:main').nativeKind).toBe(
      'direct'
    );
    expect(
      contextById(snapshot, 'agent:writer:channel:invented-room').nativeKind
    ).toBe('unknown');
  });
});

describe('adaptOpenClawTopology roles', () => {
  it('gives the single main context the primary-conversation role', () => {
    const snapshot = adapted(adaptOpenClawTopology(realisticInput()));
    expect(contextById(snapshot, 'agent:alpha:main').roles).toEqual([
      'primary-conversation',
    ]);
    expect(
      contextById(snapshot, 'agent:alpha:channel:invented-channel-1').roles
    ).toEqual([]);
  });

  it('projects an automation-only Agent cleanly with no primary and no issue', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('scheduler')] },
        sessionLists: [
          {
            nativeAgentId: 'scheduler',
            payload: sessionsPayload([
              sessionEntry('agent:scheduler:cron:invented-job-1'),
              sessionEntry('agent:scheduler:cron:invented-job-2'),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(result.issues).toEqual([]);
    expect(snapshot.contexts.every(context => context.roles.length === 0)).toBe(
      true
    );
    expect(snapshot.contexts.some(context => context.kind === 'main')).toBe(
      false
    );
  });

  it('fails closed when an Agent declares more than one main context', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('alpha')] },
        sessionLists: [
          {
            nativeAgentId: 'alpha',
            payload: sessionsPayload([
              sessionEntry('agent:alpha:main'),
              sessionEntry('agent:alpha:main:second'),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['multiple-main-contexts']);
    expect(snapshot.contexts).toHaveLength(2);
    expect(snapshot.contexts.every(context => context.roles.length === 0)).toBe(
      true
    );
  });
});

describe('adaptOpenClawTopology session attribution', () => {
  it('drops a session whose key names a different Agent than its listing', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [agentEntry('alpha'), agentEntry('writer')],
        },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main'),
              sessionEntry('agent:alpha:main'),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['session-key-agent-mismatch']);
    expect(snapshot.contexts.map(context => context.nativeContextId)).toEqual([
      'agent:writer:main',
    ]);
  });

  it('drops a listing fetched for an Agent the roster does not contain', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('alpha')] },
        sessionLists: [
          {
            nativeAgentId: 'ghost',
            payload: sessionsPayload([sessionEntry('agent:ghost:main')]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['orphan-session-agent']);
    expect(snapshot.contexts).toEqual([]);
  });

  it('drops unaddressable session entries', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main'),
              { key: 'writer-main', kind: 'direct' },
              { key: 42, kind: 'direct' },
              'not-a-record',
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual([
      'invalid-session-entry',
      'invalid-session-entry',
      'invalid-session-entry',
    ]);
    expect(snapshot.contexts).toHaveLength(1);
  });

  it('keeps the first of two identical session keys', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main', {
                sessionId: 'invented-run-a',
              }),
              sessionEntry('agent:writer:main', {
                sessionId: 'invented-run-b',
              }),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['duplicate-context']);
    expect(snapshot.contexts).toHaveLength(1);
    expect(snapshot.contexts[0]?.nativeRunId).toBe('invented-run-a');
  });

  it('reports a malformed sessions payload without losing other Agents', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [agentEntry('alpha'), agentEntry('writer')],
        },
        sessionLists: [
          { nativeAgentId: 'alpha', payload: { sessions: 'nope' } },
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([sessionEntry('agent:writer:main')]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['invalid-sessions-payload']);
    expect(snapshot.contexts).toHaveLength(1);
  });
});

describe('adaptOpenClawTopology agents', () => {
  it('prefers identityName, then name, then the native id', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [
            agentEntry('alpha', {
              identityName: 'Alpha Rivera',
              name: 'Alpha',
            }),
            // A lowercase role slug is a perfectly good display name.
            agentEntry('writer', { name: 'writer' }),
            agentEntry('researcher', { identityName: '   ', name: '' }),
            agentEntry('scheduler', {
              identityName: 'x'.repeat(600),
              name: 'ignored',
            }),
          ],
        },
      })
    );
    const snapshot = adapted(result);
    const names = Object.fromEntries(
      snapshot.agents.map(agent => [agent.nativeAgentId, agent.displayName])
    );
    expect(names.alpha).toBe('Alpha Rivera');
    expect(names.writer).toBe('writer');
    expect(names.researcher).toBe('researcher');
    expect(names.scheduler).toHaveLength(512);
  });

  it('marks retired ids that are absent from the roster', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('alpha')] },
        retiredNativeAgentIds: ['researcher', 'researcher'],
      })
    );
    const snapshot = adapted(result);
    expect(result.issues).toEqual([]);
    expect(
      snapshot.agents.map(agent => [agent.nativeAgentId, agent.discoveryState])
    ).toEqual([
      ['alpha', 'configured'],
      ['researcher', 'retired'],
    ]);
  });

  it('lets the live roster win over a retired id without an issue', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('alpha')] },
        retiredNativeAgentIds: ['alpha'],
      })
    );
    const snapshot = adapted(result);
    expect(result.issues).toEqual([]);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]?.discoveryState).toBe('configured');
  });

  it('keeps the first of two identical Agent ids', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [
            agentEntry('alpha', { identityName: 'Alpha Rivera' }),
            agentEntry('alpha', { identityName: 'Impostor' }),
          ],
        },
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['duplicate-agent']);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]?.displayName).toBe('Alpha Rivera');
  });

  it('drops Agent entries with no usable identity', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [agentEntry('alpha'), { name: 'nameless' }, 7],
        },
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual([
      'invalid-agent-entry',
      'invalid-agent-entry',
    ]);
    expect(snapshot.agents).toHaveLength(1);
  });
});

describe('adaptOpenClawTopology field mapping', () => {
  it('maps run identity and activity, omitting unusable timestamps', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main', {
                sessionId: 'invented-run-1',
                createdAt: OBSERVED_AT - 90 * MINUTE_MS,
                updatedAt: OBSERVED_AT - MINUTE_MS,
              }),
              sessionEntry('agent:writer:cron:invented-job-1', {
                sessionId: '',
                updatedAt: 0,
                createdAt: Number.NaN,
              }),
              sessionEntry('agent:writer:cron:invented-job-2', {
                sessionId: null,
                updatedAt: -5,
              }),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    const main = contextById(snapshot, 'agent:writer:main');
    expect(main.nativeRunId).toBe('invented-run-1');
    expect(main.createdAt).toBe(OBSERVED_AT - 90 * MINUTE_MS);
    expect(main.lastActiveAt).toBe(OBSERVED_AT - MINUTE_MS);

    const jobOne = contextById(snapshot, 'agent:writer:cron:invented-job-1');
    expect(jobOne.nativeRunId).toBeNull();
    expect(jobOne.lastActiveAt).toBeUndefined();
    expect(jobOne.createdAt).toBeUndefined();
    expect(
      contextById(snapshot, 'agent:writer:cron:invented-job-2').lastActiveAt
    ).toBeUndefined();
  });

  it('resolves a same-Agent parent and drops every other lineage claim', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [agentEntry('alpha'), agentEntry('writer')],
        },
        sessionLists: [
          {
            nativeAgentId: 'alpha',
            payload: sessionsPayload([sessionEntry('agent:alpha:main')]),
          },
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main'),
              sessionEntry('agent:writer:subagent:invented-spawn-1', {
                parentKey: 'agent:writer:main',
              }),
              sessionEntry('agent:writer:subagent:invented-spawn-2', {
                parentKey: 'agent:alpha:main',
              }),
              sessionEntry('agent:writer:subagent:invented-spawn-3', {
                parentKey: 'agent:writer:vanished',
              }),
              sessionEntry('agent:writer:subagent:invented-spawn-4', {
                parentKey: 'agent:writer:subagent:invented-spawn-4',
              }),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(
      contextById(snapshot, 'agent:writer:subagent:invented-spawn-1').parent
    ).toEqual({
      configuredSourceId: SOURCE_ID,
      nativeAgentId: 'writer',
      nativeContextId: 'agent:writer:main',
    });
    for (const suffix of ['2', '3', '4']) {
      expect(
        contextById(snapshot, `agent:writer:subagent:invented-spawn-${suffix}`)
          .parent
      ).toBeNull();
    }
  });

  it('never copies workspace, model, path, or label into the snapshot', () => {
    const snapshot = adapted(adaptOpenClawTopology(realisticInput()));
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('/');
    expect(serialized).not.toContain('invented-model');
    expect(serialized).not.toContain('workspace');
    expect(serialized).not.toContain('nightly-sweep');
    expect(serialized).not.toContain('invented-runtime');
  });
});

describe('adaptOpenClawTopology bounds', () => {
  it('caps the roster at 500 Agents', () => {
    const agents = Array.from({ length: 512 }, (_unused, index) =>
      agentEntry(`agent-${String(index).padStart(4, '0')}`)
    );
    const result = adaptOpenClawTopology(
      input({ agentsList: { agents }, retiredNativeAgentIds: ['researcher'] })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toContain('agent-cap-exceeded');
    expect(snapshot.agents).toHaveLength(500);
    expect(
      snapshot.agents.every(agent => agent.discoveryState === 'configured')
    ).toBe(true);
  });

  it('caps one Agent at 2000 contexts, keeping main and the most recent', () => {
    const sessions = [
      sessionEntry('agent:writer:main', { updatedAt: 1 }),
      ...Array.from({ length: 2_400 }, (_unused, index) =>
        sessionEntry(
          `agent:writer:helper-thread-${String(index).padStart(4, '0')}`,
          { updatedAt: OBSERVED_AT - index * MINUTE_MS }
        )
      ),
    ];
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          { nativeAgentId: 'writer', payload: sessionsPayload(sessions) },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toContain('context-cap-exceeded');
    expect(snapshot.contexts).toHaveLength(2_000);
    // The stalest context in the source is the main one; it survives anyway.
    expect(contextById(snapshot, 'agent:writer:main').roles).toEqual([
      'primary-conversation',
    ]);
    // Eviction takes the least recently active helpers.
    expect(
      snapshot.contexts.some(
        context => context.nativeContextId === 'agent:writer:helper-thread-2399'
      )
    ).toBe(false);
  });

  it('caps the whole snapshot at 20000 contexts while keeping every main', () => {
    const agentIds = Array.from(
      { length: 11 },
      (_unused, index) => `agent-${String(index).padStart(2, '0')}`
    );
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: agentIds.map(id => agentEntry(id)) },
        sessionLists: agentIds.map((id, agentIndex) => ({
          nativeAgentId: id,
          payload: sessionsPayload([
            sessionEntry(`agent:${id}:main`, { updatedAt: 1 }),
            ...Array.from({ length: 1_999 }, (_unused, index) =>
              sessionEntry(
                `agent:${id}:helper-${String(index).padStart(4, '0')}`,
                { updatedAt: OBSERVED_AT - (agentIndex * 10_000 + index) }
              )
            ),
          ]),
        })),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toContain('context-cap-exceeded');
    expect(snapshot.contexts).toHaveLength(20_000);
    expect(
      snapshot.contexts.filter(context => context.kind === 'main')
    ).toHaveLength(11);
  });
});

describe('adaptOpenClawTopology failure modes', () => {
  it('fails closed when the Agent listing is not shaped like a listing', () => {
    for (const agentsList of [null, undefined, [], 'agents', { agents: {} }]) {
      const result = adaptOpenClawTopology(input({ agentsList }));
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(['invalid-agents-payload']);
    }
  });

  it('fails closed when no Agent survives validation', () => {
    const result = adaptOpenClawTopology(
      input({ agentsList: { agents: [{ name: 'nameless' }] } })
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('invalid-agents-payload');
  });

  it('fails closed when the configured source identity is unusable', () => {
    const result = adaptOpenClawTopology(
      input({
        configuredSourceId: '  ',
        agentsList: { agents: [agentEntry('alpha')] },
      })
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['invalid-source-identity']);
  });

  it('degrades rather than failing when the session listings are malformed', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('alpha')] },
        sessionLists:
          'nope' as unknown as OpenClawTopologyInput['sessionLists'],
      })
    );
    expect(adapted(result).contexts).toEqual([]);
    expect(codes(result)).toEqual(['invalid-sessions-payload']);
  });
});

describe('adaptOpenClawTopology determinism', () => {
  function shuffled<T>(values: readonly T[], seed: number): T[] {
    // Deterministic reordering: no clock, no Math.random, so the test itself
    // stays reproducible while still exercising a different input order.
    return [...values]
      .map((value, index) => ({
        value,
        rank: (index * 7 + seed) % values.length,
      }))
      .sort((left, right) => left.rank - right.rank)
      .map(entry => entry.value);
  }

  it('produces identical output regardless of input order', () => {
    const base = realisticInput();
    const baseAgents = (base.agentsList as { agents: unknown[] }).agents;
    const reordered: OpenClawTopologyInput = {
      ...base,
      agentsList: {
        ...(base.agentsList as Record<string, unknown>),
        agents: shuffled(baseAgents, 3),
      },
      sessionLists: shuffled(base.sessionLists, 5).map(entry => ({
        nativeAgentId: entry.nativeAgentId,
        payload: {
          ...(entry.payload as Record<string, unknown>),
          sessions: shuffled(
            (entry.payload as { sessions: unknown[] }).sessions,
            2
          ),
        },
      })),
    };

    const first = adaptOpenClawTopology(base);
    const second = adaptOpenClawTopology(reordered);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('sorts issues by path', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [
            agentEntry('writer'),
            agentEntry('writer'),
            { name: 'nameless' },
          ],
        },
        sessionLists: [
          {
            nativeAgentId: 'ghost',
            payload: sessionsPayload([sessionEntry('agent:ghost:main')]),
          },
        ],
      })
    );
    const paths = result.issues.map(
      (issue: OpenClawTopologyIssue) => issue.path
    );
    expect(paths).toEqual([...paths].sort());
    expect(paths.length).toBeGreaterThan(2);
  });
});

describe('adaptOpenClawTopology feeds the projection kernel', () => {
  it('produces a snapshot the projection kernel accepts', () => {
    const snapshot = adapted(adaptOpenClawTopology(realisticInput()));
    const projection = projectAgentTopology([snapshot], planFor(snapshot));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(projection.projection.agents).toHaveLength(2);
    const alpha = projection.projection.agents.find(
      agent => agent.nativeAgentId === 'alpha'
    );
    expect(alpha?.primaryConversation?.nativeContextId).toBe(
      'agent:alpha:main'
    );
    const writer = projection.projection.agents.find(
      agent => agent.nativeAgentId === 'writer'
    );
    expect(writer?.primaryConversation).toBeNull();
    expect(writer?.contexts).toHaveLength(2);
  });

  it('still projects when the payload is full of degradations', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [
            agentEntry('alpha', { identityName: 'Alpha Rivera' }),
            agentEntry('alpha'),
            { name: 'nameless' },
            agentEntry('scheduler'),
          ],
        },
        retiredNativeAgentIds: ['researcher'],
        sessionLists: [
          {
            nativeAgentId: 'alpha',
            payload: sessionsPayload([
              sessionEntry('agent:alpha:main'),
              sessionEntry('agent:writer:main'),
              { key: 'not-addressable' },
            ]),
          },
          {
            nativeAgentId: 'scheduler',
            payload: sessionsPayload([
              sessionEntry('agent:scheduler:cron:invented-job-1'),
            ]),
          },
          {
            nativeAgentId: 'ghost',
            payload: sessionsPayload([sessionEntry('agent:ghost:main')]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(result.issues.length).toBeGreaterThan(3);
    const projection = projectAgentTopology([snapshot], planFor(snapshot));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(
      projection.projection.agents.map(agent => agent.nativeAgentId).sort()
    ).toEqual(['alpha', 'researcher', 'scheduler']);
  });
});
