import type { AgentSourceEvidenceBasis } from '../agent-sources';
import type { AgentSourceTopologySnapshot } from '../agent-projection';
import { adaptOpenClawTopology } from '../oc/topology-adapter';
import { DEMO_WORKSPACE_NOW_MS, MIN_MS, HOUR_MS } from '../demo/startup';

/**
 * The Demo connected source (ENG-010 C3).
 *
 * A source-shaped fixture that answers the same calls a real OpenClaw Gateway
 * answers — `agents.list`, `sessions.list`, `chat.history`, `cron.list`,
 * `status` — so the Demo adapter and a live adapter can be held to one
 * projection and lifecycle contract. H1's last acceptance criterion asks for
 * exactly that parity, and until this existed there was no Demo connected
 * source to hold to anything.
 *
 * Four rules shape the file, and each of them is why it lives in `@exawatt/core`
 * beside `connected-source.ts` rather than in a test.
 *
 * 1. **Simulated, and structurally unable to claim otherwise.** Every snapshot
 *    this source produces carries `evidenceBasis: 'simulated'`, hard-coded at
 *    the one place a snapshot is built. Demo Mode must exercise the real
 *    contracts with simulated evidence; it must never produce a record another
 *    surface could read as observation.
 * 2. **Pure.** No socket, no process, no filesystem, no wall clock. The clock
 *    is a constructor argument and moves only when a caller advances it, so a
 *    contract run asserts on the situation it set up rather than on elapsed
 *    time.
 * 3. **Read-only, enforced here.** The source refuses `chat.send` and every
 *    other write the way a Gateway refuses a device that holds `operator.read`.
 *    That is what makes "observation never mutates the source" a fact the
 *    contract can observe rather than a claim about Exawatt's own allowlist.
 * 4. **Authored, and public-safe.** Every identifier, name, timestamp, and
 *    payload value is invented for Voltaic Grid Systems, the portrayed startup
 *    the rest of the Demo Workspace is written around. Nothing here was copied
 *    from an installation, endpoint, credential, filesystem, or payload, and
 *    nothing here names a host, address, user, key, or server.
 *
 * The levers below are the situations the lifecycle contract needs a source to
 * be able to be in: going away and coming back, restarting as the same
 * installation, restarting as a different one, an Agent retiring, an Agent
 * appearing, and a run starting and clearing.
 */

/** Everything simulated here starts from the Demo Workspace's frozen clock. */
export const DEMO_CONNECTED_SOURCE_NOW_MS = DEMO_WORKSPACE_NOW_MS;

/** The one basis a Demo source may ever claim. */
export const DEMO_CONNECTED_SOURCE_EVIDENCE: AgentSourceEvidenceBasis =
  'simulated';

/** The simulated Gateway's own version string. Invented. */
export const DEMO_CONNECTED_SOURCE_VERSION = 'demo-gateway-2026.8';

/** Read methods the simulated Gateway answers, as a live one would. */
export const DEMO_SOURCE_READ_METHODS = [
  'health',
  'status',
  'agents.list',
  'sessions.list',
  'chat.history',
  'cron.list',
  'cron.runs',
  'tasks.list',
  'sessions.subscribe',
  'sessions.unsubscribe',
  'sessions.messages.subscribe',
  'sessions.messages.unsubscribe',
] as const;

const READ_METHOD_SET: ReadonlySet<string> = new Set(DEMO_SOURCE_READ_METHODS);

/**
 * Writes the simulated Gateway refuses.
 *
 * Listed rather than derived from "everything not readable" so that a method
 * nobody thought of still lands in the unknown-method branch, which is a
 * different and louder failure than a refusal.
 */
export const DEMO_SOURCE_WRITE_METHODS = [
  'chat.send',
  'chat.abort',
  'sessions.steer',
  'tasks.cancel',
  'cron.create',
  'cron.update',
  'cron.delete',
  'agents.create',
  'agents.delete',
] as const;

const WRITE_METHOD_SET: ReadonlySet<string> = new Set(
  DEMO_SOURCE_WRITE_METHODS
);

/** What the source says when it cannot be reached. Never about the work. */
export const DEMO_SOURCE_UNREACHABLE_MESSAGE =
  'The demo source is not answering right now.';

/** What it says when Exawatt forms a write it was never granted. */
export const DEMO_SOURCE_WRITE_REFUSAL_MESSAGE =
  'FORBIDDEN: operator.write scope required';

/* ---- Authored topology --------------------------------------------------- */

const NOW = DEMO_CONNECTED_SOURCE_NOW_MS;

/**
 * Voltaic's two long-lived remote coworkers, plus the identities the same
 * endpoint reports after it is replaced by a different installation.
 *
 * The replacement deliberately keeps the display names and changes only the
 * native identities. That is the trap the brief names: an installation swap
 * that reads identical by name is exactly the case Exawatt may never resolve
 * by guessing, so the Demo source can put the product in front of it.
 */
export const DEMO_SOURCE_AGENT_MARKET = 'market-watch';
export const DEMO_SOURCE_AGENT_NEWSROOM = 'newsroom';
export const DEMO_SOURCE_AGENT_MARKET_REPLACEMENT = 'market-desk';
export const DEMO_SOURCE_AGENT_NEWSROOM_REPLACEMENT = 'press-desk';

/** An Agent the source retains history for and no longer configures. */
export const DEMO_SOURCE_AGENT_NIGHT_DESK = 'night-desk';

export const DEMO_SOURCE_INSTALLATION = 'demo-installation-north';
export const DEMO_SOURCE_INSTALLATION_REPLACEMENT = 'demo-installation-south';

interface DemoContextSeed {
  /** `agent:<nativeAgentId>:<discriminator>[:<rest>]`, as a Gateway keys it. */
  key: string;
  /** The Gateway's own label for the session kind, which may disagree. */
  kind: string;
  sessionId: string | null;
  parentKey: string | null;
  /** Absent means the source said nothing about a run, which is not "no". */
  hasActiveRun?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface DemoAgentSeed {
  id: string;
  /** The source's own configured name, which the operator may override. */
  name: string;
  contexts: DemoContextSeed[];
}

interface DemoAutomationSeed {
  name: string;
  agentId: string;
  enabled: boolean;
  lastStatus: 'ok' | 'error';
  lastRunAtMs: number;
  sessionTarget: string | null;
}

function marketAgent(id: string): DemoAgentSeed {
  return {
    id,
    name: 'Wren',
    contexts: [
      {
        key: `agent:${id}:main`,
        // The live probe found a Gateway labelling a cron session `direct`, so
        // the label is deliberately unhelpful here too: only the key segment
        // may decide what a context is.
        kind: 'direct',
        sessionId: `${id}-main`,
        parentKey: null,
        hasActiveRun: false,
        createdAt: NOW - 30 * HOUR_MS,
        updatedAt: NOW - 42 * MIN_MS,
      },
      {
        key: `agent:${id}:cron:price-sweep`,
        kind: 'direct',
        sessionId: `${id}-cron-price-sweep`,
        parentKey: null,
        hasActiveRun: false,
        createdAt: NOW - 26 * HOUR_MS,
        updatedAt: NOW - 18 * MIN_MS,
      },
      {
        key: `agent:${id}:subagent:basis-check`,
        kind: 'direct',
        sessionId: `${id}-subagent-basis-check`,
        parentKey: `agent:${id}:main`,
        hasActiveRun: false,
        createdAt: NOW - 3 * HOUR_MS,
        updatedAt: NOW - 9 * MIN_MS,
      },
      {
        key: `agent:${id}:thread:enrollment-notes`,
        kind: 'direct',
        sessionId: `${id}-thread-enrollment-notes`,
        parentKey: null,
        hasActiveRun: false,
        createdAt: NOW - 2 * HOUR_MS,
        updatedAt: NOW - 51 * MIN_MS,
      },
    ],
  };
}

function newsroomAgent(id: string): DemoAgentSeed {
  return {
    id,
    name: 'Dara',
    contexts: [
      {
        key: `agent:${id}:main`,
        kind: 'direct',
        sessionId: `${id}-main`,
        parentKey: null,
        hasActiveRun: false,
        createdAt: NOW - 41 * HOUR_MS,
        updatedAt: NOW - 2 * HOUR_MS,
      },
      {
        key: `agent:${id}:channel:launch-desk`,
        kind: 'direct',
        sessionId: `${id}-channel-launch-desk`,
        parentKey: null,
        hasActiveRun: false,
        createdAt: NOW - 12 * HOUR_MS,
        updatedAt: NOW - 34 * MIN_MS,
      },
    ],
  };
}

function automationsFor(marketId: string): DemoAutomationSeed[] {
  return [
    {
      name: 'wholesale-price-sweep',
      agentId: marketId,
      enabled: true,
      lastStatus: 'ok',
      lastRunAtMs: NOW - 18 * MIN_MS,
      sessionTarget: `agent:${marketId}:cron:price-sweep`,
    },
  ];
}

/**
 * The primary conversation the Demo source retains for its market coworker.
 *
 * Short and finished-sounding on purpose: the contract reads it twice across a
 * relaunch and asserts the turns are the same turns, so anything that changes
 * between reads would be the replay the acceptance criteria forbid.
 */
interface DemoTurnSeed {
  role: string;
  content: string;
  timestamp: number;
  runId: string | null;
}

function marketHistory(marketId: string): DemoTurnSeed[] {
  return [
    {
      role: 'user',
      content: 'What moved on the day-ahead curve overnight?',
      timestamp: NOW - 61 * MIN_MS,
      runId: null,
    },
    {
      role: 'assistant',
      content:
        'Evening peak cleared eleven percent above the week median. I put the hour-by-hour breakdown in the sweep notes.',
      timestamp: NOW - 60 * MIN_MS,
      runId: `${marketId}-run-0141`,
    },
    {
      role: 'user',
      content: 'Anything the enrollment team should hear about?',
      timestamp: NOW - 44 * MIN_MS,
      runId: null,
    },
    {
      role: 'assistant',
      content:
        'One county is pricing well above the rest for evening capacity. Worth a note to whoever owns that territory.',
      timestamp: NOW - 42 * MIN_MS,
      runId: `${marketId}-run-0142`,
    },
  ];
}

/* ---- The source ---------------------------------------------------------- */

export interface DemoConnectedSourceOptions {
  /** The configured source this simulated Gateway answers as. */
  configuredSourceId?: string;
  /** Fixture clock, in epoch ms. Moves only through `advance`. */
  now?: number;
}

/** One method the source was asked for, in the order it was asked. */
export interface DemoSourceCall {
  method: string;
  params: unknown;
  at: number;
}

interface InstallationState {
  installationId: string;
  version: string;
  agents: DemoAgentSeed[];
  automations: DemoAutomationSeed[];
  history: Record<string, DemoTurnSeed[]>;
  /** Agents this installation retains history for and no longer configures. */
  retired: string[];
}

function northInstallation(): InstallationState {
  const market = marketAgent(DEMO_SOURCE_AGENT_MARKET);
  const newsroom = newsroomAgent(DEMO_SOURCE_AGENT_NEWSROOM);
  return {
    installationId: DEMO_SOURCE_INSTALLATION,
    version: DEMO_CONNECTED_SOURCE_VERSION,
    agents: [market, newsroom],
    automations: automationsFor(DEMO_SOURCE_AGENT_MARKET),
    history: {
      [`agent:${DEMO_SOURCE_AGENT_MARKET}:main`]: marketHistory(
        DEMO_SOURCE_AGENT_MARKET
      ),
    },
    retired: [DEMO_SOURCE_AGENT_NIGHT_DESK],
  };
}

function southInstallation(): InstallationState {
  const market = marketAgent(DEMO_SOURCE_AGENT_MARKET_REPLACEMENT);
  const newsroom = newsroomAgent(DEMO_SOURCE_AGENT_NEWSROOM_REPLACEMENT);
  return {
    installationId: DEMO_SOURCE_INSTALLATION_REPLACEMENT,
    version: `${DEMO_CONNECTED_SOURCE_VERSION}-b`,
    agents: [market, newsroom],
    automations: automationsFor(DEMO_SOURCE_AGENT_MARKET_REPLACEMENT),
    history: {
      [`agent:${DEMO_SOURCE_AGENT_MARKET_REPLACEMENT}:main`]: marketHistory(
        DEMO_SOURCE_AGENT_MARKET_REPLACEMENT
      ),
    },
    retired: [],
  };
}

export class DemoConnectedSource {
  readonly configuredSourceId: string;

  private state: InstallationState = northInstallation();
  private clock: number;
  private reachable = true;
  private readonly received: DemoSourceCall[] = [];
  /** Bumped by every restart so a caller can tell one lifetime from the next. */
  private lifetime = 1;

  constructor(options: DemoConnectedSourceOptions = {}) {
    this.configuredSourceId =
      options.configuredSourceId ?? 'demo-connected-source';
    this.clock = options.now ?? DEMO_CONNECTED_SOURCE_NOW_MS;
  }

  /** The one basis this source may ever claim about its own evidence. */
  get evidenceBasis(): AgentSourceEvidenceBasis {
    return DEMO_CONNECTED_SOURCE_EVIDENCE;
  }

  /** Which simulated installation is behind the endpoint right now. */
  get installationId(): string {
    return this.state.installationId;
  }

  /** How many times this source has restarted, from one. */
  get lifetimeCount(): number {
    return this.lifetime;
  }

  get now(): number {
    return this.clock;
  }

  /** True while the source answers at all. */
  get answering(): boolean {
    return this.reachable;
  }

  /** Native ids the source currently declares configured, in stable order. */
  get configuredAgentIds(): readonly string[] {
    return this.state.agents.map(agent => agent.id).sort();
  }

  /** The source's own configured name per Agent, so a rename is observable. */
  get configuredAgentNames(): Readonly<Record<string, string>> {
    const names: Record<string, string> = {};
    for (const agent of this.state.agents) names[agent.id] = agent.name;
    return names;
  }

  /** Session keys the source currently retains, in stable order. */
  get retainedContextKeys(): readonly string[] {
    return this.state.agents
      .flatMap(agent => agent.contexts.map(context => context.key))
      .sort();
  }

  /** Every method asked of this source, in order. */
  get calls(): readonly DemoSourceCall[] {
    return this.received;
  }

  /* ---- Protocol ---------------------------------------------------------- */

  /**
   * Answer one Gateway method.
   *
   * Synchronous because the source is pure: a caller that needs a promise
   * wraps it, and nothing here may hide a scheduling difference behind an
   * `await`. Unreachable throws, a write is refused the way the source would
   * refuse a read-scoped device, and a method the source does not implement
   * throws loudly rather than answering an empty shape.
   */
  call(method: string, params?: unknown): unknown {
    this.received.push({ method, params, at: this.clock });
    if (WRITE_METHOD_SET.has(method)) {
      throw new Error(DEMO_SOURCE_WRITE_REFUSAL_MESSAGE);
    }
    if (!READ_METHOD_SET.has(method)) {
      throw new Error(`The demo source does not implement "${method}".`);
    }
    if (!this.reachable) {
      throw new Error(DEMO_SOURCE_UNREACHABLE_MESSAGE);
    }
    return this.answer(method, params);
  }

  private answer(method: string, params?: unknown): unknown {
    switch (method) {
      case 'health':
        return { ok: true };
      case 'status':
        return {
          version: this.state.version,
          // Source-wide totals, deliberately not attributable to any Agent.
          tasks: {
            total: 9,
            active: 1,
            terminal: 8,
            failures: 0,
            byStatus: { running: 1, succeeded: 8 },
            byRuntime: { cron: 7, subagent: 2 },
          },
          taskAudit: { warnings: 0, errors: 0 },
        };
      case 'agents.list':
        return {
          agents: this.state.agents.map(agent => ({
            id: agent.id,
            name: agent.name,
            // Fields a real listing carries and the adapter must never copy.
            workspace: '/invented/never/read',
            model: 'invented-model',
            runtime: 'invented-runtime',
          })),
        };
      case 'sessions.list': {
        const agentId = (params as { agentId?: unknown } | undefined)?.agentId;
        const agent = this.state.agents.find(entry => entry.id === agentId);
        if (!agent) return { sessions: [] };
        return {
          sessions: agent.contexts.map(context => ({
            key: context.key,
            kind: context.kind,
            ...(context.sessionId === null
              ? {}
              : { sessionId: context.sessionId }),
            ...(context.parentKey === null
              ? {}
              : { parentKey: context.parentKey }),
            ...(context.hasActiveRun === undefined
              ? {}
              : { hasActiveRun: context.hasActiveRun }),
            createdAt: context.createdAt,
            updatedAt: context.updatedAt,
          })),
        };
      }
      case 'chat.history': {
        // `chat.history` takes `sessionKey` while the subscribe methods take
        // `key`. The protocol is not uniform there, so the Demo source is not
        // uniform either: a fixture that smoothed it over would let a caller
        // pass the wrong parameter name and still look correct.
        const sessionKey = (params as { sessionKey?: unknown } | undefined)
          ?.sessionKey;
        const key = typeof sessionKey === 'string' ? sessionKey : '';
        return { sessionKey: key, messages: this.state.history[key] ?? [] };
      }
      case 'cron.list':
        return {
          jobs: this.state.automations.map(automation => ({
            name: automation.name,
            agentId: automation.agentId,
            enabled: automation.enabled,
            state: {
              lastStatus: automation.lastStatus,
              lastRunAtMs: automation.lastRunAtMs,
              ...(automation.sessionTarget === null
                ? {}
                : { sessionTarget: automation.sessionTarget }),
            },
          })),
        };
      case 'cron.runs':
        return { runs: [] };
      case 'tasks.list':
        return { tasks: [] };
      default:
        // Every subscription. Observation, and the Demo source streams nothing:
        // the reader falls back to authoritative history, which is the same
        // fallback a Gateway that refuses the subscription leaves behind.
        return { ok: true };
    }
  }

  /**
   * This source's own authoritative snapshot.
   *
   * The one place a Demo snapshot is built, and the one place its basis is
   * decided: `simulated`, always, so no caller can wire this source up as
   * observation.
   *
   * Deliberately not routed through `call`: this is what the source knows
   * about itself, so it neither records a call nor depends on whether Exawatt
   * can currently reach it. A source Exawatt cannot see still has its people.
   */
  snapshot(observedAt = this.clock): AgentSourceTopologySnapshot {
    const adapted = adaptOpenClawTopology({
      configuredSourceId: this.configuredSourceId,
      gatewayId: this.configuredSourceId,
      placement: 'customer-hosted',
      evidenceBasis: DEMO_CONNECTED_SOURCE_EVIDENCE,
      observedAt,
      agentsList: this.answer('agents.list'),
      sessionLists: this.state.agents.map(agent => ({
        nativeAgentId: agent.id,
        payload: this.answer('sessions.list', { agentId: agent.id }),
      })),
      cronList: this.answer('cron.list'),
      statusPayload: this.answer('status'),
    });
    if (!adapted.ok) {
      // Unreachable with authored data, and a hard failure rather than a
      // degraded snapshot: a Demo fixture the adapter cannot read is a fixture
      // bug, and returning something shaped-but-wrong would hide it.
      throw new Error(
        `The demo source authored a topology its own adapter refused: ${adapted.issues
          .map(issue => issue.code)
          .join(', ')}`
      );
    }
    return adapted.snapshot;
  }

  /* ---- Levers ------------------------------------------------------------ */

  /** Move the fixture clock. Nothing here reads a wall clock. */
  advance(ms: number): void {
    this.clock += Math.max(0, Math.floor(ms));
  }

  /**
   * The source stops answering. It keeps every Agent, context, automation, and
   * turn: this is Exawatt losing sight of the source, never the source losing
   * its work.
   */
  goAway(): void {
    this.reachable = false;
  }

  /** The source answers again, with everything it had. */
  comeBack(): void {
    this.reachable = true;
  }

  /**
   * The source restarts and reports the same installation.
   *
   * Run state does not survive a restart, so every context comes back with no
   * run in flight; identities do survive, which is the whole point of the case.
   */
  restart(): void {
    this.lifetime += 1;
    for (const agent of this.state.agents) {
      for (const context of agent.contexts) {
        if (context.hasActiveRun !== undefined) context.hasActiveRun = false;
        if (context.sessionId !== null) {
          // A new process means new run identities. Coworker identity is not a
          // run identity, and nothing downstream may confuse the two.
          context.sessionId = `${context.key}-run-${this.lifetime}`;
        }
      }
    }
    this.reachable = true;
  }

  /**
   * The same endpoint now answers as a different installation.
   *
   * Display names are unchanged and native identities are all new, so nothing
   * but the identities distinguishes it. Rebinding by name would move the
   * operator's coworkers onto a machine they never connected.
   */
  restartAsAnotherInstallation(): void {
    this.state = southInstallation();
    this.lifetime += 1;
    this.reachable = true;
  }

  /**
   * The source no longer declares one Agent configured.
   *
   * It keeps the Agent's history, which is what "retired" means on a source:
   * the identity stops being configured and its retained work stays on disk.
   */
  retireAgent(nativeAgentId: string): void {
    const index = this.state.agents.findIndex(
      agent => agent.id === nativeAgentId
    );
    if (index < 0) return;
    this.state.agents.splice(index, 1);
    if (!this.state.retired.includes(nativeAgentId)) {
      this.state.retired.push(nativeAgentId);
    }
    this.state.automations = this.state.automations.filter(
      automation => automation.agentId !== nativeAgentId
    );
  }

  /** A newly configured Agent appears on the source. */
  configureAgent(nativeAgentId: string, displayName: string): void {
    if (this.state.agents.some(agent => agent.id === nativeAgentId)) return;
    this.state.agents.push({
      id: nativeAgentId,
      name: displayName,
      contexts: [
        {
          key: `agent:${nativeAgentId}:main`,
          kind: 'direct',
          sessionId: `${nativeAgentId}-main`,
          parentKey: null,
          hasActiveRun: false,
          createdAt: this.clock,
          updatedAt: this.clock,
        },
      ],
    });
    this.state.retired = this.state.retired.filter(id => id !== nativeAgentId);
  }

  /** A run starts in one Agent's primary conversation. */
  startRun(nativeAgentId: string): void {
    this.setRun(nativeAgentId, true);
  }

  /** The source no longer reports a run in flight for that Agent. */
  clearRun(nativeAgentId: string): void {
    this.setRun(nativeAgentId, false);
  }

  /**
   * The source stops retaining one context.
   *
   * Retention is the source's business; Exawatt's business is that its next
   * authoritative read replaces the tree instead of keeping a context nobody
   * reported any more.
   */
  forgetContext(nativeContextId: string): void {
    for (const agent of this.state.agents) {
      const index = agent.contexts.findIndex(
        context => context.key === nativeContextId
      );
      if (index >= 0) agent.contexts.splice(index, 1);
    }
  }

  private setRun(nativeAgentId: string, running: boolean): void {
    const agent = this.state.agents.find(entry => entry.id === nativeAgentId);
    if (!agent) return;
    const main = agent.contexts.find(
      context => context.key === `agent:${agent.id}:main`
    );
    if (main) main.hasActiveRun = running;
  }
}
