import assert from 'node:assert/strict';
import type {
  AgentSourceAdapterId,
  AgentSourceEvidenceBasis,
} from '@exawatt/core';
import type { ConnectedAgentMapping } from './connected-agent-projection-plan';
import type {
  ConnectedSourceRuntime,
  ConnectedSourceStatusView,
  RemoteAgentView,
} from './connected-source-runtime';

/**
 * The connected-source lifecycle contract (ENG-010 C3).
 *
 * H1's last acceptance criterion is a parity criterion: *"Demo and live
 * adapters pass the same projection and lifecycle contract tests."* C1 and C2
 * were proved by hand against two real Gateways, and that proof does not
 * survive into CI. This file is the promises themselves, written once, so a
 * Demo adapter and a live one are held to the same ones instead of to two
 * suites that drift apart.
 *
 * Three decisions shape the seam.
 *
 * 1. **The contract knows nothing about how a source is implemented.** It sees
 *    a `LifecycleWorld`: the runtime that is observing, and a small set of
 *    levers for the situations the criteria are about — going away and coming
 *    back, restarting as the same installation, restarting as a different one,
 *    an Agent retiring, a rename, a detach, a relaunch. An adapter decides how
 *    each lever is pulled. Nothing below reaches for a session, a client, a
 *    tunnel, a store, or a fixture.
 * 2. **The contract carries no test framework.** Cases are data with an async
 *    body and `node:assert`, so this module compiles and runs anywhere and the
 *    runner binds them to `describe`/`it`. It also means this file, which the
 *    Electron build compiles, pulls in no development dependency.
 * 3. **An adapter declares what it cannot do, in two separate ways, because
 *    they mean different things.** `supports` says which levers exist for that
 *    source; a case whose lever is missing is skipped, and skipping is honest
 *    because the promise was never exercised. `knownGaps` says the lever
 *    exists, the case runs, and the product does not keep the promise yet; the
 *    runner expects that case to fail, so fixing the runtime turns the suite
 *    red until the declaration is removed. Neither is written into the case:
 *    the contract states what the product owes, never what it currently does.
 */

/* ---- Levers -------------------------------------------------------------- */

/**
 * Situations an adapter may be able to put its source into.
 *
 * Deliberately named after what happens to the operator's world rather than
 * after a mechanism: a live adapter reaches these by very different means than
 * a Demo one, and the contract must not care which.
 */
export const LIFECYCLE_LEVERS = [
  /** The connection drops mid-observation and later comes back. */
  'outage',
  /** Exawatt quits and starts again over the same persisted state. */
  'relaunch',
  /** The source restarts and reports the same installation. */
  'restart-same-identity',
  /** The same endpoint answers as a different installation. */
  'restart-other-identity',
  /** The source stops declaring an Agent configured. */
  'retire-agent',
  /** The source stops retaining one subordinate context. */
  'forget-context',
  /** A run starts or clears on the source. */
  'run-state',
  /** The operator renames a coworker or moves it between Projects. */
  'rename',
  /** The operator detaches the source and connects it again. */
  'detach',
  /** The source's own state and call log can be inspected directly. */
  'inspect-source',
] as const;
export type LifecycleLever = (typeof LIFECYCLE_LEVERS)[number];

/**
 * What an adapter throws from a lever it does not support.
 *
 * Reachable only through a bug in a runner, because a case whose lever is
 * unsupported is never started. It exists so that bug says what it is.
 */
export function unsupportedLever(lever: LifecycleLever): never {
  throw new Error(
    `This adapter declares no "${lever}" lever, so the contract must not have run a case that needs it.`
  );
}

/* ---- The world under contract -------------------------------------------- */

/**
 * One adapter's live world: the runtime observing a source, plus the levers.
 *
 * Every reader is a method rather than a field because `relaunch` and
 * `reattach` replace the objects underneath; a case that captured a runtime
 * reference would keep asserting against the process that already quit.
 */
export interface LifecycleWorld {
  /** The runtime observing right now. Replaced by `relaunch`. */
  runtime(): ConnectedSourceRuntime;
  /** The configured source under contract. Replaced by `reattach`. */
  sourceId(): string;
  /** The adapter this source is configured as. */
  declaredAdapterId(): AgentSourceAdapterId;
  /** The evidence basis this source's observations are entitled to claim. */
  declaredEvidenceBasis(): AgentSourceEvidenceBasis;
  /** The basis Exawatt actually recorded on the snapshot it is holding. */
  recordedEvidenceBasis(): AgentSourceEvidenceBasis | null;
  /** The persisted projection plan, so a silent rebind is observable. */
  mappings(): readonly ConnectedAgentMapping[];
  /** Native ids the source declares configured right now. */
  configuredNativeAgentIds(): readonly string[];
  /** Repair observation: take one fresh authoritative snapshot. */
  reobserve(): Promise<void>;

  /* Levers. Each throws `unsupportedLever` unless `supports` names it. */

  /** The connection is lost mid-observation. The source keeps working. */
  loseConnection(): Promise<void>;
  /** The connection comes back. */
  restoreConnection(): Promise<void>;
  /** The source restarts and reports the same installation. */
  restartSource(): Promise<void>;
  /** The same endpoint answers as a different installation. */
  restartSourceAsAnotherInstallation(): Promise<void>;
  /** The source stops declaring that Agent configured. */
  retireAgent(nativeAgentId: string): Promise<void>;
  /** The source drops one subordinate context; returns which. */
  forgetOneSubordinateContext(nativeAgentId: string): Promise<string>;
  /** A run starts in that Agent's primary conversation. */
  startRun(nativeAgentId: string): Promise<void>;
  /** The operator renames a coworker or moves it between Projects. */
  rename(input: LifecycleRenameInput): Promise<void>;
  /** Quit and start again over the same persisted state. */
  relaunch(): Promise<void>;
  /** Detach the source: Exawatt's record and credential, and nothing else. */
  detach(): Promise<void>;
  /** Connect the same source again, as the Connect flow would. */
  reattach(): Promise<void>;
  /** True while Exawatt holds a stored credential for this source. */
  hasStoredCredential(): boolean;
  /** Every Gateway method the source was asked for, in order. */
  sourceCalls(): readonly string[];
  /** The source's own configured name per Agent. */
  sourceAgentNames(): Readonly<Record<string, string>>;

  /** Release whatever the world holds. Never touches the source. */
  close(): Promise<void>;
}

export interface LifecycleRenameInput {
  nativeAgentId: string;
  projectId: string;
  projectLabel: string;
  displayNameOverride: string | null;
}

export interface ConnectedSourceLifecycleAdapter {
  /** Short name for the suite title, e.g. `demo`. */
  readonly name: string;
  /** Levers this adapter can pull. Cases needing another are skipped. */
  readonly supports: readonly LifecycleLever[];
  /**
   * Cases this adapter cannot pass yet, by id, each with one sentence saying
   * what the product does instead. The runner expects them to fail.
   */
  readonly knownGaps: Readonly<Record<string, string>>;
  /** Stand up one world, already observing, with its coworkers mapped. */
  open(): Promise<LifecycleWorld>;
}

/* ---- Shared vocabulary --------------------------------------------------- */

/**
 * Words the product may never use about work it merely stopped watching.
 *
 * Whole words only: `suspended` and `recommended` contain `ended`, and the
 * rule is about what a sentence claims, not about substrings.
 */
export const STOPPED_WORK_WORDS = /\b(stopped|paused|lost|ended|finished)\b/iu;

/**
 * Methods that change someone's server.
 *
 * Written out here rather than derived from the Gateway session's own
 * allowlist on purpose: a contract that asked the code under test what counts
 * as a write would pass the day that list gained one.
 */
export const MUTATING_GATEWAY_METHODS: readonly string[] = [
  'chat.send',
  'chat.abort',
  'sessions.steer',
  'tasks.cancel',
  'cron.create',
  'cron.update',
  'cron.delete',
  'cron.run',
  'cron.enable',
  'cron.disable',
  'config.set',
  'agents.create',
  'agents.delete',
  'gateway.stop',
  'gateway.restart',
];

/* ---- Reading the world --------------------------------------------------- */

/** Every coworker this world's source projects, in stable id order. */
function coworkers(world: LifecycleWorld): RemoteAgentView[] {
  const sourceId = world.sourceId();
  return world
    .runtime()
    .agents()
    .filter(agent => agent.source.id === sourceId)
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    );
}

function statusOf(world: LifecycleWorld): ConnectedSourceStatusView | null {
  const sourceId = world.sourceId();
  return (
    world
      .runtime()
      .status()
      .find(status => status.sourceId === sourceId) ?? null
  );
}

function requireStatus(world: LifecycleWorld): ConnectedSourceStatusView {
  const status = statusOf(world);
  assert.ok(status, 'The configured source is missing from the registry.');
  return status;
}

function ids(agents: readonly RemoteAgentView[]): string[] {
  return agents.map(agent => agent.id);
}

/** Everything about a coworker that a lifecycle transition must not change. */
function identityOf(agent: RemoteAgentView): Record<string, unknown> {
  return {
    id: agent.id,
    displayName: agent.displayName,
    projectId: agent.projectId,
    projectLabel: agent.projectLabel,
    nativeAgentId: agent.nativeAgentId,
    sourceId: agent.source.id,
  };
}

function identities(
  agents: readonly RemoteAgentView[]
): Record<string, unknown>[] {
  return agents.map(identityOf);
}

function assertNoDuplicates(
  agents: readonly RemoteAgentView[],
  when: string
): void {
  const seen = ids(agents);
  assert.equal(
    new Set(seen).size,
    seen.length,
    `${when}: the roster holds the same coworker twice.`
  );
  const natives = agents.map(
    agent => `${agent.source.id} ${agent.nativeAgentId}`
  );
  assert.equal(
    new Set(natives).size,
    natives.length,
    `${when}: one source Agent produced more than one coworker.`
  );
}

/**
 * The subordination invariant, asserted after every transition that touches
 * the roster: no cron, helper, channel, or spawned context may ever become a
 * coworker, and no coworker may exist that the source does not configure.
 */
function assertContextsStaySubordinate(
  world: LifecycleWorld,
  when: string
): void {
  const configured = new Set(world.configuredNativeAgentIds());
  const agents = coworkers(world);
  assertNoDuplicates(agents, when);
  assert.ok(
    agents.length <= configured.size,
    `${when}: there are more coworkers (${agents.length}) than the source configures (${configured.size}).`
  );
  for (const agent of agents) {
    assert.ok(
      configured.has(agent.nativeAgentId),
      `${when}: "${agent.nativeAgentId}" is a coworker but is not an Agent the source configures.`
    );
    assert.ok(
      !agent.nativeAgentId.includes(':'),
      `${when}: "${agent.nativeAgentId}" reads as a session key, so a context became a coworker.`
    );
    if (agent.primaryContextId !== null) {
      assert.ok(
        agent.primaryContextId === `agent:${agent.nativeAgentId}:main`,
        `${when}: "${agent.displayName}" opens on ${agent.primaryContextId} rather than that Agent's own main context.`
      );
    }
  }
}

function firstCoworker(world: LifecycleWorld, when: string): RemoteAgentView {
  const [agent] = coworkers(world);
  assert.ok(agent, `${when}: the world stood up with no coworkers to test.`);
  return agent;
}

/**
 * The coworker holding the most conversation, so a replay or a dropped turn
 * has somewhere to show. An adapter whose coworkers have never been spoken to
 * is a legitimate world; the case that uses this says so rather than passing
 * on an empty transcript.
 */
async function talkativeCoworker(
  world: LifecycleWorld
): Promise<RemoteAgentView> {
  const runtime = world.runtime();
  let best = firstCoworker(world, 'before reading a conversation');
  let bestTurns = -1;
  for (const agent of coworkers(world)) {
    const conversation = await runtime.conversation(agent.id);
    const turns = conversation.ok ? conversation.turns.length : -1;
    if (turns > bestTurns) {
      best = agent;
      bestTurns = turns;
    }
  }
  return best;
}

/** Every operator-facing string the world is producing right now. */
async function copyOnScreen(world: LifecycleWorld): Promise<string[]> {
  const runtime = world.runtime();
  const strings: string[] = [];
  for (const status of runtime.status()) {
    strings.push(status.connection.label, status.connection.detail);
  }
  for (const agent of runtime.agents()) {
    strings.push(agent.connection.label, agent.connection.detail);
  }
  for (const agent of coworkers(world)) {
    const conversation = await runtime.conversation(agent.id, { limit: 5 });
    if (!conversation.ok) strings.push(conversation.message);
    const attempt = await runtime.send(agent.id, 'contract probe');
    if (!attempt.ok) strings.push(attempt.message);
  }
  const unknown = await runtime.conversation('coworker-that-does-not-exist');
  if (!unknown.ok) strings.push(unknown.message);
  return strings;
}

/* ---- The contract -------------------------------------------------------- */

export interface LifecycleContractCase {
  /** Stable id. Adapters name these in `knownGaps`, so it is a contract too. */
  id: string;
  /** Reads as the promise, because a failing test name is the report. */
  title: string;
  /** The H1 acceptance criterion or Key state this case exists for. */
  criterion: string;
  requires: readonly LifecycleLever[];
  run(world: LifecycleWorld): Promise<void>;
}

export const CONNECTED_SOURCE_LIFECYCLE_CONTRACT: readonly LifecycleContractCase[] =
  [
    {
      id: 'relaunch/same-coworkers',
      title:
        'relaunch returns the same coworkers, with the same Exawatt ids and no duplicates',
      criterion:
        'Relaunch returns to the same Agent, resnapshots authoritative state, and reconciles active work without duplication or replay.',
      requires: ['relaunch'],
      async run(world) {
        const before = identities(coworkers(world));
        assert.ok(before.length > 0, 'The world stood up with no coworkers.');

        await world.relaunch();

        const after = coworkers(world);
        assertNoDuplicates(after, 'after a relaunch');
        assert.deepEqual(
          identities(after),
          before,
          'A relaunch changed who the coworkers are, or what they are called.'
        );
        assertContextsStaySubordinate(world, 'after a relaunch');
      },
    },
    {
      id: 'relaunch/resnapshot-without-replay',
      title:
        'relaunch takes a fresh authoritative snapshot and replays no turn of the conversation',
      criterion:
        'Relaunch reconnects, replaces cached views from authoritative source snapshots, and reconciles later events by stable source identity.',
      requires: ['relaunch'],
      async run(world) {
        const target = await talkativeCoworker(world);
        const before = await world.runtime().conversation(target.id);
        assert.ok(
          before.ok,
          'The coworker had no readable conversation to compare.'
        );
        assert.ok(
          before.turns.length > 0,
          'No coworker in this world holds a conversation, so a replay would be invisible.'
        );
        const observedBefore = target.observedAt;

        await world.relaunch();

        const status = requireStatus(world);
        assert.ok(
          status.snapshotRevision >= 1,
          'A relaunch produced no authoritative snapshot: the new process is showing a cached roster.'
        );
        const after = coworkers(world).find(agent => agent.id === target.id);
        assert.ok(after, 'The coworker did not survive the relaunch.');
        assert.ok(
          after.observedAt > observedBefore,
          'A relaunch presented the cached observation instead of resnapshotting.'
        );
        const reread = await world.runtime().conversation(target.id);
        assert.ok(
          reread.ok,
          'The conversation was unreadable after the relaunch.'
        );
        assert.deepEqual(
          reread.turns.map(turn => turn.id),
          before.turns.map(turn => turn.id),
          'A relaunch replayed, dropped, or renamed a turn of the conversation.'
        );
      },
    },
    {
      id: 'outage/reconnect-keeps-watching',
      title:
        'repairing observation leaves Exawatt watching, so the next outage is still noticed',
      criterion:
        'Reconnect repairs observation. Reconnecting: last-known content plus a quiet reconnecting treatment.',
      requires: ['outage'],
      async run(world) {
        const runtime = world.runtime();
        const repaired = await runtime.connect(world.sourceId());
        assert.ok(
          repaired.ok,
          'Repairing observation on a source that was already connected failed.'
        );

        await world.loseConnection();

        assert.equal(
          requireStatus(world).connection.state,
          'reconnecting',
          'After the operator repaired observation, a later outage went unnoticed and the source still reads as current.'
        );
      },
    },
    {
      id: 'outage/reports-reconnecting',
      title:
        'a connection lost mid-observation reports Reconnecting, keeps last-known content, and concludes nothing about the work',
      criterion:
        'Reconnecting: last-known content plus a quiet reconnecting treatment; remote work is presumed unknown, never stopped.',
      requires: ['outage'],
      async run(world) {
        const before = coworkers(world);
        assert.ok(before.length > 0, 'The world stood up with no coworkers.');
        const workBefore = before.map(agent => ({
          id: agent.id,
          workState: agent.workState,
          contextCount: agent.contextCount,
          observedAt: agent.observedAt,
        }));

        await world.loseConnection();

        const status = requireStatus(world);
        assert.equal(
          status.connection.state,
          'reconnecting',
          'A lost connection did not report Reconnecting.'
        );
        assert.equal(
          status.connection.label,
          'Reconnecting',
          'The freshness label did not say Reconnecting.'
        );
        assert.equal(
          status.connection.stalePresentation,
          true,
          'A reconnecting source presented its cached view as current.'
        );

        const during = coworkers(world);
        assert.deepEqual(
          identities(during),
          identities(before),
          'A lost connection changed who the coworkers are.'
        );
        assert.deepEqual(
          during.map(agent => ({
            id: agent.id,
            workState: agent.workState,
            contextCount: agent.contextCount,
            observedAt: agent.observedAt,
          })),
          workBefore,
          'A lost connection changed what Exawatt claims about the remote work.'
        );
        for (const agent of during) {
          assert.equal(
            agent.connection.state,
            'reconnecting',
            `"${agent.displayName}" did not carry the reconnecting freshness.`
          );
          assert.equal(
            agent.connection.stalePresentation,
            true,
            `"${agent.displayName}" presented last-known content as current.`
          );
        }
        assertContextsStaySubordinate(world, 'during an outage');
      },
    },
    {
      id: 'outage/recovery-resnapshots',
      title:
        'recovery replaces the topology from an authoritative read rather than merging deltas into the cached one',
      criterion:
        'Snapshots are replaceable and idempotent. Reconnect always permits an authoritative resnapshot.',
      requires: ['outage', 'forget-context', 'run-state'],
      async run(world) {
        const target = firstCoworker(world, 'before an outage');
        const contextsBefore = target.contextCount;
        const observedBefore = target.observedAt;

        await world.loseConnection();
        const dropped = await world.forgetOneSubordinateContext(
          target.nativeAgentId
        );
        assert.ok(
          dropped.length > 0,
          'The source dropped no context, so a merge and a replacement would look the same.'
        );
        await world.startRun(target.nativeAgentId);
        await world.restoreConnection();

        const after = coworkers(world).find(agent => agent.id === target.id);
        assert.ok(after, 'The coworker did not survive the outage.');
        assert.equal(
          after.contextCount,
          contextsBefore - 1,
          'Recovery kept a context the source no longer reports, so it merged rather than replaced.'
        );
        assert.equal(
          after.workState,
          'working',
          'Recovery did not pick up the run the source started while Exawatt was away.'
        );
        assert.ok(
          after.observedAt > observedBefore,
          'Recovery reused the observation it had before the outage.'
        );
        assertContextsStaySubordinate(world, 'after recovering from an outage');
      },
    },
    {
      id: 'outage/recovery-bumps-the-snapshot-revision',
      title:
        'recovering from an outage bumps the snapshot revision, so a surface keyed on it reads what the reconnect brought in',
      criterion:
        'Reconnect always permits an authoritative resnapshot. The snapshot revision is bumped by an authoritative snapshot.',
      requires: ['outage'],
      async run(world) {
        const before = requireStatus(world).snapshotRevision;

        await world.loseConnection();

        assert.equal(
          requireStatus(world).snapshotRevision,
          before,
          'Losing a connection bumped the snapshot revision, so a surface re-reads a roster that nothing replaced.'
        );

        await world.restoreConnection();

        assert.ok(
          requireStatus(world).snapshotRevision > before,
          'A reconnect resnapshotted authoritatively and left the revision where it was, so a surface keyed on it never learns what the reconnect brought in.'
        );
      },
    },
    {
      id: 'restart/same-identity',
      title:
        'a source restart that reports the same installation keeps the coworkers and rebinds nothing',
      criterion:
        'A reconnect may refresh source facts but cannot duplicate an Agent, rerun a turn, or silently change its Project.',
      requires: ['restart-same-identity'],
      async run(world) {
        const before = identities(coworkers(world));
        const mappingsBefore = world.mappings();
        assert.ok(before.length > 0, 'The world stood up with no coworkers.');

        await world.restartSource();

        const status = requireStatus(world);
        assert.equal(
          status.identityDrift,
          false,
          'A restart of the same installation was reported as identity drift.'
        );
        assert.notEqual(
          status.connection.state,
          'unavailable',
          'Observation did not recover after the source restarted.'
        );
        assert.deepEqual(
          identities(coworkers(world)),
          before,
          'A restart of the same installation changed who the coworkers are.'
        );
        assert.deepEqual(
          world.mappings(),
          mappingsBefore,
          'A restart of the same installation rebound the projection.'
        );
        assertContextsStaySubordinate(world, 'after a source restart');
      },
    },
    {
      id: 'restart/other-identity-is-drift',
      title:
        'a source that comes back as a different installation is reported as identity drift, with the old mapping preserved',
      criterion:
        'Identity drift: old mapping beside newly observed source identity; ask to remap or detach, never guess by display name.',
      requires: ['restart-other-identity'],
      async run(world) {
        const mappingsBefore = world.mappings();
        const nativesBefore = new Set(
          mappingsBefore.map(mapping => mapping.nativeAgentId)
        );
        assert.ok(
          nativesBefore.size > 0,
          'The world stood up with nothing mapped, so nothing could drift.'
        );

        await world.restartSourceAsAnotherInstallation();

        const status = requireStatus(world);
        assert.equal(
          status.identityDrift,
          true,
          'A different installation behind the same source was not reported as identity drift.'
        );
        assert.notEqual(
          status.connection.state,
          'live',
          'A source whose identity Exawatt can no longer confirm still reads as Live.'
        );
        assert.deepEqual(
          world.mappings(),
          mappingsBefore,
          'Identity drift rewrote the projection instead of preserving the old mapping.'
        );
        for (const agent of coworkers(world)) {
          assert.ok(
            nativesBefore.has(agent.nativeAgentId),
            `"${agent.displayName}" was rebound to "${agent.nativeAgentId}", an Agent of the new installation.`
          );
        }
      },
    },
    {
      id: 'restart/drift-survives-relaunch',
      title:
        'identity drift survives a relaunch, so the operator is still asked to remap or detach',
      criterion:
        'Identity drift: old mapping beside newly observed source identity; ask to remap or detach, never guess by display name.',
      requires: ['restart-other-identity', 'relaunch'],
      async run(world) {
        const mappingsBefore = world.mappings();
        const nativesBefore = new Set(
          mappingsBefore.map(mapping => mapping.nativeAgentId)
        );

        await world.restartSourceAsAnotherInstallation();
        await world.relaunch();

        assert.deepEqual(
          world.mappings(),
          mappingsBefore,
          'A relaunch after identity drift rewrote the projection.'
        );
        for (const agent of coworkers(world)) {
          assert.ok(
            nativesBefore.has(agent.nativeAgentId),
            `"${agent.displayName}" was rebound to "${agent.nativeAgentId}" across a relaunch.`
          );
        }
        assert.equal(
          requireStatus(world).identityDrift,
          true,
          'A relaunch forgot that the source behind this projection is a different installation.'
        );
      },
    },
    {
      id: 'rename/does-not-touch-the-source',
      title:
        'renaming a coworker or moving its Project asks the source for nothing and changes nothing on it',
      criterion:
        'Each imported Agent has an editable Project mapping and optional Exawatt name override; changing either does not modify OpenClaw.',
      requires: ['rename', 'inspect-source'],
      async run(world) {
        const target = firstCoworker(world, 'before a rename');
        const callsBefore = [...world.sourceCalls()];
        const namesBefore = { ...world.sourceAgentNames() };

        await world.rename({
          nativeAgentId: target.nativeAgentId,
          projectId: 'contract-project-night-desk',
          projectLabel: 'Night desk',
          displayNameOverride: 'The night desk',
        });

        assert.deepEqual(
          [...world.sourceCalls()],
          callsBefore,
          'A rename reached the source. Naming and placement are Exawatt decisions.'
        );
        assert.deepEqual(
          world.sourceAgentNames(),
          namesBefore,
          "A rename changed the source's own configured name for that Agent."
        );

        const after = coworkers(world).find(agent => agent.id === target.id);
        assert.ok(
          after,
          'A rename replaced the coworker instead of renaming it.'
        );
        assert.equal(
          after.displayName,
          'The night desk',
          'The coworker did not take the operator name override.'
        );
        assert.equal(
          after.projectId,
          'contract-project-night-desk',
          'The coworker did not move to the Project the operator chose.'
        );
        assert.equal(
          after.projectLabel,
          'Night desk',
          'The coworker did not take the Project label the operator chose.'
        );
      },
    },
    {
      id: 'rename/survives-relaunch',
      title: 'a renamed coworker keeps its name and Project across a relaunch',
      criterion:
        'Quit and relaunch without stopping remote work or losing the selected Agent; revise names and Project placement without touching the source.',
      requires: ['rename', 'relaunch'],
      async run(world) {
        const target = firstCoworker(world, 'before a rename');
        await world.rename({
          nativeAgentId: target.nativeAgentId,
          projectId: 'contract-project-night-desk',
          projectLabel: 'Night desk',
          displayNameOverride: 'The night desk',
        });

        await world.relaunch();

        const after = coworkers(world).find(agent => agent.id === target.id);
        assert.ok(after, 'The renamed coworker did not survive the relaunch.');
        assert.equal(
          after.displayName,
          'The night desk',
          'A relaunch reverted the operator name override.'
        );
        assert.equal(
          after.projectId,
          'contract-project-night-desk',
          'A relaunch reverted the Project mapping.'
        );
        assert.equal(
          after.projectLabel,
          'Night desk',
          'A relaunch reverted the Project label.'
        );
      },
    },
    {
      id: 'detach/removes-only-exawatts-record',
      title:
        "detaching removes Exawatt's own record and credential and leaves the source exactly as it was",
      criterion:
        'Disconnecting or detaching never deletes the remote installation, Agent, workspace, contexts, automations, or credentials.',
      requires: ['detach', 'inspect-source'],
      async run(world) {
        const sourceId = world.sourceId();
        const namesBefore = { ...world.sourceAgentNames() };
        const configuredBefore = [...world.configuredNativeAgentIds()];
        assert.equal(
          world.hasStoredCredential(),
          true,
          'The world stood up holding no credential, so detaching could not remove one.'
        );

        await world.detach();

        assert.equal(
          world
            .runtime()
            .status()
            .some(status => status.sourceId === sourceId),
          false,
          "Detaching left Exawatt's own record of the source behind."
        );
        assert.equal(
          world.hasStoredCredential(),
          false,
          'Detaching left the stored credential behind.'
        );
        assert.deepEqual(
          world.sourceAgentNames(),
          namesBefore,
          'Detaching changed an Agent on the source.'
        );
        assert.deepEqual(
          [...world.configuredNativeAgentIds()],
          configuredBefore,
          'Detaching changed which Agents the source configures.'
        );
        for (const method of world.sourceCalls()) {
          assert.ok(
            !MUTATING_GATEWAY_METHODS.includes(method),
            `Detaching, or the observation before it, called "${method}" on the source.`
          );
        }
      },
    },
    {
      id: 'detach/removes-the-projection',
      title:
        'detaching takes the coworkers out of the roster and leaves no projection behind',
      criterion:
        'Detached: the Exawatt projection is removed after confirmation.',
      requires: ['detach'],
      async run(world) {
        const sourceId = world.sourceId();
        assert.ok(
          coworkers(world).length > 0,
          'The world stood up with no coworkers.'
        );

        await world.detach();

        assert.deepEqual(
          world
            .runtime()
            .agents()
            .filter(agent => agent.source.id === sourceId)
            .map(agent => agent.displayName),
          [],
          'Detaching left the coworkers of a source Exawatt no longer knows about in the roster.'
        );
        assert.deepEqual(
          world.mappings().map(mapping => mapping.nativeAgentId),
          [],
          'Detaching left the projection mapping of a source Exawatt no longer knows about on disk.'
        );
      },
    },
    {
      id: 'detach/reattach-same-coworkers',
      title:
        'reattaching the same source produces the same coworkers rather than a second set',
      criterion:
        'Detached: the Exawatt projection is removed; the source Agent, history, automation, and credentials remain intact.',
      requires: ['detach'],
      async run(world) {
        const before = coworkers(world);
        assert.ok(before.length > 0, 'The world stood up with no coworkers.');
        const beforeIds = ids(before);

        await world.detach();
        await world.reattach();

        const after = coworkers(world);
        assertNoDuplicates(after, 'after reattaching');
        assert.equal(
          after.length,
          before.length,
          'Reattaching the same source produced a different number of coworkers.'
        );
        assert.deepEqual(
          ids(after),
          beforeIds,
          'Reattaching the same source produced new coworkers instead of the ones the operator already had.'
        );
      },
    },
    {
      id: 'retirement/leaves-the-roster',
      title:
        'an Agent the source no longer declares configured leaves the roster',
      criterion:
        'Retired native Agent: available only in source detail, unchecked; it does not silently return to Agent, Team, or Fleet.',
      requires: ['retire-agent'],
      async run(world) {
        const target = firstCoworker(world, 'before a retirement');

        await world.retireAgent(target.nativeAgentId);
        await world.reobserve();

        assert.equal(
          coworkers(world).some(agent => agent.id === target.id),
          false,
          `"${target.displayName}" is still a coworker although the source no longer configures that Agent.`
        );
        assertContextsStaySubordinate(world, 'after a retirement');
      },
    },
    {
      id: 'retirement/keeps-the-other-coworkers',
      title:
        'retiring one Agent costs the operator that coworker and nobody else',
      criterion:
        'Discovery returns exactly the active configured Agents; retired identities are separate. Marcus and Scout remain distinct Agents even though they share one Gateway.',
      requires: ['retire-agent'],
      async run(world) {
        const before = coworkers(world);
        assert.ok(
          before.length >= 2,
          'This adapter stands up fewer than two coworkers, so nothing could survive the retirement.'
        );
        const [retired, ...survivors] = before;

        await world.retireAgent(retired.nativeAgentId);
        await world.reobserve();

        const after = coworkers(world);
        assert.deepEqual(
          identities(after),
          identities(survivors),
          'Retiring one Agent changed, or removed, the coworkers the source still configures.'
        );
      },
    },
    {
      id: 'retirement/does-not-return-on-its-own',
      title:
        'a retired Agent does not come back on its own, through a resnapshot or a relaunch',
      criterion:
        'Retired native Agent: does not silently return to Agent, Team, or Fleet.',
      requires: ['retire-agent', 'relaunch'],
      async run(world) {
        const target = firstCoworker(world, 'before a retirement');

        await world.retireAgent(target.nativeAgentId);
        await world.reobserve();
        await world.reobserve();
        await world.relaunch();

        assert.equal(
          coworkers(world).some(agent => agent.id === target.id),
          false,
          `"${target.displayName}" returned to the roster without the operator choosing it.`
        );
      },
    },
    {
      id: 'contexts/stay-subordinate',
      title:
        'no cron, helper, channel, or spawned context ever becomes a coworker',
      criterion:
        'OpenClaw main/channel/cron/helper contexts do not become top-level Agents; opening a coworker resolves that Agent’s exact main context.',
      requires: [],
      async run(world) {
        assertContextsStaySubordinate(world, 'on connect');
        const before = coworkers(world);
        assert.ok(before.length > 0, 'The world stood up with no coworkers.');

        await world.reobserve();

        assertContextsStaySubordinate(world, 'after a resnapshot');
        assert.deepEqual(
          identities(coworkers(world)),
          identities(before),
          'A resnapshot changed the roster although nothing on the source moved.'
        );
      },
    },
    {
      id: 'honesty/no-stopped-work-copy',
      title:
        'nothing Exawatt says about a source it cannot reach claims the remote work stopped',
      criterion:
        'Unreachable means last-known and stale, never stopped. Connection ambiguity: stale is not stopped, and disconnect is not pause.',
      requires: ['outage'],
      async run(world) {
        const collected: string[] = [...(await copyOnScreen(world))];

        await world.loseConnection();
        collected.push(...(await copyOnScreen(world)));

        await world.runtime().disconnect(world.sourceId());
        collected.push(...(await copyOnScreen(world)));

        assert.ok(collected.length > 0, 'The world produced no copy to check.');
        for (const line of collected) {
          assert.ok(
            !STOPPED_WORK_WORDS.test(line),
            `Copy claims something Exawatt cannot know: "${line}"`
          );
        }
      },
    },
    {
      id: 'honesty/observation-never-mutates-the-source',
      title:
        'observing, reading, relaunching, and detaching never call a method that changes the source',
      criterion:
        'H1 contains no remote command path, no remote Pause implementation, cron mutation, Gateway control, or VPS lifecycle control.',
      requires: ['inspect-source'],
      async run(world) {
        const runtime = world.runtime();
        assert.ok(
          coworkers(world).length > 0,
          'The world stood up with no coworkers, so nothing was read or asked.'
        );
        for (const agent of coworkers(world)) {
          await runtime.conversation(agent.id, { limit: 5 });
          await runtime.send(agent.id, 'contract probe');
        }
        await world.reobserve();
        await runtime.disconnect(world.sourceId());

        const called = world.sourceCalls();
        assert.ok(
          called.length > 0,
          'The source was never asked for anything.'
        );
        for (const method of called) {
          assert.ok(
            !MUTATING_GATEWAY_METHODS.includes(method),
            `Observation called "${method}", which changes someone's server.`
          );
        }
      },
    },
    {
      id: 'identity/evidence-and-adapter-are-the-adapters-own',
      title:
        "a coworker carries its own source's adapter and evidence basis, so simulated evidence can never read as observation",
      criterion:
        'Demo Mode must exercise the same contracts with simulated evidence; Demo and live adapters pass the same projection and lifecycle contract tests.',
      requires: [],
      async run(world) {
        assert.equal(
          world.recordedEvidenceBasis(),
          world.declaredEvidenceBasis(),
          `Exawatt recorded this source's evidence as "${world.recordedEvidenceBasis()}" although the source is ${world.declaredEvidenceBasis()}.`
        );
        for (const agent of coworkers(world)) {
          assert.equal(
            agent.adapterId,
            world.declaredAdapterId(),
            `"${agent.displayName}" is presented as a ${agent.adapterId} coworker although its source is configured as ${world.declaredAdapterId()}.`
          );
        }
      },
    },
  ];

/** Every case id, so a runner can reject a stale `knownGaps` entry. */
export const LIFECYCLE_CONTRACT_CASE_IDS: readonly string[] =
  CONNECTED_SOURCE_LIFECYCLE_CONTRACT.map(entry => entry.id);
