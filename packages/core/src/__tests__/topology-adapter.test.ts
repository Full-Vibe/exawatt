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
            hasActiveRun: false,
          }),
          sessionEntry('agent:alpha:channel:invented-channel-1'),
          sessionEntry('agent:alpha:subagent:invented-spawn-1', {
            hasActiveRun: true,
          }),
        ]),
      },
      {
        nativeAgentId: 'writer',
        payload: sessionsPayload([
          sessionEntry('agent:writer:cron:invented-job-1', {
            label: 'Cron: nightly-sweep',
            hasActiveRun: false,
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

  it('carries the run signal, and reads anything unreadable as unknown', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:main', { hasActiveRun: true }),
              sessionEntry('agent:writer:cron:invented-job-1', {
                hasActiveRun: false,
              }),
              // Said nothing.
              sessionEntry('agent:writer:cron:invented-job-2'),
              // Said something unusable. Truthiness is never accepted.
              sessionEntry('agent:writer:cron:invented-job-3', {
                hasActiveRun: 'running',
              }),
              sessionEntry('agent:writer:cron:invented-job-4', {
                hasActiveRun: 1,
              }),
              sessionEntry('agent:writer:cron:invented-job-5', {
                hasActiveRun: null,
              }),
            ]),
          },
        ],
      })
    );
    const snapshot = adapted(result);
    expect(contextById(snapshot, 'agent:writer:main').hasActiveRun).toBe(true);
    expect(
      contextById(snapshot, 'agent:writer:cron:invented-job-1').hasActiveRun
    ).toBe(false);
    for (const suffix of ['2', '3', '4', '5']) {
      expect(
        contextById(snapshot, `agent:writer:cron:invented-job-${suffix}`)
          .hasActiveRun
      ).toBeUndefined();
    }
    // An unreadable run signal costs the fact, never the context, and is not
    // a payload fault worth telling the operator about.
    expect(codes(result)).toEqual([]);
    expect(snapshot.contexts).toHaveLength(6);
  });

  it('hands the kernel a run signal it accepts and reads as work', () => {
    const snapshot = adapted(adaptOpenClawTopology(realisticInput()));
    const projection = projectAgentTopology([snapshot], planFor(snapshot));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    const byNative = new Map(
      projection.projection.agents.map(agent => [agent.nativeAgentId, agent])
    );
    // One spawned context is mid-run; the conversation is not. The coworker
    // is working either way.
    expect(byNative.get('alpha')?.hasActiveRun).toBe(true);
    // Nothing writer owns is running, and its helper reported nothing at all.
    expect(byNative.get('writer')?.hasActiveRun).toBe(false);
    expect(
      contextById(snapshot, 'agent:writer:helper-thread-invented-4')
        .hasActiveRun
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

  it('keeps the run signal on every context that survives the cap', () => {
    const sessions = [
      // The stalest context in the source, and mid-run: main survives the cap
      // on identity alone, and its work fact must survive with it.
      sessionEntry('agent:writer:main', { updatedAt: 1, hasActiveRun: true }),
      ...Array.from({ length: 2_400 }, (_unused, index) =>
        sessionEntry(
          `agent:writer:helper-thread-${String(index).padStart(4, '0')}`,
          {
            updatedAt: OBSERVED_AT - index * MINUTE_MS,
            // Only the freshest helper is running, and only the stalest
            // helpers are evicted, so eviction cannot silence the signal.
            hasActiveRun: index === 0,
          }
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
    expect(snapshot.contexts).toHaveLength(2_000);
    expect(contextById(snapshot, 'agent:writer:main').hasActiveRun).toBe(true);
    expect(
      contextById(snapshot, 'agent:writer:helper-thread-0000').hasActiveRun
    ).toBe(true);
    expect(
      contextById(snapshot, 'agent:writer:helper-thread-1998').hasActiveRun
    ).toBe(false);
    const projection = projectAgentTopology([snapshot], planFor(snapshot));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(projection.projection.agents[0]?.hasActiveRun).toBe(true);
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
    // Reordering the payload cannot move which context is reported running.
    expect(
      adapted(second)
        .contexts.filter(context => context.hasActiveRun === true)
        .map(context => context.nativeContextId)
    ).toEqual(['agent:alpha:subagent:invented-spawn-1']);
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

/**
 * One `cron.list` job as a live Gateway shapes it: identity and ownership on
 * the entry, run state nested under `state`.
 */
function cronJob(
  name: string,
  agentId: string,
  state: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name,
    agentId,
    enabled: true,
    schedule: '0 * * * *',
    prompt: 'Sweep the invented queue and report.',
    state: {
      lastRunAtMs: OBSERVED_AT - 10 * MINUTE_MS,
      lastStatus: 'ok',
      nextRunAtMs: OBSERVED_AT + 50 * MINUTE_MS,
      delivery: 'session',
      ...state,
    },
    ...overrides,
  };
}

function cronPayload(jobs: readonly unknown[]): Record<string, unknown> {
  return { ts: OBSERVED_AT, count: jobs.length, jobs };
}

function statusPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    runtimeVersion: '0.0.0-invented',
    agents: [{ id: 'writer', heartbeat: { everyMs: 900_000 } }],
    tasks: {
      total: 12,
      active: 1,
      terminal: 11,
      failures: 2,
      byStatus: { running: 1, succeeded: 9, failed: 2 },
      byRuntime: { cron: 10, subagent: 2 },
      ...overrides,
    },
    taskAudit: { warnings: 3, errors: 1 },
  };
}

function automations(
  snapshot: AgentSourceTopologySnapshot
): NonNullable<AgentSourceTopologySnapshot['automations']> {
  return snapshot.automations ?? [];
}

describe('adaptOpenClawTopology automations', () => {
  it('carries an observed automation fault and nothing about its configuration', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:cron:invented-job-1'),
            ]),
          },
        ],
        cronList: cronPayload([
          cronJob('invented-nightly', 'writer', {
            lastStatus: 'error',
            sessionTarget: 'agent:writer:cron:invented-job-1',
          }),
        ]),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual([]);
    expect(automations(snapshot)).toEqual([
      {
        configuredSourceId: SOURCE_ID,
        nativeAgentId: 'writer',
        nativeAutomationId: 'invented-nightly',
        enabled: true,
        lastOutcome: 'failed',
        lastRunAt: OBSERVED_AT - 10 * MINUTE_MS,
        targetContextId: 'agent:writer:cron:invented-job-1',
      },
    ]);
    // Schedule, prompt, and delivery are configuration, not evidence.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('0 * * * *');
    expect(serialized).not.toContain('Sweep the invented queue');
    expect(serialized).not.toContain('delivery');
    expect(serialized).not.toContain('nextRun');
  });

  it('separates never asked from asked and empty', () => {
    const base = {
      agentsList: { agents: [agentEntry('writer')] },
      sessionLists: [],
    };
    expect(
      adapted(adaptOpenClawTopology(input(base))).automations
    ).toBeUndefined();
    expect(
      adapted(
        adaptOpenClawTopology(input({ ...base, cronList: cronPayload([]) }))
      ).automations
    ).toEqual([]);
  });

  it('reads only outcome words it knows, and never guesses at the rest', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        cronList: cronPayload([
          cronJob('invented-a', 'writer', { lastStatus: 'ok' }),
          cronJob('invented-b', 'writer', { lastStatus: 'success' }),
          cronJob('invented-c', 'writer', { lastStatus: 'error' }),
          cronJob('invented-d', 'writer', { lastStatus: 'failed' }),
          // Words this build does not know, in every unusable shape.
          cronJob('invented-e', 'writer', { lastStatus: 'running' }),
          cronJob('invented-f', 'writer', { lastStatus: 'catastrophe' }),
          cronJob('invented-g', 'writer', { lastStatus: '' }),
          cronJob('invented-h', 'writer', { lastStatus: 1 }),
          cronJob('invented-i', 'writer', { lastStatus: undefined }),
        ]),
      })
    );
    const snapshot = adapted(result);
    const outcomes = Object.fromEntries(
      automations(snapshot).map(entry => [
        entry.nativeAutomationId,
        entry.lastOutcome,
      ])
    );
    expect(outcomes['invented-a']).toBe('succeeded');
    expect(outcomes['invented-b']).toBe('succeeded');
    expect(outcomes['invented-c']).toBe('failed');
    expect(outcomes['invented-d']).toBe('failed');
    // Unknown never becomes healthy, and never becomes a fault either.
    for (const suffix of ['e', 'f', 'g', 'h', 'i']) {
      expect(outcomes[`invented-${suffix}`]).toBeUndefined();
    }
    expect(codes(result)).toEqual([]);
  });

  it('leaves enablement unknown rather than defaulting it', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        cronList: cronPayload([
          cronJob('invented-on', 'writer', {}, { enabled: true }),
          cronJob('invented-off', 'writer', {}, { enabled: false }),
          cronJob('invented-silent', 'writer', {}, { enabled: undefined }),
          cronJob('invented-truthy', 'writer', {}, { enabled: 'yes' }),
        ]),
      })
    );
    const enabled = Object.fromEntries(
      automations(adapted(result)).map(entry => [
        entry.nativeAutomationId,
        entry.enabled,
      ])
    );
    expect(enabled['invented-on']).toBe(true);
    expect(enabled['invented-off']).toBe(false);
    expect(enabled['invented-silent']).toBeUndefined();
    expect(enabled['invented-truthy']).toBeUndefined();
  });

  it('reads run state whether the Gateway nests it or flattens it', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        cronList: cronPayload([
          {
            name: 'invented-flat',
            agentId: 'writer',
            enabled: true,
            lastStatus: 'failed',
            lastRunAtMs: OBSERVED_AT - MINUTE_MS,
          },
        ]),
      })
    );
    expect(automations(adapted(result))[0]).toMatchObject({
      lastOutcome: 'failed',
      lastRunAt: OBSERVED_AT - MINUTE_MS,
    });
  });

  it('never lets an automation conjure the Agent it names', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        cronList: cronPayload([
          cronJob('invented-job', 'ghost', { lastStatus: 'error' }),
          cronJob('invented-kept', 'writer'),
        ]),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['orphan-automation-agent']);
    expect(snapshot.agents.map(entry => entry.nativeAgentId)).toEqual([
      'writer',
    ]);
    expect(
      automations(snapshot).map(entry => entry.nativeAutomationId)
    ).toEqual(['invented-kept']);
  });

  it('never lets an automation attach to a retired Agent', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        retiredNativeAgentIds: ['researcher'],
        cronList: cronPayload([
          cronJob('invented-job', 'researcher', { lastStatus: 'error' }),
        ]),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['orphan-automation-agent']);
    expect(automations(snapshot)).toEqual([]);
  });

  it('drops automation entries with no usable identity or owner', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        cronList: cronPayload([
          cronJob('invented-kept', 'writer'),
          'not-a-record',
          { agentId: 'writer' },
          { name: 'invented-ownerless' },
          { name: '   ', agentId: 'writer' },
          { name: 'invented-bad-owner', agentId: 42 },
          // An identity longer than the kernel's own bound: dropped here so it
          // can never be handed downstream and rejected there.
          { name: 'x'.repeat(4_097), agentId: 'writer' },
          { name: 'invented-long-owner', agentId: 'y'.repeat(4_097) },
        ]),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(
      Array.from({ length: 7 }, () => 'invalid-cron-entry')
    );
    expect(automations(snapshot)).toHaveLength(1);
  });

  it('keeps the first of two identical automation names, per Agent', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [agentEntry('writer'), agentEntry('alpha')],
        },
        cronList: cronPayload([
          cronJob('invented-shared', 'writer', { lastStatus: 'ok' }),
          cronJob('invented-shared', 'writer', { lastStatus: 'error' }),
          cronJob('invented-shared', 'alpha', { lastStatus: 'error' }),
        ]),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toEqual(['duplicate-automation']);
    expect(
      automations(snapshot).map(entry => [
        entry.nativeAgentId,
        entry.lastOutcome,
      ])
    ).toEqual([
      ['alpha', 'failed'],
      ['writer', 'succeeded'],
    ]);
  });

  it('resolves an automation target only inside the same Agent', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: {
          agents: [agentEntry('writer'), agentEntry('alpha')],
        },
        sessionLists: [
          {
            nativeAgentId: 'writer',
            payload: sessionsPayload([
              sessionEntry('agent:writer:cron:invented-job-1'),
            ]),
          },
          {
            nativeAgentId: 'alpha',
            payload: sessionsPayload([sessionEntry('agent:alpha:main')]),
          },
        ],
        cronList: cronPayload([
          cronJob('invented-own', 'writer', {
            sessionTarget: 'agent:writer:cron:invented-job-1',
          }),
          cronJob('invented-foreign', 'writer', {
            sessionTarget: 'agent:alpha:main',
          }),
          cronJob('invented-vanished', 'writer', {
            sessionTarget: 'agent:writer:cron:invented-gone',
          }),
          cronJob('invented-unaddressable', 'writer', {
            sessionTarget: 'writer-main',
          }),
          cronJob('invented-silent', 'writer', { sessionTarget: undefined }),
        ]),
      })
    );
    const snapshot = adapted(result);
    const targets = Object.fromEntries(
      automations(snapshot).map(entry => [
        entry.nativeAutomationId,
        entry.targetContextId,
      ])
    );
    expect(targets['invented-own']).toBe('agent:writer:cron:invented-job-1');
    for (const suffix of ['foreign', 'vanished', 'unaddressable', 'silent']) {
      expect(targets[`invented-${suffix}`]).toBeNull();
    }
  });

  it('degrades rather than failing when the automation listing is malformed', () => {
    for (const cronList of [null, 'jobs', { jobs: {} }, []]) {
      const result = adaptOpenClawTopology(
        input({
          agentsList: { agents: [agentEntry('writer')] },
          cronList,
        })
      );
      const snapshot = adapted(result);
      expect(codes(result)).toEqual(['invalid-cron-payload']);
      // A payload Exawatt cannot read leaves automations unknown, never empty.
      expect(snapshot.automations).toBeUndefined();
    }
  });

  it('caps automations without evicting the evidence', () => {
    const jobs = [
      ...Array.from({ length: 2_400 }, (_unused, index) =>
        cronJob(`invented-bulk-${String(index).padStart(4, '0')}`, 'writer', {
          lastRunAtMs: OBSERVED_AT - index * MINUTE_MS,
        })
      ),
      // Oldest run of the lot, and the only fault: it must survive anyway.
      cronJob('invented-fault', 'writer', {
        lastStatus: 'failed',
        lastRunAtMs: 1,
      }),
    ];
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        cronList: cronPayload(jobs),
      })
    );
    const snapshot = adapted(result);
    expect(codes(result)).toContain('automation-cap-exceeded');
    expect(automations(snapshot)).toHaveLength(2_000);
    expect(
      automations(snapshot).find(
        entry => entry.nativeAutomationId === 'invented-fault'
      )?.lastOutcome
    ).toBe('failed');
  });
});

describe('adaptOpenClawTopology source-wide task totals', () => {
  it('carries the totals the source reports about itself', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        statusPayload: statusPayload(),
      })
    );
    expect(adapted(result).taskFacts).toEqual({
      total: 12,
      active: 1,
      terminal: 11,
      failures: 2,
      byStatus: { running: 1, succeeded: 9, failed: 2 },
      byRuntime: { subagent: 2, cron: 10 },
      auditWarnings: 3,
      auditErrors: 1,
    });
    expect(codes(result)).toEqual([]);
  });

  it('keeps only buckets it knows and counts it can vouch for', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        statusPayload: statusPayload({
          byStatus: { succeeded: 9, invented: 3, failed: -1, lost: 1.5 },
          byRuntime: { cli: 4, invented: 'many' },
        }),
      })
    );
    expect(adapted(result).taskFacts).toMatchObject({
      byStatus: { succeeded: 9 },
      byRuntime: { cli: 4 },
    });
  });

  it('leaves the totals unknown when the source reports none it can vouch for', () => {
    for (const payload of [
      null,
      'status',
      {},
      { tasks: { total: 4 } },
      { tasks: { total: -1, active: 0, terminal: 0, failures: 0 } },
      { tasks: { total: 1.5, active: 0, terminal: 0, failures: 0 } },
    ]) {
      const result = adaptOpenClawTopology(
        input({
          agentsList: { agents: [agentEntry('writer')] },
          statusPayload: payload,
        })
      );
      const snapshot = adapted(result);
      expect(codes(result)).toEqual(['invalid-status-payload']);
      expect(snapshot.taskFacts).toBeUndefined();
    }
  });

  it('separates never asked from asked and unreadable', () => {
    const result = adaptOpenClawTopology(
      input({ agentsList: { agents: [agentEntry('writer')] } })
    );
    expect(adapted(result).taskFacts).toBeUndefined();
    expect(codes(result)).toEqual([]);
  });

  it('never copies the runtime version or heartbeat configuration', () => {
    const result = adaptOpenClawTopology(
      input({
        agentsList: { agents: [agentEntry('writer')] },
        statusPayload: statusPayload(),
      })
    );
    const serialized = JSON.stringify(adapted(result));
    expect(serialized).not.toContain('0.0.0-invented');
    expect(serialized).not.toContain('heartbeat');
  });
});

describe('adaptOpenClawTopology work-state evidence reaches the kernel', () => {
  /** The realistic Gateway, plus the automation and status reads. */
  function fullInput(): OpenClawTopologyInput {
    return input({
      ...realisticInput(),
      cronList: cronPayload([
        cronJob('invented-alpha-sweep', 'alpha', { lastStatus: 'ok' }),
        cronJob('invented-writer-nightly', 'writer', {
          lastStatus: 'error',
          sessionTarget: 'agent:writer:cron:invented-job-1',
        }),
      ]),
      statusPayload: statusPayload(),
    });
  }

  it('derives working, error, and nothing else from a whole observation', () => {
    const snapshot = adapted(adaptOpenClawTopology(fullInput()));
    const projection = projectAgentTopology([snapshot], planFor(snapshot));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    const byNative = new Map(
      projection.projection.agents.map(agent => [agent.nativeAgentId, agent])
    );
    // A spawned context of alpha's is mid-run and its automation is healthy.
    expect(byNative.get('alpha')?.workState).toBe('working');
    expect(byNative.get('alpha')?.hasActiveRun).toBe(true);
    // Nothing writer owns is running and its scheduled job last failed.
    expect(byNative.get('writer')?.workState).toBe('error');
    expect(byNative.get('writer')?.hasActiveRun).toBe(false);
    expect(byNative.get('writer')?.automations).toEqual([
      {
        configuredSourceId: SOURCE_ID,
        nativeAgentId: 'writer',
        nativeAutomationId: 'invented-writer-nightly',
        enabled: true,
        lastOutcome: 'failed',
        lastRunAt: OBSERVED_AT - 10 * MINUTE_MS,
        targetContextId: 'agent:writer:cron:invented-job-1',
      },
    ]);
  });

  it('leaves the run signal exactly as it was before automations existed', () => {
    const withAutomations = adapted(adaptOpenClawTopology(fullInput()));
    const withoutAutomations = adapted(adaptOpenClawTopology(realisticInput()));
    expect(withAutomations.contexts).toEqual(withoutAutomations.contexts);
  });

  it('produces identical output regardless of automation and bucket order', () => {
    const base = fullInput();
    const jobs = (base.cronList as { jobs: unknown[] }).jobs;
    const reordered: OpenClawTopologyInput = {
      ...base,
      cronList: { ...(base.cronList as object), jobs: [...jobs].reverse() },
      statusPayload: statusPayload({
        byStatus: { failed: 2, succeeded: 9, running: 1 },
        byRuntime: { subagent: 2, cron: 10 },
      }),
    };
    const first = adaptOpenClawTopology(base);
    const second = adaptOpenClawTopology(reordered);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
