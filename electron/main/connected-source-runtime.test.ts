import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_PROJECTION_VERSION,
  sessionStatus,
  type AgentSourceTopologySnapshot,
  type ConnectedSourceRecord,
  type ConnectionStatus,
  type SourceContextRecord,
} from '@exawatt/core';
import {
  ConnectedSourceRuntime,
  EMPTY_PROJECTION_PLAN,
  deriveRemoteAgentId,
  type ConnectedAgentProjectionPlan,
  type ConnectedAgentProjectionPlanStore,
  type ConnectedSourceSession,
} from './connected-source-runtime';
import type { ConnectedGatewayPhase } from './connected-gateway';

/**
 * ENG-010 C2. The runtime that owns every configured source.
 *
 * Everything here is hermetic by construction: the session is a double, so no
 * test in this file can open a tunnel, read the operator's SSH configuration,
 * resolve a credential, or reach a network. Nothing below names a host, an
 * address, a user, a key, or a real server; the sources are `alpha` and
 * `beta`, and the coworkers are invented.
 */

/* ---- Fixtures ------------------------------------------------------------ */

interface AgentSpec {
  nativeAgentId: string;
  displayName: string;
  discoveryState?: 'configured' | 'retired' | 'unknown';
  /** A source that declares no primary conversation opens on its work. */
  primary?: boolean;
  helpers?: number;
  /** Which context the source reports mid-run; absent means it reported none. */
  running?: 'main' | 'helper';
}

function contextsFor(
  configuredSourceId: string,
  spec: AgentSpec
): SourceContextRecord[] {
  const contexts: SourceContextRecord[] = [];
  if (spec.primary !== false) {
    contexts.push({
      configuredSourceId,
      nativeAgentId: spec.nativeAgentId,
      nativeContextId: `agent:${spec.nativeAgentId}:main`,
      kind: 'main',
      nativeKind: 'main',
      parent: null,
      roles: ['primary-conversation'],
      nativeRunId: null,
      hasActiveRun: spec.running === 'main',
      createdAt: 1_000,
      lastActiveAt: 5_000,
    });
  }
  for (let index = 0; index < (spec.helpers ?? 0); index += 1) {
    contexts.push({
      configuredSourceId,
      nativeAgentId: spec.nativeAgentId,
      nativeContextId: `agent:${spec.nativeAgentId}:helper:${index}`,
      kind: 'helper',
      nativeKind: 'helper',
      parent: null,
      roles: [],
      nativeRunId: null,
      hasActiveRun: spec.running === 'helper' && index === 0,
      createdAt: 2_000,
      lastActiveAt: 6_000,
    });
  }
  return contexts;
}

function snapshot(
  configuredSourceId: string,
  specs: readonly AgentSpec[],
  observedAt = 10_000
): AgentSourceTopologySnapshot {
  return {
    configuredSourceId,
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    gatewayId: configuredSourceId,
    observedAt,
    evidenceBasis: 'observed',
    agents: specs.map(spec => ({
      configuredSourceId,
      nativeAgentId: spec.nativeAgentId,
      displayName: spec.displayName,
      discoveryState: spec.discoveryState ?? 'configured',
    })),
    contexts: specs.flatMap(spec => contextsFor(configuredSourceId, spec)),
  };
}

function record(
  id: string,
  overrides: Partial<ConnectedSourceRecord> = {}
): ConnectedSourceRecord {
  return {
    id,
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    displayName: `Source ${id}`,
    transport: { kind: 'ssh-alias', alias: `alias-${id}`, remotePort: 1337 },
    credentialOwner: 'source-owned-ssh',
    hasDeviceCredential: true,
    createdAt: 1,
    ...overrides,
  };
}

const LIVE_STATUS: ConnectionStatus = {
  state: 'live',
  observationAgeMs: 0,
  stalePresentation: false,
  failure: null,
};

/* ---- Doubles ------------------------------------------------------------- */

class MemoryPlanStore implements ConnectedAgentProjectionPlanStore {
  plan: ConnectedAgentProjectionPlan = EMPTY_PROJECTION_PLAN;
  writes = 0;

  read(): ConnectedAgentProjectionPlan {
    // A fresh structure per read, exactly like the file store, so a caller
    // that mutates what it got cannot corrupt the plan behind everyone else.
    return {
      projectionVersion: this.plan.projectionVersion,
      mappings: this.plan.mappings.map(mapping => ({ ...mapping })),
    };
  }

  write(plan: ConnectedAgentProjectionPlan): void {
    this.writes += 1;
    this.plan = {
      projectionVersion: plan.projectionVersion,
      mappings: plan.mappings.map(mapping => ({ ...mapping })),
    };
  }
}

interface SessionScript {
  /** Snapshot handed back per `connect()` call, in order. */
  snapshots?: AgentSourceTopologySnapshot[];
  failure?: { failure: 'host-unreachable' | 'gateway-down'; message: string };
  status?: ConnectionStatus;
}

class FakeSession implements ConnectedSourceSession {
  snapshot: AgentSourceTopologySnapshot | null = null;
  phase: ConnectedGatewayPhase = 'idle';
  identityDrift: null = null;
  disconnectCalls = 0;
  connectCalls = 0;
  private readonly script: SessionScript;
  private readonly phaseListeners = new Set<
    (phase: ConnectedGatewayPhase) => void
  >();
  private currentStatus: ConnectionStatus;

  constructor(script: SessionScript) {
    this.script = script;
    this.currentStatus = script.status ?? {
      state: 'unavailable',
      observationAgeMs: null,
      stalePresentation: true,
      failure: null,
    };
  }

  connect = vi.fn(async () => {
    this.connectCalls += 1;
    if (this.script.failure) {
      this.phase = 'failed';
      return {
        ok: false as const,
        outcome: 'failed' as const,
        failure: this.script.failure.failure,
        message: this.script.failure.message,
      };
    }
    const next =
      this.script.snapshots?.[
        Math.min(this.connectCalls - 1, (this.script.snapshots.length ?? 1) - 1)
      ] ?? null;
    if (!next) throw new Error('FakeSession has no snapshot scripted');
    this.snapshot = next;
    this.phase = 'connected';
    this.currentStatus = this.script.status ?? LIVE_STATUS;
    return {
      ok: true as const,
      outcome: 'connected' as const,
      snapshot: next,
      identity: { version: '', nativeAgentIds: [] },
      facts: {
        version: '',
        configuredAgentCount: next.agents.length,
        automationCount: 0,
        observedAt: next.observedAt,
      },
      issues: [],
    };
  });

  resnapshot = vi.fn(async () => this.connect());

  status = vi.fn((): ConnectionStatus => this.currentStatus);

  disconnect = vi.fn(async () => {
    this.disconnectCalls += 1;
    this.phase = 'idle';
    this.currentStatus = {
      state: 'unavailable',
      observationAgeMs: this.currentStatus.observationAgeMs,
      stalePresentation: true,
      failure: null,
    };
  });

  onPhaseChange = vi.fn((listener: (phase: ConnectedGatewayPhase) => void) => {
    this.phaseListeners.add(listener);
    return () => this.phaseListeners.delete(listener);
  });

  setStatus(status: ConnectionStatus): void {
    this.currentStatus = status;
  }

  emitPhase(phase: ConnectedGatewayPhase): void {
    this.phase = phase;
    for (const listener of this.phaseListeners) listener(phase);
  }
}

interface Harness {
  runtime: ConnectedSourceRuntime;
  plans: MemoryPlanStore;
  sessions: Map<string, FakeSession>;
  records: ConnectedSourceRecord[];
}

function harness(
  scripts: Record<string, SessionScript>,
  records = Object.keys(scripts).map(id => record(id))
): Harness {
  const plans = new MemoryPlanStore();
  const sessions = new Map<string, FakeSession>();
  const runtime = new ConnectedSourceRuntime({
    store: {
      list: () => records,
      get: (id: string) => records.find(entry => entry.id === id) ?? null,
    },
    plans,
    createSession: source => {
      const session = new FakeSession(scripts[source.id] ?? {});
      sessions.set(source.id, session);
      return session;
    },
    now: () => 20_000,
  });
  return { runtime, plans, sessions, records };
}

/** Map every discovered Agent of one source into one Project. */
async function mapAll(
  runtime: ConnectedSourceRuntime,
  sourceId: string,
  agents: readonly { nativeAgentId: string }[],
  projectId = `project-${sourceId}`
) {
  return runtime.mapAgents(
    sourceId,
    agents.map(agent => ({
      nativeAgentId: agent.nativeAgentId,
      projectId,
      projectLabel: 'Field Work',
    }))
  );
}

/* ---- Tests --------------------------------------------------------------- */

describe('ConnectedSourceRuntime — many sources at once', () => {
  it('observes every configured source and projects all of their coworkers', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', helpers: 2 },
            { nativeAgentId: 'reddit', displayName: 'reddit-poster' },
          ]),
        ],
      },
      beta: {
        snapshots: [
          snapshot('beta', [
            { nativeAgentId: 'tyler', displayName: 'Tyler', primary: false },
          ]),
        ],
      },
    });

    const alpha = await runtime.connect('alpha');
    const beta = await runtime.connect('beta');
    expect(alpha.ok).toBe(true);
    expect(beta.ok).toBe(true);
    if (!alpha.ok || !beta.ok) return;

    await mapAll(runtime, 'alpha', alpha.agents);
    await mapAll(runtime, 'beta', beta.agents);

    const agents = runtime.agents();
    expect(agents).toHaveLength(3);
    expect(agents.map(agent => agent.displayName).sort()).toEqual([
      'Tyler',
      'reddit-poster',
      'scout',
    ]);
    // Two coworkers on one Gateway stay two coworkers.
    expect(agents.filter(agent => agent.source.id === 'alpha')).toHaveLength(2);
    expect(sessions.size).toBe(2);
  });

  it('reports discovery detail the Connect flow needs, including an absent primary conversation', async () => {
    const { runtime } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', helpers: 3 },
            {
              nativeAgentId: 'priya',
              displayName: 'priya',
              discoveryState: 'retired',
            },
            {
              nativeAgentId: 'tyler',
              displayName: 'Tyler',
              primary: false,
              helpers: 1,
            },
          ]),
        ],
      },
    });

    const result = await runtime.connect('alpha');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byId = new Map(
      result.agents.map(agent => [agent.nativeAgentId, agent])
    );
    expect(byId.get('scout')).toMatchObject({
      displayName: 'scout',
      discoveryState: 'configured',
      contextCount: 4,
      hasPrimaryConversation: true,
      mapping: null,
    });
    // Retired identities are offered separately, never silently imported.
    expect(byId.get('priya')?.discoveryState).toBe('retired');
    expect(byId.get('tyler')?.hasPrimaryConversation).toBe(false);
    // Nothing is in the roster until the operator maps it.
    expect(runtime.agents()).toHaveLength(0);
  });
});

describe('ConnectedSourceRuntime — one source failing', () => {
  it('leaves every other source observed and projected', async () => {
    const { runtime } = harness({
      alpha: {
        failure: {
          failure: 'host-unreachable',
          message: 'Exawatt could not reach this server.',
        },
      },
      beta: {
        snapshots: [
          snapshot('beta', [{ nativeAgentId: 'tyler', displayName: 'Tyler' }]),
        ],
      },
    });

    const alpha = await runtime.connect('alpha');
    expect(alpha.ok).toBe(false);
    if (alpha.ok) return;
    expect(alpha.outcome).toBe('failed');
    expect(alpha.failure).toBe('host-unreachable');

    const beta = await runtime.connect('beta');
    expect(beta.ok).toBe(true);
    if (!beta.ok) return;
    await mapAll(runtime, 'beta', beta.agents);

    expect(runtime.agents().map(agent => agent.displayName)).toEqual(['Tyler']);

    const statuses = new Map(runtime.status().map(row => [row.sourceId, row]));
    expect(statuses.get('alpha')?.connection.state).toBe('unavailable');
    expect(statuses.get('beta')?.connection.state).toBe('live');
  });

  it('resumes only the sources the operator already authorized, and one failure never blocks another', async () => {
    const records = [
      record('alpha'),
      record('beta'),
      // Saved but never paired: reaching it would be Exawatt's decision.
      record('gamma', { hasDeviceCredential: false }),
    ];
    const { runtime, sessions } = harness(
      {
        alpha: {
          failure: { failure: 'gateway-down', message: 'No answer.' },
        },
        beta: {
          snapshots: [
            snapshot('beta', [
              { nativeAgentId: 'tyler', displayName: 'Tyler' },
            ]),
          ],
        },
        gamma: {
          snapshots: [
            snapshot('gamma', [
              { nativeAgentId: 'nobody', displayName: 'nobody' },
            ]),
          ],
        },
      },
      records
    );

    await runtime.observeSavedSources();
    expect(sessions.has('gamma')).toBe(false);
    expect(sessions.get('alpha')?.connectCalls).toBe(1);
    expect(sessions.get('beta')?.snapshot).not.toBeNull();

    // Idempotent: a second surface asking does not re-reach anyone.
    await runtime.observeSavedSources();
    expect(sessions.get('beta')?.connectCalls).toBe(1);
  });

  it('constructs no session until an operator act asks for one', () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    expect(sessions.size).toBe(0);
    expect(runtime.status()[0].observing).toBe(false);
    expect(sessions.size).toBe(0);
  });
});

describe('ConnectedSourceRuntime — mapping edits', () => {
  it('never mutates the held snapshot and never touches the source', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout' },
            { nativeAgentId: 'reddit', displayName: 'reddit-poster' },
          ]),
        ],
      },
    });

    const connected = await runtime.connect('alpha');
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;

    const session = sessions.get('alpha');
    expect(session).toBeDefined();
    if (!session) return;
    const held = session.snapshot;
    const before = structuredClone(held);
    const connectCallsBefore = session.connect.mock.calls.length;
    const resnapshotCallsBefore = session.resnapshot.mock.calls.length;

    await mapAll(runtime, 'alpha', connected.agents, 'growth');
    const renamed = runtime.mapAgents('alpha', [
      {
        nativeAgentId: 'reddit',
        projectId: 'growth',
        projectLabel: 'Growth',
        displayNameOverride: 'Marcus',
      },
      {
        nativeAgentId: 'scout',
        projectId: 'research',
        projectLabel: 'Research',
      },
    ]);
    expect(renamed).toEqual({ ok: true, mapped: 2 });

    // The source's truth is untouched, object and content alike.
    expect(session.snapshot).toBe(held);
    expect(session.snapshot).toEqual(before);
    // And no Gateway call of any kind was made to record the decision.
    expect(session.connect.mock.calls.length).toBe(connectCallsBefore);
    expect(session.resnapshot.mock.calls.length).toBe(resnapshotCallsBefore);

    const agents = new Map(
      runtime.agents().map(agent => [agent.nativeAgentId, agent])
    );
    expect(agents.get('reddit')?.displayName).toBe('Marcus');
    expect(agents.get('reddit')?.projectLabel).toBe('Growth');
    expect(agents.get('scout')?.projectId).toBe('research');
    // The persona rename is Exawatt's; the source still calls it what it did.
    expect(session.snapshot?.agents[0].displayName).toBe('scout');
  });

  it('refuses an incomplete mapping without writing a partial plan', async () => {
    const { runtime, plans } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    await runtime.connect('alpha');
    const result = runtime.mapAgents('alpha', [
      { nativeAgentId: 'scout', projectId: '' },
    ]);
    expect(result.ok).toBe(false);
    expect(plans.writes).toBe(0);
  });

  it('leaves the other sources mappings alone when one source is remapped', async () => {
    const { runtime, plans } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
      beta: {
        snapshots: [
          snapshot('beta', [{ nativeAgentId: 'tyler', displayName: 'Tyler' }]),
        ],
      },
    });
    const alpha = await runtime.connect('alpha');
    const beta = await runtime.connect('beta');
    if (!alpha.ok || !beta.ok) return;
    await mapAll(runtime, 'alpha', alpha.agents);
    await mapAll(runtime, 'beta', beta.agents);

    runtime.mapAgents('alpha', [
      { nativeAgentId: 'scout', projectId: 'moved', projectLabel: 'Moved' },
    ]);

    const betaMapping = plans.plan.mappings.find(
      mapping => mapping.configuredSourceId === 'beta'
    );
    expect(betaMapping?.projectId).toBe('project-beta');
  });
});

describe('ConnectedSourceRuntime — identity across reconnects', () => {
  it('keeps the same Exawatt Agent id when the source is observed again', async () => {
    const first = snapshot('alpha', [
      { nativeAgentId: 'scout', displayName: 'scout' },
    ]);
    // A later observation of the same installation, with the source's own
    // rename and one more helper context.
    const second = snapshot(
      'alpha',
      [{ nativeAgentId: 'scout', displayName: 'scout-renamed', helpers: 1 }],
      99_000
    );
    const { runtime } = harness({
      alpha: { snapshots: [first, second] },
    });

    const connected = await runtime.connect('alpha');
    if (!connected.ok) return;
    await mapAll(runtime, 'alpha', connected.agents);
    const before = runtime.agents();
    expect(before).toHaveLength(1);

    await runtime.disconnect('alpha');
    const again = await runtime.connect('alpha');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    // Reconnect finds the Agent already placed; the flow can preselect it.
    expect(again.agents[0].mapping?.exawattAgentId).toBe(before[0].id);

    const after = runtime.agents();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].projectId).toBe(before[0].projectId);
    // The source's own rename shows through; the identity does not move.
    expect(after[0].displayName).toBe('scout-renamed');
  });

  it('derives one id per source-qualified Agent, and never collides across sources', () => {
    expect(deriveRemoteAgentId('alpha', 'scout')).toBe(
      deriveRemoteAgentId('alpha', 'scout')
    );
    expect(deriveRemoteAgentId('alpha', 'scout')).not.toBe(
      deriveRemoteAgentId('beta', 'scout')
    );
    expect(deriveRemoteAgentId('alpha', 'scout')).toMatch(
      /^remote-[0-9a-f]{24}$/
    );
  });

  it('keeps an unopened source silent instead of emptying the roster', async () => {
    const { runtime } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
      beta: {
        snapshots: [
          snapshot('beta', [{ nativeAgentId: 'tyler', displayName: 'Tyler' }]),
        ],
      },
    });
    const alpha = await runtime.connect('alpha');
    const beta = await runtime.connect('beta');
    if (!alpha.ok || !beta.ok) return;
    await mapAll(runtime, 'alpha', alpha.agents);
    await mapAll(runtime, 'beta', beta.agents);
    expect(runtime.agents()).toHaveLength(2);

    // A fresh runtime over the same plan that has only opened one source.
    const revived = harness(
      {
        alpha: {
          snapshots: [
            snapshot('alpha', [
              { nativeAgentId: 'scout', displayName: 'scout' },
            ]),
          ],
        },
        beta: {
          snapshots: [
            snapshot('beta', [
              { nativeAgentId: 'tyler', displayName: 'Tyler' },
            ]),
          ],
        },
      },
      [record('alpha'), record('beta')]
    );
    revived.plans.plan = {
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: [
        {
          configuredSourceId: 'alpha',
          nativeAgentId: 'scout',
          exawattAgentId: deriveRemoteAgentId('alpha', 'scout'),
          projectId: 'project-alpha',
          displayNameOverride: null,
          projectLabel: 'Field Work',
        },
        {
          configuredSourceId: 'beta',
          nativeAgentId: 'tyler',
          exawattAgentId: deriveRemoteAgentId('beta', 'tyler'),
          projectId: 'project-beta',
          displayNameOverride: null,
          projectLabel: 'Field Work',
        },
      ],
    };
    await revived.runtime.connect('alpha');
    const projected = revived.runtime.agents();
    expect(projected.map(agent => agent.displayName)).toEqual(['scout']);
  });
});

describe('ConnectedSourceRuntime — quitting', () => {
  it('tears every session down exactly once and leaves remote work alone', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
      beta: {
        snapshots: [
          snapshot('beta', [{ nativeAgentId: 'tyler', displayName: 'Tyler' }]),
        ],
      },
    });
    await runtime.connect('alpha');
    await runtime.connect('beta');

    await runtime.dispose();
    await runtime.dispose();

    for (const session of sessions.values()) {
      expect(session.disconnectCalls).toBe(1);
      // Detaching observation is the ONLY thing quit does to a source.
      expect(session.resnapshot).not.toHaveBeenCalled();
    }
  });

  it('stops notifying the renderer once it has been disposed', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    const changes: string[] = [];
    runtime.onChange(change => changes.push(change.sourceId));
    await runtime.connect('alpha');
    expect(changes.length).toBeGreaterThan(0);

    await runtime.dispose();
    const before = changes.length;
    sessions.get('alpha')?.emitPhase('reconnecting');
    expect(changes.length).toBe(before);
  });
});

describe('ConnectedSourceRuntime — change notifications', () => {
  it('names the source and its freshness without shipping a topology payload', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    const changes: unknown[] = [];
    runtime.onChange(change => changes.push(change));
    await runtime.connect('alpha');

    const latest = changes.at(-1) as {
      sourceId: string;
      snapshotRevision: number;
      connection: { state: string };
    };
    expect(latest.sourceId).toBe('alpha');
    expect(latest.snapshotRevision).toBe(1);
    expect(latest.connection.state).toBe('live');
    expect(Object.keys(latest).sort()).toEqual([
      'connection',
      'phase',
      'snapshotRevision',
      'sourceId',
    ]);

    // A reconnect ladder is freshness news, not new content.
    const before = changes.length;
    sessions.get('alpha')?.emitPhase('reconnecting');
    expect(changes.length).toBe(before + 1);
    expect(
      (changes.at(-1) as { snapshotRevision: number }).snapshotRevision
    ).toBe(1);
  });
});

describe('ConnectedSourceRuntime — freshness never implies stopped work', () => {
  const FORBIDDEN = ['stopped', 'paused', 'lost', 'ended', 'finished'];

  it('says only what Exawatt observed, in every connection state', async () => {
    const states: ConnectionStatus[] = [
      {
        state: 'live',
        observationAgeMs: 0,
        stalePresentation: false,
        failure: null,
      },
      {
        state: 'reconnecting',
        observationAgeMs: 90_000,
        stalePresentation: true,
        failure: 'gateway-down',
      },
      {
        state: 'stale',
        observationAgeMs: 3_600_000,
        stalePresentation: true,
        failure: null,
      },
      {
        state: 'unavailable',
        observationAgeMs: null,
        stalePresentation: true,
        failure: 'host-unreachable',
      },
    ];

    for (const status of states) {
      const { runtime, sessions } = harness({
        alpha: {
          snapshots: [
            snapshot('alpha', [
              { nativeAgentId: 'scout', displayName: 'scout' },
            ]),
          ],
        },
      });
      const connected = await runtime.connect('alpha');
      if (!connected.ok) return;
      await mapAll(runtime, 'alpha', connected.agents);
      sessions.get('alpha')?.setStatus(status);

      const row = runtime.status()[0];
      expect(row.connection.state).toBe(status.state);
      expect(row.connection.label).toBe(
        {
          live: 'Live',
          reconnecting: 'Reconnecting',
          stale: 'Stale',
          unavailable: 'Unavailable',
        }[status.state]
      );

      const agent = runtime.agents()[0];
      const rendered = [
        row.connection.label,
        row.connection.detail,
        row.placementLabel,
        agent.connection.label,
        agent.connection.detail,
        agent.placementLabel,
      ]
        .join(' ')
        .toLowerCase();
      for (const word of FORBIDDEN) {
        expect(rendered).not.toContain(word);
      }
      // Freshness and placement stay two different answers.
      expect(agent.placementLabel).toBe('Remote');
      expect(agent.connection.stalePresentation).toBe(status.stalePresentation);
    }
  });

  it('reports a never-opened source as unavailable, which is about Exawatt', () => {
    const { runtime } = harness({ alpha: {} });
    const row = runtime.status()[0];
    expect(row.observing).toBe(false);
    expect(row.connection.state).toBe('unavailable');
    expect(row.connection.label).toBe('Unavailable');
    expect(row.connection.failure).toBeNull();
  });

  it('keeps the coworkers in the roster after an operator disconnects', async () => {
    const { runtime } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    const connected = await runtime.connect('alpha');
    if (!connected.ok) return;
    await mapAll(runtime, 'alpha', connected.agents);

    expect(await runtime.disconnect('alpha')).toEqual({ ok: true });
    const agents = runtime.agents();
    expect(agents).toHaveLength(1);
    expect(agents[0].connection.state).toBe('unavailable');
    expect(agents[0].connection.stalePresentation).toBe(true);
  });
});

describe("ConnectedSourceRuntime — work state is the source's, not the connection's", () => {
  /** The D40 state the local path gives a Session its harness reports busy. */
  const LOCAL_WORKING = sessionStatus(
    { exited: false, exitCode: null, working: true },
    0,
    0,
    0
  );
  /** ...and the one it gives a Session that has never been given work. */
  const LOCAL_QUIET = sessionStatus(
    { exited: false, exitCode: null, working: false, engaged: false },
    0,
    0,
    0
  );

  async function rosterOf(specs: readonly AgentSpec[]) {
    const { runtime, sessions } = harness({
      alpha: { snapshots: [snapshot('alpha', specs)] },
    });
    const connected = await runtime.connect('alpha');
    if (!connected.ok) throw new Error('fixture failed to connect');
    await mapAll(runtime, 'alpha', connected.agents);
    return { runtime, sessions };
  }

  it('gives a running remote coworker the same D40 state a running local one gets', async () => {
    const { runtime } = await rosterOf([
      { nativeAgentId: 'scout', displayName: 'scout', running: 'main' },
      {
        nativeAgentId: 'tyler',
        displayName: 'Tyler',
        helpers: 2,
        running: 'helper',
      },
      { nativeAgentId: 'quiet', displayName: 'quiet', helpers: 1 },
    ]);
    const byNative = new Map(
      runtime.agents().map(agent => [agent.nativeAgentId, agent])
    );

    expect(byNative.get('scout')?.workState).toBe(LOCAL_WORKING);
    // Work anywhere under the coworker is the coworker working, even when the
    // conversation itself is quiet.
    expect(byNative.get('tyler')?.workState).toBe(LOCAL_WORKING);
    expect(byNative.get('quiet')?.workState).toBe(LOCAL_QUIET);
    // No new vocabulary: every remote state is one D40 already uses.
    for (const agent of runtime.agents()) {
      expect(['working', 'idle']).toContain(agent.workState);
    }
  });

  it('keeps the last-known work state when observation goes stale or away', async () => {
    for (const status of [
      {
        state: 'reconnecting' as const,
        observationAgeMs: 90_000,
        stalePresentation: true,
        failure: 'gateway-down' as const,
      },
      {
        state: 'stale' as const,
        observationAgeMs: 3_600_000,
        stalePresentation: true,
        failure: null,
      },
      {
        state: 'unavailable' as const,
        observationAgeMs: null,
        stalePresentation: true,
        failure: 'host-unreachable' as const,
      },
    ]) {
      const { runtime, sessions } = await rosterOf([
        { nativeAgentId: 'scout', displayName: 'scout', running: 'main' },
      ]);
      expect(runtime.agents()[0].workState).toBe(LOCAL_WORKING);

      sessions.get('alpha')?.setStatus(status);
      const agent = runtime.agents()[0];

      // Losing observation is not evidence about the work: the state is the
      // last one observed, and the presentation is what says so.
      expect(agent.workState).toBe(LOCAL_WORKING);
      expect(agent.connection.state).toBe(status.state);
      expect(agent.connection.stalePresentation).toBe(true);
      const rendered = [
        agent.connection.label,
        agent.connection.detail,
        agent.placementLabel,
      ]
        .join(' ')
        .toLowerCase();
      for (const word of ['stopped', 'paused', 'lost', 'ended', 'finished']) {
        expect(rendered).not.toContain(word);
      }
    }
  });

  it('reads a coworker whose source reported no run at all as idle', async () => {
    const { runtime } = await rosterOf([
      { nativeAgentId: 'scout', displayName: 'scout', helpers: 1 },
    ]);
    expect(runtime.agents()[0].workState).toBe('idle');
  });
});

describe('ConnectedSourceRuntime — projected coworker shape', () => {
  it('carries placement, source identity, and the source-declared primary conversation', async () => {
    const { runtime } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', helpers: 2 },
            { nativeAgentId: 'tyler', displayName: 'Tyler', primary: false },
          ]),
        ],
      },
    });
    const connected = await runtime.connect('alpha');
    if (!connected.ok) return;
    await mapAll(runtime, 'alpha', connected.agents);

    const byNative = new Map(
      runtime.agents().map(agent => [agent.nativeAgentId, agent])
    );
    const scout = byNative.get('scout');
    expect(scout).toMatchObject({
      placement: 'customer-hosted',
      placementLabel: 'Remote',
      adapterId: 'openclaw',
      primaryContextId: 'agent:scout:main',
      contextCount: 3,
      projectionVersion: AGENT_PROJECTION_VERSION,
    });
    expect(scout?.source).toEqual({ id: 'alpha', displayName: 'Source alpha' });
    // A source that declares no Home never gets a fabricated one.
    expect(byNative.get('tyler')?.primaryContextId).toBeNull();
  });
});
