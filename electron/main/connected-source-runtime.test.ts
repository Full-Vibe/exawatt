import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_PROJECTION_VERSION,
  sessionStatus,
  type AgentSourceTopologySnapshot,
  type ConnectedSourceRecord,
  type ConnectionStatus,
  type SourceAuthority,
  type SourceAutomationRecord,
  type SourceContextRecord,
} from '@exawatt/core';
import {
  EMPTY_PROJECTION_PLAN,
  deriveRemoteAgentId,
  type ConnectedAgentProjectionPlan,
  type ConnectedAgentProjectionPlanStore,
} from './connected-agent-projection-plan';
import {
  MAX_CONVERSATION_CHARACTERS,
  MAX_CONVERSATION_TURNS,
  MAX_TURN_CHARACTERS,
  MAX_UPDATES_PER_RUN,
  MAX_UPDATE_CHARACTERS,
} from './connected-conversation';
import {
  ConnectedSourceRuntime,
  type ConnectedSourceSession,
  type ConversationUpdate,
  type SendToAgentOptions,
} from './connected-source-runtime';
import type { AuthorityRequestResult } from './connected-gateway-authority';
import type { ConnectedGatewayPhase } from './connected-gateway';
import type { GatewayIdentity } from './gateway-identity';

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
  /**
   * A scheduled job the source attributes to this Agent. Absent means it
   * reported none, which is the source saying nothing rather than saying the
   * Agent has no automation.
   */
  automation?: { enabled?: boolean; lastOutcome?: 'succeeded' | 'failed' };
  /**
   * The source reported nothing at all about this Agent's contexts: no run
   * flag either way. Every branch of the kernel's derivation reads a positive
   * report, so this is the shape that answers unknown.
   */
  silent?: boolean;
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
      // Absent is the source saying nothing. It is not `false`, and the
      // difference is the whole of what `silent` exists to prove.
      ...(spec.silent === true
        ? {}
        : { hasActiveRun: spec.running === 'main' }),
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
      ...(spec.silent === true
        ? {}
        : { hasActiveRun: spec.running === 'helper' && index === 0 }),
      createdAt: 2_000,
      lastActiveAt: 6_000,
    });
  }
  return contexts;
}

function automationsFor(
  configuredSourceId: string,
  specs: readonly AgentSpec[]
): SourceAutomationRecord[] {
  return specs
    .filter(spec => spec.automation !== undefined)
    .map(spec => ({
      configuredSourceId,
      nativeAgentId: spec.nativeAgentId,
      nativeAutomationId: `${spec.nativeAgentId}-sweep`,
      ...(spec.automation?.enabled === undefined
        ? {}
        : { enabled: spec.automation.enabled }),
      ...(spec.automation?.lastOutcome === undefined
        ? {}
        : { lastOutcome: spec.automation.lastOutcome }),
      targetContextId: null,
    }));
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
    // Absent and empty are different answers, so a snapshot only carries the
    // key when some Agent in it was given one.
    ...(specs.some(spec => spec.automation !== undefined)
      ? { automations: automationsFor(configuredSourceId, specs) }
      : {}),
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
    // Observation is the floor every source starts at. H2 tests that need to
    // talk say so explicitly, so no fixture ever grants authority by accident.
    grantedAuthority: 'read',
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
      boundIdentities: Object.fromEntries(
        Object.entries(this.plan.boundIdentities).map(([id, identity]) => [
          id,
          {
            version: identity.version,
            nativeAgentIds: [...identity.nativeAgentIds],
          },
        ])
      ),
    };
  }

  write(plan: ConnectedAgentProjectionPlan): void {
    this.writes += 1;
    this.plan = {
      projectionVersion: plan.projectionVersion,
      mappings: plan.mappings.map(mapping => ({ ...mapping })),
      boundIdentities: Object.fromEntries(
        Object.entries(plan.boundIdentities).map(([id, identity]) => [
          id,
          {
            version: identity.version,
            nativeAgentIds: [...identity.nativeAgentIds],
          },
        ])
      ),
    };
  }
}

interface SessionScript {
  /** Snapshot handed back per `connect()` call, in order. */
  snapshots?: AgentSourceTopologySnapshot[];
  failure?: { failure: 'host-unreachable' | 'gateway-down'; message: string };
  status?: ConnectionStatus;
  /** `chat.history` payloads, by the session key the read asks for. */
  history?: Record<string, unknown>;
  /** What `chat.send` answers with. */
  sendResult?: unknown;
  /** ...or throws. */
  sendError?: Error;
  /** What the source says when asked to raise Exawatt's authority. */
  authorityResult?: AuthorityRequestResult;
  /** The version the source reports as part of its installation identity. */
  version?: string;
}

class FakeSession implements ConnectedSourceSession {
  snapshot: AgentSourceTopologySnapshot | null = null;
  phase: ConnectedGatewayPhase = 'idle';
  identityDrift: null = null;
  disconnectCalls = 0;
  connectCalls = 0;
  /**
   * What this session has bound to. Seeded from what the runtime handed over,
   * exactly as the real session seeds its drift comparison, so a test can see
   * whether a relaunch had anything to compare against.
   */
  identity: GatewayIdentity | null;
  readonly seededIdentity: GatewayIdentity | null;
  private readonly script: SessionScript;
  private readonly phaseListeners = new Set<
    (phase: ConnectedGatewayPhase) => void
  >();
  private currentStatus: ConnectionStatus;

  constructor(script: SessionScript, knownIdentity: GatewayIdentity | null) {
    this.script = script;
    this.seededIdentity = knownIdentity;
    this.identity = knownIdentity;
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
    this.identity = {
      version: this.script.version ?? '',
      nativeAgentIds: next.agents
        .filter(agent => agent.discoveryState === 'configured')
        .map(agent => agent.nativeAgentId)
        .sort(),
    };
    return {
      ok: true as const,
      outcome: 'connected' as const,
      snapshot: next,
      identity: this.identity,
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

  authority: SourceAuthority = 'read';

  /** Every read this session was asked for, in order. */
  readonly reads: { method: string; params?: unknown }[] = [];
  /** Every write. The read-only tests assert this stays empty. */
  readonly writes: { method: string; params?: unknown }[] = [];

  read = vi.fn(async (method: string, params?: unknown) => {
    this.reads.push({ method, params });
    if (method !== 'chat.history') return {};
    const key = (params as { sessionKey?: string } | undefined)?.sessionKey;
    return (
      this.script.history?.[key ?? ''] ?? { sessionKey: key, messages: [] }
    );
  });

  write = vi.fn(async (method: string, params?: unknown) => {
    this.writes.push({ method, params });
    if (this.script.sendError) throw this.script.sendError;
    return this.script.sendResult ?? { runId: 'run-1', status: 'ok' };
  });

  requestWriteAuthority = vi.fn(
    async (): Promise<AuthorityRequestResult> =>
      this.script.authorityResult ?? {
        outcome: 'granted',
        authority: 'write',
        message: 'This source granted Exawatt write authority.',
      }
  );

  relinquishWriteAuthority = vi.fn(
    async (): Promise<AuthorityRequestResult> => ({
      outcome: 'granted',
      authority: 'read',
      message: 'Exawatt handed write access back to this source.',
    })
  );

  private readonly eventHandlers = new Map<
    string,
    Set<(payload: unknown) => void>
  >();

  onGatewayEvent = vi.fn(
    (eventName: string, handler: (payload: unknown) => void) => {
      const handlers = this.eventHandlers.get(eventName) ?? new Set();
      handlers.add(handler);
      this.eventHandlers.set(eventName, handlers);
      return () => handlers.delete(handler);
    }
  );

  emitGatewayEvent(eventName: string, payload: unknown): void {
    for (const handler of this.eventHandlers.get(eventName) ?? []) {
      handler(payload);
    }
  }

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
  /** Everything the runtime reported. Never a payload, never a name. */
  diagnostics: { event: string; fields: Record<string, unknown> }[];
}

function harness(
  scripts: Record<string, SessionScript>,
  records = Object.keys(scripts).map(id => record(id))
): Harness {
  const plans = new MemoryPlanStore();
  const sessions = new Map<string, FakeSession>();
  const diagnostics: { event: string; fields: Record<string, unknown> }[] = [];
  const runtime = new ConnectedSourceRuntime({
    store: {
      list: () => records,
      get: (id: string) => records.find(entry => entry.id === id) ?? null,
    },
    plans,
    createSession: (source, context) => {
      const session = new FakeSession(
        scripts[source.id] ?? {},
        context.knownIdentity
      );
      sessions.set(source.id, session);
      return session;
    },
    now: () => 20_000,
    recordDiagnostic: (event, fields = {}) =>
      diagnostics.push({ event, fields }),
  });
  return { runtime, plans, sessions, records, diagnostics };
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
    // Observing binds the plan to the installation it observed, so the count
    // that matters is what the refused edit added to it: nothing.
    const writesBefore = plans.writes;
    const result = runtime.mapAgents('alpha', [
      { nativeAgentId: 'scout', projectId: '' },
    ]);
    expect(result.ok).toBe(false);
    expect(plans.writes).toBe(writesBefore);
    expect(plans.plan.mappings).toEqual([]);
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
      boundIdentities: {},
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

describe('ConnectedSourceRuntime — an Agent retires on the source', () => {
  /**
   * Two sources, two coworkers each, all four mapped. The second snapshot of
   * `alpha` no longer declares one of them: somebody deleted that Agent on
   * their own server, which is the ordinary thing this describes.
   */
  async function afterRetiring(retired: string) {
    const context = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', helpers: 1 },
            { nativeAgentId: 'reddit', displayName: 'reddit-poster' },
          ]),
          snapshot(
            'alpha',
            [
              { nativeAgentId: 'scout', displayName: 'scout', helpers: 1 },
              { nativeAgentId: 'reddit', displayName: 'reddit-poster' },
            ].filter(spec => spec.nativeAgentId !== retired),
            30_000
          ),
        ],
      },
      beta: {
        snapshots: [
          snapshot('beta', [
            { nativeAgentId: 'tyler', displayName: 'Tyler' },
            { nativeAgentId: 'priya', displayName: 'Priya' },
          ]),
        ],
      },
    });
    const alpha = await context.runtime.connect('alpha');
    const beta = await context.runtime.connect('beta');
    if (!alpha.ok || !beta.ok) throw new Error('fixture failed to connect');
    await mapAll(context.runtime, 'alpha', alpha.agents);
    await mapAll(context.runtime, 'beta', beta.agents);
    expect(context.runtime.agents()).toHaveLength(4);

    // The operator's Reconnect: one fresh authoritative snapshot.
    await context.runtime.disconnect('alpha');
    await context.runtime.connect('alpha');
    return context;
  }

  it('costs the operator that one coworker and nobody else, on any source', async () => {
    const { runtime } = await afterRetiring('reddit');

    expect(
      runtime
        .agents()
        .map(agent => `${agent.source.id}/${agent.nativeAgentId}`)
        .sort()
    ).toEqual(['alpha/scout', 'beta/priya', 'beta/tyler']);
  });

  it('stops answering at the address as well as in the roster', async () => {
    const context = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
          snapshot(
            'alpha',
            [
              {
                nativeAgentId: 'scout',
                displayName: 'scout',
                discoveryState: 'retired',
              },
            ],
            30_000
          ),
        ],
        history: {
          'agent:scout:main': {
            messages: [{ role: 'user', content: 'still there?', timestamp: 1 }],
          },
        },
      },
    });
    const connected = await context.runtime.connect('alpha');
    if (!connected.ok) throw new Error('fixture failed to connect');
    await mapAll(context.runtime, 'alpha', connected.agents);
    const agentId = deriveRemoteAgentId('alpha', 'scout');
    expect((await context.runtime.conversation(agentId)).ok).toBe(true);

    await context.runtime.disconnect('alpha');
    await context.runtime.connect('alpha');

    // The roster and the conversation address answer one question, not two.
    // They used to disagree: a retired coworker left the roster while its
    // address still resolved, so Exawatt would still read a transcript for
    // somebody the operator can no longer see.
    expect(context.runtime.agents()).toEqual([]);
    const reread = await context.runtime.conversation(agentId);
    expect(reread.ok).toBe(false);
    if (reread.ok) return;
    expect(reread.outcome).toBe('unknown-agent');
  });

  it('leaves the surviving coworkers with the ids and Projects they had', async () => {
    const { runtime } = await afterRetiring('scout');
    const survivor = runtime
      .agents()
      .find(agent => agent.nativeAgentId === 'reddit');

    expect(survivor?.id).toBe(deriveRemoteAgentId('alpha', 'reddit'));
    expect(survivor?.projectId).toBe('project-alpha');
    expect(runtime.agents().every(agent => agent.workState !== null)).toBe(
      true
    );
  });

  it('says nothing about it: a retirement is not a projection fault', async () => {
    const { diagnostics } = await afterRetiring('reddit');
    expect(diagnostics).toEqual([]);
  });

  it('keeps the retired Agent placed, so returning is a choice and not a resnapshot', async () => {
    const { runtime, plans } = await afterRetiring('reddit');

    // Unprojected, not forgotten. Deleting the row here would throw away the
    // Project the operator chose the moment a server hiccuped.
    expect(
      plans.plan.mappings.map(mapping => mapping.nativeAgentId).sort()
    ).toEqual(['priya', 'reddit', 'scout', 'tyler']);
    expect(
      runtime.agents().some(agent => agent.nativeAgentId === 'reddit')
    ).toBe(false);
  });

  it('leaves an Agent the source declares retired out of the roster too', async () => {
    const { runtime } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout' },
            { nativeAgentId: 'priya', displayName: 'Priya' },
          ]),
          snapshot(
            'alpha',
            [
              { nativeAgentId: 'scout', displayName: 'scout' },
              {
                nativeAgentId: 'priya',
                displayName: 'Priya',
                discoveryState: 'retired',
              },
            ],
            30_000
          ),
        ],
      },
    });
    const connected = await runtime.connect('alpha');
    if (!connected.ok) return;
    await mapAll(runtime, 'alpha', connected.agents);
    expect(runtime.agents()).toHaveLength(2);

    await runtime.disconnect('alpha');
    await runtime.connect('alpha');

    // A source that keeps the identity around as history has still stopped
    // declaring it configured, and that is the same retirement.
    expect(runtime.agents().map(agent => agent.nativeAgentId)).toEqual([
      'scout',
    ]);
  });

  it('reports a plan that is broken rather than outdated, and projects nothing on it', async () => {
    const { runtime, plans, diagnostics } = harness({
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
    if (!connected.ok) return;
    await mapAll(runtime, 'alpha', connected.agents);
    expect(runtime.agents()).toHaveLength(2);

    // Two coworkers claiming one Exawatt identity. Both Agents are configured
    // on the source, so this is corruption, not a retirement, and quietly
    // dropping a row would hand the operator a roster silently missing people.
    plans.plan = {
      projectionVersion: AGENT_PROJECTION_VERSION,
      boundIdentities: plans.plan.boundIdentities,
      mappings: plans.plan.mappings.map(mapping => ({
        ...mapping,
        exawattAgentId: deriveRemoteAgentId('alpha', 'scout'),
      })),
    };

    expect(runtime.agents()).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].event).toBe('connected-sources.projection-refused');
    expect(diagnostics[0].fields.codes).toEqual(['duplicate-exawatt-agent']);
    // Codes and counts only: nothing an operator named travels to a log file.
    const reported = JSON.stringify(diagnostics[0].fields);
    for (const name of ['scout', 'reddit', 'alias-alpha', 'Source alpha']) {
      expect(reported).not.toContain(name);
    }
  });
});

describe('ConnectedSourceRuntime — detaching a source', () => {
  /** Two sources, one coworker each, both mapped and both observed. */
  async function twoSources() {
    const context = harness({
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
    const alpha = await context.runtime.connect('alpha');
    const beta = await context.runtime.connect('beta');
    if (!alpha.ok || !beta.ok) throw new Error('fixture failed to connect');
    await mapAll(context.runtime, 'alpha', alpha.agents);
    await mapAll(context.runtime, 'beta', beta.agents);
    expect(context.runtime.agents()).toHaveLength(2);
    return context;
  }

  it('takes the coworkers out of the roster instead of leaving them until quit', async () => {
    const { runtime } = await twoSources();

    await runtime.detach('alpha');

    expect(
      runtime.agents().map(agent => `${agent.source.id}/${agent.nativeAgentId}`)
    ).toEqual(['beta/tyler']);
  });

  it('leaves no projection behind for it, and every other source keeps its own', async () => {
    const { runtime, plans } = await twoSources();

    await runtime.detach('alpha');

    expect(plans.plan.mappings.map(mapping => mapping.nativeAgentId)).toEqual([
      'tyler',
    ]);
    expect(Object.keys(plans.plan.boundIdentities)).toEqual(['beta']);
  });

  it('closes that source and touches no other, and changes nothing on the remote', async () => {
    const { runtime, sessions } = await twoSources();

    await runtime.detach('alpha');

    const alpha = sessions.get('alpha');
    const beta = sessions.get('beta');
    expect(alpha?.disconnectCalls).toBe(1);
    expect(beta?.disconnectCalls).toBe(0);
    // Detaching is Exawatt forgetting a source, never Exawatt changing one.
    expect(alpha?.writes).toEqual([]);
    expect(alpha?.reads).toEqual([]);
  });

  it('forgets the source entirely, so a later disconnect finds nothing to close', async () => {
    const { runtime, sessions } = await twoSources();

    await runtime.detach('alpha');

    expect(await runtime.disconnect('alpha')).toEqual({ ok: false });
    expect(sessions.get('alpha')?.disconnectCalls).toBe(1);
  });

  it('tells the renderer, so a roster on screen reads the absence', async () => {
    const { runtime } = await twoSources();
    const changes: string[] = [];
    runtime.onChange(change => changes.push(change.sourceId));

    await runtime.detach('alpha');

    expect(changes).toContain('alpha');
  });

  it('is safe on a source this launch never opened', async () => {
    const { runtime, plans } = harness({ alpha: {} });
    plans.plan = {
      projectionVersion: AGENT_PROJECTION_VERSION,
      boundIdentities: {},
      mappings: [
        {
          configuredSourceId: 'alpha',
          nativeAgentId: 'scout',
          exawattAgentId: deriveRemoteAgentId('alpha', 'scout'),
          projectId: 'project-alpha',
          displayNameOverride: null,
          projectLabel: 'Field Work',
        },
      ],
    };

    await runtime.detach('alpha');

    expect(plans.plan.mappings).toEqual([]);
  });

  it('gives the same server the same coworkers when it is connected again', async () => {
    const { runtime } = await twoSources();
    const before = runtime
      .agents()
      .filter(agent => agent.source.id === 'alpha')
      .map(agent => agent.id);

    await runtime.detach('alpha');
    // The store hands back the same id for the same server, so the Connect
    // flow reaches this runtime with the source it already had.
    const again = await runtime.connect('alpha');
    if (!again.ok) throw new Error('reconnecting the same source failed');
    await mapAll(runtime, 'alpha', again.agents);

    const after = runtime
      .agents()
      .filter(agent => agent.source.id === 'alpha')
      .map(agent => agent.id);
    expect(after).toEqual(before);
    expect(after).toEqual([deriveRemoteAgentId('alpha', 'scout')]);
    expect(runtime.agents()).toHaveLength(2);
  });
});

describe('ConnectedSourceRuntime — what the projection is bound to', () => {
  it('persists the installation it observed, so a relaunch has something to compare', async () => {
    const { runtime, plans } = harness({
      alpha: {
        version: '1.4.0',
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout' },
            { nativeAgentId: 'reddit', displayName: 'reddit-poster' },
          ]),
        ],
      },
    });

    await runtime.connect('alpha');

    expect(plans.plan.boundIdentities.alpha).toEqual({
      version: '1.4.0',
      nativeAgentIds: ['reddit', 'scout'],
    });
  });

  it('hands it back to the next launch, which is when a swap is least visible', async () => {
    const shared = new MemoryPlanStore();
    const scripts = {
      alpha: {
        version: '1.4.0',
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    };
    const records = [record('alpha')];
    const build = () => {
      const sessions = new Map<string, FakeSession>();
      const runtime = new ConnectedSourceRuntime({
        store: {
          list: () => records,
          get: (id: string) => records.find(entry => entry.id === id) ?? null,
        },
        plans: shared,
        createSession: (source, context) => {
          const session = new FakeSession(scripts.alpha, context.knownIdentity);
          sessions.set(source.id, session);
          return session;
        },
        now: () => 20_000,
      });
      return { runtime, sessions };
    };

    const first = build();
    await first.runtime.connect('alpha');
    // Everything a quit tears down.
    await first.runtime.dispose();

    const second = build();
    await second.runtime.observeSavedSources();

    // A fresh session with nothing seeded has nothing to call drift against,
    // which is how a Gateway swapped while Exawatt was closed slips through.
    expect(second.sessions.get('alpha')?.seededIdentity).toEqual({
      version: '1.4.0',
      nativeAgentIds: ['scout'],
    });
  });

  it('carries no name, alias, host, or address into the plan file', async () => {
    const { runtime, plans } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });

    await runtime.connect('alpha');

    const written = JSON.stringify(plans.plan.boundIdentities);
    for (const material of ['alias-alpha', 'Source alpha', '1337']) {
      expect(written).not.toContain(material);
    }
  });

  it('starts a detached source over with no history to compare against', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    await runtime.connect('alpha');

    await runtime.detach('alpha');
    await runtime.connect('alpha');

    // The operator connected this server deliberately just now. Whatever was
    // behind it before is not something to hold them to.
    expect(sessions.get('alpha')?.seededIdentity).toBeNull();
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

  it('bumps the revision for the snapshot an automatic reconnect brought in', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', running: 'main' },
          ]),
        ],
      },
    });
    const connected = await runtime.connect('alpha');
    if (!connected.ok) throw new Error('fixture failed to connect');
    await mapAll(runtime, 'alpha', connected.agents);
    const session = sessions.get('alpha');
    if (!session) throw new Error('fixture built no session');
    expect(runtime.status()[0].snapshotRevision).toBe(1);
    expect(runtime.agents()[0].workState).toBe('idle');

    // The ladder, not the operator: the connection drops, the session
    // resnapshots on its own way back up, and `connect` is never called on the
    // runtime. The coworker started working while Exawatt was reconnecting, so
    // a surface keyed on the revision would otherwise be holding a roster it
    // has no reason to read again.
    session.emitPhase('reconnecting');
    expect(runtime.status()[0].snapshotRevision).toBe(1);
    await session.connect();
    session.emitPhase('connected');

    expect(runtime.status()[0].snapshotRevision).toBe(2);
    expect(runtime.agents()[0].workState).toBe('working');
  });

  it('bumps once per authoritative snapshot, however many times it is noticed', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    await runtime.connect('alpha');
    const session = sessions.get('alpha');
    if (!session) throw new Error('fixture built no session');

    // Phase movement that replaced nothing is freshness news. A reconnecting
    // ladder that comes back to the snapshot it already had must not read as
    // new content, or a renderer re-reads the roster on every flap.
    session.emitPhase('reconnecting');
    session.emitPhase('connected');
    session.emitPhase('reconnecting');
    session.emitPhase('connected');

    expect(runtime.status()[0].snapshotRevision).toBe(1);
  });

  it('leaves the revision alone when a reconnect fails', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [{ nativeAgentId: 'scout', displayName: 'scout' }]),
        ],
      },
    });
    await runtime.connect('alpha');
    const session = sessions.get('alpha');
    if (!session) throw new Error('fixture built no session');

    // The ladder gave up. The cached snapshot is exactly where it was, so
    // there is nothing new to read and the number says so.
    session.emitPhase('reconnecting');
    session.emitPhase('failed');

    expect(runtime.status()[0].snapshotRevision).toBe(1);
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

  it('carries a fault the source reported through to the roster', async () => {
    const { runtime } = await rosterOf([
      {
        nativeAgentId: 'scout',
        displayName: 'scout',
        automation: { enabled: true, lastOutcome: 'failed' },
      },
    ]);

    // The kernel derives this from an enabled job the source says last failed.
    // The runtime used to answer `hasActiveRun ? working : idle` and threw the
    // fault away, so a coworker whose work was erroring read as quiet.
    expect(runtime.agents()[0].workState).toBe('error');
  });

  it('lets a fault outrank a run in flight, exactly as the kernel states it', async () => {
    const { runtime } = await rosterOf([
      {
        nativeAgentId: 'scout',
        displayName: 'scout',
        running: 'main',
        automation: { enabled: true, lastOutcome: 'failed' },
      },
    ]);

    expect(runtime.agents()[0].workState).toBe('error');
  });

  it('reads a disabled job’s old failure as history, not as a present fault', async () => {
    const { runtime } = await rosterOf([
      {
        nativeAgentId: 'scout',
        displayName: 'scout',
        automation: { enabled: false, lastOutcome: 'failed' },
      },
    ]);

    expect(runtime.agents()[0].workState).toBe('idle');
  });

  it('makes no claim at all about a coworker its source said nothing about', async () => {
    const { runtime } = await rosterOf([
      { nativeAgentId: 'scout', displayName: 'scout', silent: true },
    ]);

    // Unknown is an answer, and `idle` is not it. A coworker nobody reported
    // on is not quietly waiting; Exawatt simply has nothing to show.
    expect(runtime.agents()[0].workState).toBeNull();
  });

  it('keeps unknown unknown across the resnapshot a reconnect brings in', async () => {
    const { runtime, sessions } = harness({
      alpha: {
        snapshots: [
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', silent: true },
          ]),
          snapshot('alpha', [
            { nativeAgentId: 'scout', displayName: 'scout', silent: true },
          ]),
        ],
      },
    });
    const connected = await runtime.connect('alpha');
    if (!connected.ok) throw new Error('fixture failed to connect');
    await mapAll(runtime, 'alpha', connected.agents);
    const session = sessions.get('alpha');
    if (!session) throw new Error('fixture built no session');
    expect(runtime.agents()[0].workState).toBeNull();

    session.emitPhase('reconnecting');
    await session.connect();
    session.emitPhase('connected');

    // A second reading of the same silence is still silence. The one place
    // this must never be resolved is here, where the source is still saying
    // nothing: the main process carries null all the way to the boundary and
    // never trades it for a state nobody reported.
    expect(runtime.status()[0].snapshotRevision).toBe(2);
    expect(runtime.agents()[0].workState).toBeNull();
  });

  it('leaves an unknown and a fault exactly as observed when the connection goes', async () => {
    for (const spec of [
      { nativeAgentId: 'scout', displayName: 'scout', silent: true },
      {
        nativeAgentId: 'scout',
        displayName: 'scout',
        automation: { enabled: true, lastOutcome: 'failed' as const },
      },
    ]) {
      const { runtime, sessions } = await rosterOf([spec]);
      const observed = runtime.agents()[0].workState;

      sessions.get('alpha')?.setStatus({
        state: 'stale',
        observationAgeMs: 3_600_000,
        stalePresentation: true,
        failure: null,
      });

      const agent = runtime.agents()[0];
      expect(agent.workState).toBe(observed);
      expect(agent.connection.state).toBe('stale');
      expect(agent.connection.stalePresentation).toBe(true);
    }
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

/* ---- ENG-033 H2: talking to a connected coworker -------------------------- */

/**
 * Everything below is still hermetic. The session double answers `chat.history`
 * and `chat.send` from a script and records every call, so a test can assert
 * not only what Exawatt asked for but that a refusal asked for nothing at all.
 */

const MAIN_KEY = 'agent:scout:main';
const HELPER_KEY = 'agent:scout:helper:0';

function transcript(
  ...rows: readonly {
    role?: string;
    content?: unknown;
    timestamp?: number;
    runId?: string;
  }[]
) {
  return {
    sessionKey: MAIN_KEY,
    messages: rows.map((row, index) => ({
      role: row.role ?? (index % 2 === 0 ? 'user' : 'assistant'),
      content: row.content ?? `turn ${index}`,
      timestamp: row.timestamp ?? 1_000 + index,
      ...(row.runId === undefined ? {} : { runId: row.runId }),
    })),
  };
}

interface TalkFixture {
  runtime: ConnectedSourceRuntime;
  session: FakeSession;
  plans: MemoryPlanStore;
  updates: ConversationUpdate[];
  agentId: string;
}

/** A connected source, one mapped coworker, and a place for its updates. */
async function talkingTo(
  specs: readonly AgentSpec[] = [
    { nativeAgentId: 'scout', displayName: 'scout', helpers: 1 },
  ],
  script: Omit<SessionScript, 'snapshots'> = {},
  authority: SourceAuthority = 'write'
): Promise<TalkFixture> {
  const { runtime, sessions, plans } = harness(
    { alpha: { snapshots: [snapshot('alpha', specs)], ...script } },
    [record('alpha', { grantedAuthority: authority })]
  );
  const connected = await runtime.connect('alpha');
  if (!connected.ok) throw new Error('fixture failed to connect');
  await mapAll(runtime, 'alpha', connected.agents);
  const updates: ConversationUpdate[] = [];
  runtime.onConversationUpdate(update => updates.push(update));
  const session = sessions.get('alpha');
  if (!session) throw new Error('fixture has no session');
  return {
    runtime,
    session,
    plans,
    updates,
    agentId: deriveRemoteAgentId('alpha', specs[0].nativeAgentId),
  };
}

describe('ConnectedSourceRuntime — reading a primary conversation', () => {
  it('reads the source-declared address and returns turns oldest to newest', async () => {
    const { runtime, session, agentId } = await talkingTo(undefined, {
      history: { [MAIN_KEY]: transcript({}, {}, {}) },
    });

    const result = await runtime.conversation(agentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contextId).toBe(MAIN_KEY);
    expect(result.turns.map(turn => turn.text)).toEqual([
      'turn 0',
      'turn 1',
      'turn 2',
    ]);
    expect(result.turns.map(turn => turn.role)).toEqual([
      'operator',
      'agent',
      'operator',
    ]);
    expect(result.hasMore).toBe(false);
    // The address came from the projection, and the read is bounded at source.
    expect(session.reads).toEqual([
      {
        method: 'chat.history',
        params: { sessionKey: MAIN_KEY, limit: MAX_CONVERSATION_TURNS + 1 },
      },
    ]);
  });

  it('pages from the newest turn backward and reports that more exists', async () => {
    const rows = Array.from({ length: 8 }, () => ({}));
    const { runtime, agentId } = await talkingTo(undefined, {
      history: { [MAIN_KEY]: transcript(...rows) },
    });

    const page = await runtime.conversation(agentId, { limit: 3 });
    if (!page.ok) throw new Error('expected a conversation');
    expect(page.turns.map(turn => turn.text)).toEqual([
      'turn 5',
      'turn 6',
      'turn 7',
    ]);
    expect(page.hasMore).toBe(true);

    // ...and the cursor walks further back rather than restarting.
    const older = await runtime.conversation(agentId, {
      limit: 3,
      beforeTurnId: page.turns[0].id,
    });
    if (!older.ok) throw new Error('expected a conversation');
    expect(older.turns.map(turn => turn.text)).toEqual([
      'turn 2',
      'turn 3',
      'turn 4',
    ]);
    expect(older.hasMore).toBe(true);
  });

  it('spends a character budget from the newest turn backward', async () => {
    const long = 'x'.repeat(MAX_TURN_CHARACTERS);
    const rows = Array.from({ length: 40 }, (_, index) => ({
      content: `${index}${long}`.slice(0, MAX_TURN_CHARACTERS + 200),
    }));
    const { runtime, agentId } = await talkingTo(undefined, {
      history: { [MAIN_KEY]: transcript(...rows) },
    });

    const page = await runtime.conversation(agentId, { limit: 40 });
    if (!page.ok) throw new Error('expected a conversation');
    expect(page.characterCount).toBeLessThanOrEqual(
      MAX_CONVERSATION_CHARACTERS
    );
    expect(page.turns.length).toBeLessThan(40);
    expect(page.hasMore).toBe(true);
    // The newest end survives; the oldest is what the budget drops.
    expect(page.turns[page.turns.length - 1].text.startsWith('39')).toBe(true);
    for (const turn of page.turns) {
      expect(turn.text.length).toBeLessThanOrEqual(MAX_TURN_CHARACTERS);
      expect(turn.clipped).toBe(true);
    }
  });

  it('caps how much of a very long transcript it takes from the source', async () => {
    const rows = Array.from({ length: MAX_CONVERSATION_TURNS + 50 }, () => ({
      content: 'brief',
    }));
    const { runtime, agentId } = await talkingTo(undefined, {
      history: { [MAIN_KEY]: transcript(...rows) },
    });

    const page = await runtime.conversation(agentId, {
      limit: MAX_CONVERSATION_TURNS,
    });
    if (!page.ok) throw new Error('expected a conversation');
    expect(page.turns.length).toBeLessThanOrEqual(MAX_CONVERSATION_TURNS);
    expect(page.hasMore).toBe(true);
  });

  it('answers a coworker with no conversation explicitly, never with silence', async () => {
    const { runtime, session } = await talkingTo([
      { nativeAgentId: 'tyler', displayName: 'Tyler', primary: false },
    ]);
    const agentId = deriveRemoteAgentId('alpha', 'tyler');

    const result = await runtime.conversation(agentId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe('no-primary-conversation');
    expect(result.message).toMatch(/no conversation on its source/i);
    // An absent conversation is known from the projection, so nothing is asked.
    expect(session.reads).toEqual([]);
  });

  it('refuses an Agent Exawatt has never mapped', async () => {
    const { runtime, session } = await talkingTo();
    const result = await runtime.conversation('remote-nobody');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe('unknown-agent');
    expect(session.reads).toEqual([]);
  });

  it('reports a source this launch never opened as disconnected, not as a missing coworker', async () => {
    const { runtime, session, agentId } = await talkingTo(undefined, {
      history: { [MAIN_KEY]: transcript({}) },
    });
    await runtime.dispose();

    const result = await runtime.conversation(agentId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe('disconnected');
    expect(session.reads).toEqual([]);
  });

  it('gives one turn the same id on every read, so a reread reconciles', async () => {
    const { runtime, agentId } = await talkingTo(undefined, {
      history: { [MAIN_KEY]: transcript({}, {}, { content: 'turn 0' }) },
    });

    const first = await runtime.conversation(agentId);
    const second = await runtime.conversation(agentId);
    if (!first.ok || !second.ok) throw new Error('expected conversations');
    expect(first.turns.map(turn => turn.id)).toEqual(
      second.turns.map(turn => turn.id)
    );
    // Two identical turns are still two turns, with two ids.
    expect(new Set(first.turns.map(turn => turn.id)).size).toBe(3);
  });
});

describe('ConnectedSourceRuntime — sending to the primary conversation', () => {
  it('reaches chat.send on the address the projection resolved', async () => {
    const { runtime, session, agentId } = await talkingTo(undefined, {
      sendResult: { runId: 'run-77', status: 'queued' },
    });

    const result = await runtime.send(agentId, 'Any progress on the draft?');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      agentId,
      sourceId: 'alpha',
      contextId: MAIN_KEY,
      runId: 'run-77',
      status: 'queued',
    });
    expect(session.writes).toHaveLength(1);
    expect(session.writes[0].method).toBe('chat.send');
    expect(session.writes[0].params).toMatchObject({
      sessionKey: MAIN_KEY,
      text: 'Any progress on the draft?',
      idempotencyKey: result.idempotencyKey,
    });
  });

  it('has no parameter a caller could aim at another context', async () => {
    // The address is not an argument. Two positional parameters, and the third
    // is options that carry an idempotency key and nothing addressable.
    expect(ConnectedSourceRuntime.prototype.send.length).toBe(2);

    const { runtime, session, agentId } = await talkingTo();
    await runtime.send(agentId, 'hello', {
      idempotencyKey: 'key-1',
      // A caller trying to smuggle an address in. It is not in the type, and
      // it does not survive into the call either.
      sessionKey: HELPER_KEY,
    } as unknown as SendToAgentOptions);

    expect(session.writes[0].params).toEqual({
      sessionKey: MAIN_KEY,
      text: 'hello',
      idempotencyKey: 'key-1',
    });
  });

  it('reuses one idempotency key so a retry cannot double-post', async () => {
    const { runtime, session, agentId } = await talkingTo();
    const [first, second] = await Promise.all([
      runtime.send(agentId, 'ping', { idempotencyKey: 'retry-me' }),
      runtime.send(agentId, 'ping', { idempotencyKey: 'retry-me' }),
    ]);
    expect(session.writes).toHaveLength(1);
    expect(first).toEqual(second);
    // ...and the key the Gateway sees is the operator's, not a fresh one.
    expect(session.writes[0].params).toMatchObject({
      idempotencyKey: 'retry-me',
    });
  });

  it('mints a key when the caller supplies none, and never reuses it', async () => {
    const { runtime, agentId } = await talkingTo();
    const first = await runtime.send(agentId, 'one');
    const second = await runtime.send(agentId, 'two');
    if (!first.ok || !second.ok) throw new Error('expected two sends');
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('refuses a read-only source for every message, and the client sees nothing', async () => {
    const { runtime, session, agentId } = await talkingTo(
      undefined,
      {},
      'read'
    );

    for (const text of ['hello', 'are you there', 'status?']) {
      const result = await runtime.send(agentId, text);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.outcome).toBe('read-only-source');
      expect(result.message).toMatch(/write access/i);
    }
    expect(session.writes).toEqual([]);
    expect(session.write).not.toHaveBeenCalled();
  });

  it('separates a standing approval request from a source never asked', async () => {
    const { runtime, session, agentId } = await talkingTo(
      undefined,
      {
        authorityResult: {
          outcome: 'approval-required',
          authority: 'read',
          message: 'This source needs its own operator to approve the device.',
        },
      },
      'read'
    );

    const before = await runtime.send(agentId, 'hello');
    expect(before.ok ? null : before.outcome).toBe('read-only-source');

    const asked = await runtime.requestCommandAuthority('alpha');
    expect(asked.outcome).toBe('approval-required');
    expect(runtime.commandAuthority()).toEqual([
      {
        sourceId: 'alpha',
        displayName: 'Source alpha',
        authority: 'read',
        awaitingApproval: true,
      },
    ]);

    const after = await runtime.send(agentId, 'hello');
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.outcome).toBe('approval-pending');
    expect(after.message).toMatch(/approve/i);
    // Still no message left this process.
    expect(session.writes).toEqual([]);
  });

  it('stops waiting once the source answers the request another way', async () => {
    const { runtime, agentId } = await talkingTo(
      undefined,
      {
        authorityResult: {
          outcome: 'refused',
          authority: 'read',
          message: 'This source refused write access.',
        },
      },
      'read'
    );
    await runtime.requestCommandAuthority('alpha');
    expect(runtime.commandAuthority()[0].awaitingApproval).toBe(false);
    const result = await runtime.send(agentId, 'hello');
    expect(result.ok ? null : result.outcome).toBe('read-only-source');
  });

  it('refuses a coworker with no conversation, an unknown one, and a closed source distinctly', async () => {
    const { runtime, session } = await talkingTo([
      { nativeAgentId: 'scout', displayName: 'scout' },
      { nativeAgentId: 'tyler', displayName: 'Tyler', primary: false },
    ]);

    const noHome = await runtime.send(
      deriveRemoteAgentId('alpha', 'tyler'),
      'hello'
    );
    expect(noHome.ok ? null : noHome.outcome).toBe('no-primary-conversation');

    const unknown = await runtime.send('remote-nobody', 'hello');
    expect(unknown.ok ? null : unknown.outcome).toBe('unknown-agent');

    const empty = await runtime.send(
      deriveRemoteAgentId('alpha', 'scout'),
      '   '
    );
    expect(empty.ok ? null : empty.outcome).toBe('invalid-message');

    await runtime.dispose();
    const closed = await runtime.send(
      deriveRemoteAgentId('alpha', 'scout'),
      'hello'
    );
    expect(closed.ok ? null : closed.outcome).toBe('disconnected');

    expect(session.writes).toEqual([]);
  });

  it('reports a Gateway refusal without claiming anything about the coworker', async () => {
    const { runtime, agentId } = await talkingTo(undefined, {
      sendError: new Error('The Gateway rejected the request.'),
    });
    const result = await runtime.send(agentId, 'hello');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe('refused');
  });
});

describe('ConnectedSourceRuntime — following the reply', () => {
  it('forwards deltas in order, keyed to the Agent and the run', async () => {
    const { session, updates, agentId } = await talkingTo();

    for (const delta of ['Look', 'ing ', 'now']) {
      session.emitGatewayEvent('chat.segment', {
        sessionKey: MAIN_KEY,
        runId: 'run-9',
        delta,
        done: false,
      });
    }
    session.emitGatewayEvent('chat.segment', {
      sessionKey: MAIN_KEY,
      runId: 'run-9',
      delta: '',
      done: true,
    });

    expect(updates.map(update => update.kind)).toEqual([
      'delta',
      'delta',
      'delta',
      'complete',
    ]);
    expect(updates.map(update => update.text).join('')).toBe('Looking now');
    for (const update of updates) {
      expect(update.agentId).toBe(agentId);
      expect(update.sourceId).toBe('alpha');
      expect(update.contextId).toBe(MAIN_KEY);
      expect(update.runId).toBe('run-9');
    }
    const ordinals = updates.map(update => update.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it('forwards nothing for a context other than the primary conversation', async () => {
    const { session, updates } = await talkingTo();
    session.emitGatewayEvent('chat.segment', {
      sessionKey: HELPER_KEY,
      runId: 'run-9',
      delta: 'side work',
      done: false,
    });
    session.emitGatewayEvent('chat.segment', {
      sessionKey: 'agent:scout:cron',
      runId: 'run-9',
      delta: 'a scheduled run',
      done: false,
    });
    expect(updates).toEqual([]);
  });

  it('bounds one run and says so instead of streaming without end', async () => {
    const { session, updates } = await talkingTo();
    for (let index = 0; index < MAX_UPDATES_PER_RUN + 25; index += 1) {
      session.emitGatewayEvent('chat.segment', {
        sessionKey: MAIN_KEY,
        runId: 'run-long',
        delta: `${index} `,
        done: false,
      });
    }
    const kinds = updates.map(update => update.kind);
    expect(kinds.filter(kind => kind === 'delta')).toHaveLength(
      MAX_UPDATES_PER_RUN
    );
    expect(kinds.filter(kind => kind === 'bounded')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('bounded');
  });

  it('clips one update to its own budget', async () => {
    const { session, updates } = await talkingTo();
    session.emitGatewayEvent('chat.segment', {
      sessionKey: MAIN_KEY,
      runId: 'run-9',
      delta: 'y'.repeat(MAX_UPDATE_CHARACTERS * 3),
      done: false,
    });
    expect(updates[0].text.length).toBe(MAX_UPDATE_CHARACTERS);
  });

  it('never carries a transport sequence and never stores one as a cursor', async () => {
    const { session, updates, plans } = await talkingTo();
    const writesBefore = plans.writes;

    session.emitGatewayEvent('chat.segment', {
      sessionKey: MAIN_KEY,
      runId: 'run-9',
      delta: 'hi',
      done: true,
      // The Gateway resets these per connection and replays nothing, so they
      // must not reach the renderer and must not be persisted.
      seq: 4_211,
      stateVersion: 88,
    });

    for (const update of updates) {
      expect(Object.keys(update).sort()).toEqual([
        'agentId',
        'at',
        'contextId',
        'kind',
        'ordinal',
        'runId',
        'sourceId',
        'text',
      ]);
    }
    expect(plans.writes).toBe(writesBefore);
    expect(JSON.stringify(plans.plan)).not.toContain('4211');
    expect(JSON.stringify(plans.plan).toLowerCase()).not.toContain('seq');
  });

  it('recovers a reply in flight from history on reconnect, never from replay', async () => {
    const { runtime, session, updates, agentId } = await talkingTo(undefined, {
      history: {
        [MAIN_KEY]: transcript(
          { role: 'user', content: 'Any progress?' },
          { role: 'assistant', content: 'Posted it.', runId: 'run-9' }
        ),
      },
    });

    session.emitGatewayEvent('chat.segment', {
      sessionKey: MAIN_KEY,
      runId: 'run-9',
      delta: 'Post',
      done: false,
    });
    expect(updates.map(update => update.kind)).toEqual(['delta']);

    // The connection drops mid-reply and comes back. The Agent never stopped.
    session.emitPhase('reconnecting');
    session.emitPhase('connected');

    expect(updates.map(update => update.kind)).toEqual(['delta', 'resnapshot']);
    // Nothing was replayed: the only new update says "read it again".
    expect(updates.filter(update => update.kind === 'delta')).toHaveLength(1);

    const recovered = await runtime.conversation(agentId);
    if (!recovered.ok) throw new Error('expected a conversation');
    expect(recovered.turns.map(turn => turn.text)).toEqual([
      'Any progress?',
      'Posted it.',
    ]);
    expect(recovered.turns[1].runId).toBe('run-9');
  });

  it('stops forwarding once Exawatt has quit', async () => {
    const { runtime, session, updates } = await talkingTo();
    await runtime.dispose();
    session.emitGatewayEvent('chat.segment', {
      sessionKey: MAIN_KEY,
      runId: 'run-9',
      delta: 'anything',
      done: false,
    });
    expect(updates).toEqual([]);
  });
});

describe('ConnectedSourceRuntime — H2 says nothing about remote work', () => {
  it('never implies that work stopped, paused, or was lost', async () => {
    const sentences: string[] = [];
    const collect = (result: { ok: boolean; message?: string }) => {
      if (!result.ok && result.message) sentences.push(result.message);
    };

    const readOnly = await talkingTo(
      [
        { nativeAgentId: 'scout', displayName: 'scout' },
        { nativeAgentId: 'tyler', displayName: 'Tyler', primary: false },
      ],
      {
        authorityResult: {
          outcome: 'approval-required',
          authority: 'read',
          message: 'approval needed',
        },
      },
      'read'
    );
    const scout = deriveRemoteAgentId('alpha', 'scout');
    const tyler = deriveRemoteAgentId('alpha', 'tyler');

    collect(await readOnly.runtime.send(scout, 'hello'));
    await readOnly.runtime.requestCommandAuthority('alpha');
    collect(await readOnly.runtime.send(scout, 'hello'));
    collect(await readOnly.runtime.send(tyler, 'hello'));
    collect(await readOnly.runtime.send('remote-nobody', 'hello'));
    collect(await readOnly.runtime.send(scout, ' '));
    collect(await readOnly.runtime.conversation(tyler));
    collect(await readOnly.runtime.conversation('remote-nobody'));

    const failing = await talkingTo(undefined, {
      sendError: new Error('The Gateway rejected the request.'),
    });
    collect(await failing.runtime.send(scout, 'hello'));
    await failing.runtime.dispose();
    collect(await failing.runtime.send(scout, 'hello'));
    collect(await failing.runtime.conversation(scout));

    expect(sentences.length).toBeGreaterThan(8);
    const rendered = sentences.join(' ').toLowerCase();
    for (const word of [
      'stopped',
      'paused',
      'lost',
      'ended',
      'finished',
      'halted',
      'killed',
      'terminated',
      'crashed',
      'offline',
      'dead',
    ]) {
      expect(rendered).not.toContain(word);
    }
  });
});
