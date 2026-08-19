import { randomUUID } from 'node:crypto';
import {
  AGENT_PROJECTION_VERSION,
  describeConnectionStatus,
  projectAgentTopology,
  resolveConnectionStatus,
  sourceAgentKey,
  type AgentProjectionMapping,
  type AgentSourceAdapterId,
  type AgentSourceEvidenceBasis,
  type AgentStatus,
  type AgentSourcePlacement,
  type AgentSourceTopologySnapshot,
  type ConnectedSourceRecord,
  type ProjectedAgent,
  type SourceAgentDiscoveryState,
  type SourceAuthority,
  type SourceConnectionState,
  type SourceFailureClass,
} from '@exawatt/core';
import {
  EMPTY_PROJECTION_PLAN,
  MAX_MAPPINGS,
  deriveRemoteAgentId,
  type ConnectedAgentMapping,
  type ConnectedAgentProjectionPlan,
  type ConnectedAgentProjectionPlanStore,
} from './connected-agent-projection-plan';
import {
  MAX_CONVERSATION_TURNS,
  MAX_MESSAGE_CHARACTERS,
  MAX_UPDATES_PER_RUN,
  MAX_UPDATE_CHARACTERS,
  boundConversation,
  findPrimaryConversation,
  isPrimaryConversation,
  readTranscript,
  type ConversationRequest,
  type ConversationTurnView,
} from './connected-conversation';
import { SCOPES_FOR_AUTHORITY } from './connected-gateway-authority';
import type { AuthorityRequestResult } from './connected-gateway-authority';
import {
  evidenceBasisForAdapter,
  type ConnectedGatewayPhase,
  type ConnectedGatewaySession,
  type ObservedGatewayFacts,
} from './connected-gateway';
import { sameGatewayIdentity, type GatewayIdentity } from './gateway-identity';
import type { ConnectedSourceStore } from './connected-source-store';
import type { DiagnosticRecorder } from './diagnostics-log';
import {
  MAX_ID_LENGTH,
  describeSourceError,
  validText,
} from './untrusted-input';

/**
 * The main-process owner of every configured Agent Source (ENG-010 C2).
 *
 * `ConnectedGatewaySession` owns one source's transport, credential custody,
 * and authoritative snapshot. This runtime owns the layer above it: which
 * sources are being observed at all, which native Agent is which Exawatt
 * coworker, and what the renderer is told when any of that moves.
 *
 * Five rules shape the file.
 *
 * 1. **Nothing connects on its own.** Opening a session reaches someone's
 *    server, so it follows an operator act (`connect`) or the reconnect of a
 *    source the operator already authorized by pairing a device credential
 *    (`observeSavedSources`). Constructing this object contacts nothing.
 * 2. **The projection plan is Exawatt's, not the source's.** Which coworker
 *    lands in which Project, and under what name, is edited here and persisted
 *    by `connected-agent-projection-plan`. `mapAgents` performs no Gateway call
 *    of any kind: renaming a coworker or moving it between Projects must be
 *    invisible to the server.
 * 3. **Freshness is not work state.** Every status this file produces
 *    describes Exawatt's own observation. None of it may say, or let a caller
 *    infer, that remote work stopped, paused, or was lost.
 * 4. **Change notifications carry no payload.** The renderer is told which
 *    source moved, how fresh it is, and whether a new authoritative snapshot
 *    replaced the last one. It then pulls what it wants. A tick must not cost
 *    a full topology serialization across the IPC boundary.
 * 5. **Quitting detaches observation, never execution.** `dispose` closes
 *    every session exactly once and leaves every remote installation, Agent,
 *    context, automation, and credential exactly as it found them.
 *
 * Every dependency is injected, so the tests never open a socket, never read
 * the operator's SSH configuration, and never touch `userData`.
 *
 * ENG-033 H2 adds one more rule, and it is a product rule rather than an
 * implementation convenience:
 *
 * 6. **A message goes to the coworker's primary conversation and nowhere
 *    else.** `send` takes an Exawatt Agent id and resolves the address itself
 *    from the projection. No caller may hand over a session key, so no caller
 *    can aim a message at a cron run, a helper context, or a delegated child,
 *    and viewing recent work can never silently retarget the composer.
 */

/* ---- Renderer-facing views ----------------------------------------------- */

/**
 * The short freshness labels the design system names. `describeConnectionStatus`
 * answers with an observation age for `stale`, which is the right sentence for
 * a detail surface and the wrong one for a roster chip, so both travel.
 */
export const CONNECTION_STATE_LABELS: Readonly<
  Record<SourceConnectionState, string>
> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  stale: 'Stale',
  unavailable: 'Unavailable',
};

/** Quiet placement metadata. Never a status, never a Project identity. */
export const PLACEMENT_LABELS: Readonly<Record<AgentSourcePlacement, string>> =
  {
    local: 'Local',
    'customer-hosted': 'Remote',
    'exawatt-hosted': 'Exawatt Cloud',
  };

export interface SourceConnectionView {
  state: SourceConnectionState;
  /** `Live` | `Reconnecting` | `Stale` | `Unavailable`. */
  label: string;
  /** Longer sentence for detail surfaces; still only about observation. */
  detail: string;
  observationAgeMs: number | null;
  stalePresentation: boolean;
  failure: SourceFailureClass | null;
}

/**
 * One thing the source itself said, with the standing of the claim attached.
 *
 * `basis` and `provenance` travel with the value because a surface that shows
 * a version has to be able to say where it came from: a Demo source's answers
 * are simulated, and an operator reading a source-detail page is entitled to
 * know which check produced each line rather than being handed five sentences
 * of equal-looking authority.
 */
export interface ObservedSourceFact {
  value: string;
  basis: AgentSourceEvidenceBasis;
  /** Which check produced it, in the operator's words. */
  provenance: string;
}

/** One thing Exawatt may do with this source, and how it knows. */
export interface ObservedSourceCapability extends ObservedSourceFact {
  label: string;
}

/**
 * The installation's own answers, as the Connect flow's fact list wants them:
 * raw tokens, so the surface owns the vocabulary it renders them in.
 */
export interface ObservedSourceFactsView {
  /** The source's own reported identity, or null when it declared none. */
  identity: string | null;
  version: string | null;
  /** Scope tokens the Gateway granted this device. */
  capabilities: readonly string[];
  observedAt: number | null;
}

export interface ConnectedSourceStatusView {
  sourceId: string;
  displayName: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  placementLabel: string;
  /** True once this launch opened a session for the source. */
  observing: boolean;
  phase: ConnectedGatewayPhase;
  connection: SourceConnectionView;
  /**
   * The version the source reported, or null when this launch has not read
   * one. Null is "not observed", never "no version": every discovery pays for
   * this read, and a source Exawatt has not reached yet has told it nothing.
   */
  version: ObservedSourceFact | null;
  /**
   * What Exawatt may do with this source, and what it saw of its automations.
   * Empty for the same reason `version` is null, and empty is the honest
   * answer rather than a claim that the source can do nothing.
   */
  capabilities: readonly ObservedSourceCapability[];
  /** The source now reports a different installation than the plan maps. */
  identityDrift: boolean;
  /**
   * Bumped by every authoritative snapshot, and by nothing else.
   *
   * Both halves are load-bearing. A renderer keyed on this number re-reads the
   * roster when it moves, so a snapshot that landed without moving it costs the
   * operator whatever that snapshot brought in — and for a while exactly that
   * happened, because only the operator's own `connect` bumped it while an
   * automatic reconnect resnapshots authoritatively too. Phase movement still
   * does not bump it: a reconnect ladder is freshness news, not new content,
   * and a surface that only cares about topology must be able to ignore it.
   */
  snapshotRevision: number;
}

/** What the Connect dialog's discovery step chooses from. */
export interface DiscoveredSourceAgent {
  nativeAgentId: string;
  displayName: string;
  discoveryState: SourceAgentDiscoveryState;
  contextCount: number;
  /** False means this Agent opens on its work, not on a fabricated Home. */
  hasPrimaryConversation: boolean;
  /** The saved mapping, when this Agent already has one. */
  mapping: {
    exawattAgentId: string;
    projectId: string;
    projectLabel: string;
    displayNameOverride: string | null;
  } | null;
}

/** One projected coworker, ready for the roster. */
export interface RemoteAgentView {
  id: string;
  displayName: string;
  projectId: string;
  projectLabel: string;
  discoveryState: SourceAgentDiscoveryState;
  placement: AgentSourcePlacement;
  placementLabel: string;
  adapterId: AgentSourceAdapterId;
  source: { id: string; displayName: string };
  nativeAgentId: string;
  /** The source-declared `main` context, or null when it declares none. */
  primaryContextId: string | null;
  /**
   * D40 work state, in the vocabulary a local Agent already uses, or null when
   * the source has evidenced none.
   *
   * The kernel's answer, read rather than recomputed: `ProjectedAgent.workState`
   * states the derivation once — a fault outranks a run in flight, a run in
   * flight outranks quiet — and a surface that derived its own would drift from
   * it the day the evidence grew.
   *
   * Null is unknown, and unknown is an answer. It must never render as a
   * positive claim: a coworker whose source said nothing about any of its
   * contexts is not idle, and showing it as idle would be Exawatt inventing a
   * state nobody reported. This runtime once answered
   * `hasActiveRun ? 'working' : 'idle'`, which threw away the fault the
   * discovery reads had already paid for and turned silence into a claim that
   * the coworker is quiet; every value here is now a word D40 already uses, so
   * a remote coworker still needs no second status vocabulary.
   *
   * Observed at `observedAt` and nowhere else: a stale or unavailable
   * connection leaves this exactly as it was last observed, and `connection`
   * is what tells the operator the view is not current. Nothing in this field
   * may move because observation moved.
   */
  workState: AgentStatus | null;
  contextCount: number;
  observedAt: number;
  createdAt: number;
  lastActiveAt: number;
  connection: SourceConnectionView;
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
}

/**
 * What Exawatt may do with one source, kept apart from freshness on purpose.
 *
 * Placement, connection, work state, and source context are already four
 * independent dimensions and authority is a fifth. Folding it into the
 * freshness view would invite a surface to read a read-only source as a
 * degraded connection, which it is not: observation is perfect and the
 * coworker is working. This says only what Exawatt is allowed to say back.
 */
export interface SourceCommandAuthorityView {
  sourceId: string;
  displayName: string;
  /** What the Gateway granted on the last completed handshake. */
  authority: SourceAuthority;
  /**
   * A write request is standing, waiting for someone to approve the Exawatt
   * device on the source itself. Exawatt cannot approve its own scope.
   */
  awaitingApproval: boolean;
}

export type ConnectSourceResult =
  | {
      ok: true;
      sourceId: string;
      agents: readonly DiscoveredSourceAgent[];
      status: ConnectedSourceStatusView;
      /**
       * What the source said about itself on this connection. The Connect
       * dialog shows it beside the Agents it discovered, so the operator
       * confirms which installation they just reached before they import
       * anyone out of it.
       */
      observed: ObservedSourceFactsView | null;
    }
  | {
      ok: false;
      sourceId: string;
      outcome: 'unknown-source' | 'identity-drift' | 'failed';
      failure: SourceFailureClass | null;
      message: string;
    };

/** One Project/name decision the Connect flow collected. */
export interface AgentMappingInput {
  nativeAgentId: string;
  projectId: string;
  projectLabel?: string;
  displayNameOverride?: string | null;
}

export type MapAgentsResult =
  | { ok: true; mapped: number }
  | { ok: false; issues: readonly string[] };

export interface ConnectedSourceChange {
  sourceId: string;
  phase: ConnectedGatewayPhase;
  connection: SourceConnectionView;
  snapshotRevision: number;
}

/* ---- Command authority (H2) ---------------------------------------------- */

/**
 * Authority is the source's answer, and the runtime only ever reads it.
 *
 * `record.grantedAuthority` is what the Gateway granted on the last completed
 * handshake, so the send path consults the record rather than remembering a
 * decision of its own. Nothing here is a statement about the remote Agent: a
 * source Exawatt may only watch holds a coworker working exactly as it was.
 *
 * There is a third thing an operator can be waiting on, and it is not an
 * authority. A device already approved at `operator.read` cannot raise its own
 * scope: verified live, the Gateway refuses the ask whether Exawatt presents
 * its own device token or the admin-capable shared secret, and the raise is an
 * approval performed on the source by the person who owns it. So "asked, and
 * waiting for that approval" is a fact about a request Exawatt made this
 * session, not a property of the source, and it lives in memory here for
 * exactly as long as it stays true.
 */
const AWAITING_APPROVAL_MESSAGE =
  'Approve the Exawatt device for write access with the source device tooling, then send again.';

export type ConversationRefusal =
  | 'unknown-agent'
  | 'no-primary-conversation'
  | 'disconnected'
  | 'unreadable';

export type ConversationResult =
  | {
      ok: true;
      agentId: string;
      sourceId: string;
      contextId: string;
      /** Oldest to newest, in the order the source retains them. */
      turns: readonly ConversationTurnView[];
      /** Older turns exist beyond this page. Bounding is never silent. */
      hasMore: boolean;
      characterCount: number;
      observedAt: number;
      connection: SourceConnectionView;
    }
  | {
      ok: false;
      agentId: string;
      outcome: ConversationRefusal;
      message: string;
    };

export interface SendToAgentOptions {
  /**
   * Reused verbatim on a retry. The Gateway accepts it on `chat.send`, so a
   * retry after a dropped connection resolves to the same run rather than
   * posting the message twice.
   */
  idempotencyKey?: string;
}

/**
 * Every way a send declines, each distinct because the operator's next step
 * differs. `read-only-source` says how to ask for authority;
 * `approval-pending` says the request is waiting on the Gateway. Neither is an
 * error, and none of them is a statement about the remote Agent.
 */
export type SendRefusal =
  | 'unknown-agent'
  | 'read-only-source'
  | 'approval-pending'
  | 'no-primary-conversation'
  | 'disconnected'
  | 'invalid-message'
  | 'refused';

export type SendToAgentResult =
  | {
      ok: true;
      agentId: string;
      sourceId: string;
      contextId: string;
      runId: string | null;
      status: 'sent' | 'queued';
      idempotencyKey: string;
      at: number;
    }
  | {
      ok: false;
      agentId: string;
      outcome: SendRefusal;
      message: string;
    };

export type ConversationUpdateKind =
  | 'delta'
  | 'complete'
  | 'bounded'
  | 'resnapshot';

export interface ConversationUpdate {
  agentId: string;
  sourceId: string;
  contextId: string;
  runId: string | null;
  kind: ConversationUpdateKind;
  /** Reply text for `delta`; empty for every other kind. */
  text: string;
  /**
   * Order within this process, monotonic across every source.
   *
   * Deliberately Exawatt's own counter. The Gateway's frame sequence resets
   * per connection and events are never replayed, so storing one as a
   * catch-up cursor would ask a reconnect for a position it cannot honour.
   * This number is never written to disk and never sent to a source.
   */
  ordinal: number;
  at: number;
}

/* ---- Runtime ------------------------------------------------------------- */

/**
 * The streaming half of the session surface, declared here rather than picked
 * from `ConnectedGatewaySession` because it is capability-declared: a session
 * whose transport proves no event stream simply does not carry it, and the
 * operator still sees the reply on the next authoritative read. Absence is a
 * quieter surface, never a crash and never a silent no-op.
 */
export interface ConnectedSourceCommandSurface {
  /** One Gateway event stream, unsubscribed by the returned disposer. */
  onGatewayEvent?(
    eventName: string,
    handler: (payload: unknown) => void
  ): () => void;
}

/**
 * Exactly what the runtime uses of a gateway session. Structural on purpose:
 * the test drives a hand-written double, so no test in this file can open a
 * tunnel, read an SSH configuration, or reach a network.
 *
 * Exactly, and no more. The session also exposes `resnapshot` and `authority`,
 * and this runtime uses neither: it repairs observation by connecting, and it
 * reads granted authority off the source record rather than off a live session,
 * so a source Exawatt is not observing still answers what it may be asked to
 * do. Leaving them in the list would let a future edit reach around both of
 * those decisions without anyone having to argue for it.
 *
 * `facts` is on the list, and read live rather than captured at connect time,
 * because the reconnect ladder resnapshots inside the session: a version or
 * an automation count captured once would keep reporting what an earlier
 * observation found while the surface beside it says the connection is Live.
 */
export type ConnectedSourceSession = Pick<
  ConnectedGatewaySession,
  | 'connect'
  | 'read'
  | 'write'
  | 'requestWriteAuthority'
  | 'relinquishWriteAuthority'
  | 'status'
  | 'disconnect'
  | 'onPhaseChange'
  | 'snapshot'
  | 'phase'
  | 'facts'
  | 'identity'
  | 'identityDrift'
> &
  ConnectedSourceCommandSurface;

/**
 * What the runtime knows about a source before its session exists.
 *
 * One field, and it is here rather than on the record because it is Exawatt's
 * own observation history rather than the operator's configuration. A session
 * cannot detect drift against an installation it never saw, and a relaunch
 * builds a fresh one, so the previous identity has to be handed to it.
 */
export interface ConnectedSourceSessionContext {
  /** The installation this source's projection is bound to. Null: never seen. */
  knownIdentity: GatewayIdentity | null;
}

export interface ConnectedSourceRuntimeDeps {
  store: Pick<ConnectedSourceStore, 'list' | 'get'>;
  plans: ConnectedAgentProjectionPlanStore;
  createSession: (
    record: ConnectedSourceRecord,
    context: ConnectedSourceSessionContext
  ) => ConnectedSourceSession;
  now: () => number;
  /**
   * Where a refused projection is reported. Absent is a no-op, so nothing
   * here depends on a log being wired; wired, it is what keeps a broken plan
   * from costing the operator a roster with no explanation anywhere.
   *
   * It carries issue codes and counts only. No native Agent id, display name,
   * alias, host, address, or transcript may travel through it.
   */
  recordDiagnostic?: DiagnosticRecorder;
}

interface SessionEntry {
  record: ConnectedSourceRecord;
  session: ConnectedSourceSession;
  snapshotRevision: number;
  /**
   * The snapshot the revision above counts. Compared by identity rather than
   * by content: the session replaces the cached tree whole on every
   * authoritative read and never merges into it, so a different object IS a
   * different observation, and a resnapshot that happens to find the source
   * unchanged is still news the renderer asked to hear about.
   */
  observedSnapshot: AgentSourceTopologySnapshot | null;
  offPhase: () => void;
  offEvents: () => void;
  closed: boolean;
  /**
   * Live updates forwarded per run this connection. Cleared whenever
   * observation drops, because a half-streamed reply is unverified once
   * Exawatt stops watching and history is what restores it.
   */
  forwardedByRun: Map<string, number>;
  /** Set while a dropped connection is waiting for its authoritative reread. */
  awaitingResnapshot: boolean;
}

export class ConnectedSourceRuntime {
  private readonly deps: ConnectedSourceRuntimeDeps;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly listeners = new Set<
    (change: ConnectedSourceChange) => void
  >();
  private readonly conversationListeners = new Set<
    (update: ConversationUpdate) => void
  >();
  /**
   * In-flight sends, keyed by source, address, and idempotency key. Two
   * simultaneous retries of one message share one Gateway call; the key
   * itself, which travels to the source, is what protects a retry issued
   * after this process forgot the first one.
   */
  private readonly inflightSends = new Map<
    string,
    Promise<SendToAgentResult>
  >();
  /**
   * Sources whose last authority request came back "a person must approve
   * this on the server". In memory by design: it records a request Exawatt
   * made, not something the source granted, and the source's own record stays
   * the only place granted authority is read from.
   */
  private readonly awaitingApproval = new Set<string>();
  /** Process-local update order. Never persisted, never a transport sequence. */
  private updateOrdinal = 0;
  private resumeStarted = false;
  private disposed = false;

  constructor(deps: ConnectedSourceRuntimeDeps) {
    this.deps = deps;
  }

  onChange(listener: (change: ConnectedSourceChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Follow replies as they arrive (ENG-033 H2).
   *
   * Unlike `onChange`, these updates do carry content, because a reply the
   * operator is waiting for is the one thing a pull cannot deliver in time.
   * They stay bounded per run and they are ordered by Exawatt's own counter,
   * never by a transport sequence that resets on the next connection.
   */
  onConversationUpdate(
    listener: (update: ConversationUpdate) => void
  ): () => void {
    this.conversationListeners.add(listener);
    return () => {
      this.conversationListeners.delete(listener);
    };
  }

  /**
   * Open a session for one saved source and report what it discovered.
   *
   * This is the operator act. It is the only entry point that may reach a
   * server the operator has not already paired with.
   */
  async connect(sourceId: string): Promise<ConnectSourceResult> {
    if (this.disposed) {
      return {
        ok: false,
        sourceId,
        outcome: 'failed',
        failure: 'unknown',
        message: 'Exawatt is shutting down.',
      };
    }
    const record = this.deps.store.get(sourceId);
    if (!record) {
      return {
        ok: false,
        sourceId,
        outcome: 'unknown-source',
        failure: null,
        message: 'That source is no longer configured.',
      };
    }

    const entry = this.ensureSession(record);
    const result = await entry.session.connect();
    this.rememberBoundIdentity(entry);
    if (this.disposed) {
      return {
        ok: false,
        sourceId,
        outcome: 'failed',
        failure: 'unknown',
        message: 'Exawatt is shutting down.',
      };
    }

    if (!result.ok) {
      this.emit(entry);
      return result.outcome === 'identity-drift'
        ? {
            ok: false,
            sourceId,
            outcome: 'identity-drift',
            failure: null,
            message: result.message,
          }
        : {
            ok: false,
            sourceId,
            outcome: 'failed',
            failure: result.failure,
            message: result.message,
          };
    }

    this.noteAuthoritativeSnapshot(entry);
    this.emit(entry);
    return {
      ok: true,
      sourceId,
      agents: describeDiscoveredAgents(result.snapshot, this.deps.plans.read()),
      status: this.statusFor(entry, record),
      observed: observedFactsView(entry.session.facts, record),
    };
  }

  /**
   * Reconnect the sources the operator already authorized.
   *
   * "Already authorized" is a fact on the record, not an assumption: a source
   * only holds a device credential because the operator completed a pairing
   * for it. A saved source without one is left alone, because reaching that
   * server would be Exawatt's decision rather than the operator's.
   *
   * Idempotent, and one source failing never blocks another.
   */
  async observeSavedSources(): Promise<void> {
    if (this.disposed || this.resumeStarted) return;
    this.resumeStarted = true;
    const records = this.deps.store
      .list()
      .filter(record => record.hasDeviceCredential);
    await Promise.allSettled(
      records.map(record => this.connect(record.id).catch(() => undefined))
    );
  }

  /**
   * What Exawatt may do with each source, so a surface can decide whether to
   * offer a composer at all rather than offering one and collecting a
   * refusal. A separate read from `status`, because authority is not
   * freshness and a read-only source is not a degraded one.
   */
  commandAuthority(): SourceCommandAuthorityView[] {
    return this.deps.store.list().map(record => ({
      sourceId: record.id,
      displayName: record.displayName,
      authority: record.grantedAuthority,
      awaitingApproval: this.awaitingApproval.has(record.id),
    }));
  }

  /** Per-source freshness, for Settings and the roster. */
  status(): ConnectedSourceStatusView[] {
    return this.deps.store
      .list()
      .map(record =>
        this.statusFor(this.sessions.get(record.id) ?? null, record)
      );
  }

  /**
   * The projected coworkers.
   *
   * A mapping takes part only when the source it names is being observed AND
   * that source's own snapshot still declares its Agent configured. Both
   * exclusions are narrow, and they are narrow for the same reason: the kernel
   * treats a mapping with no matching source Agent as a fatal topology error,
   * so anything that reaches it and should not costs the operator every
   * coworker of every source at once.
   *
   * A source this launch has not opened yet has told Exawatt nothing, and
   * silence about one server must not empty the roster of the others.
   *
   * An Agent a source no longer declares configured is a retirement, and a
   * retirement is ordinary: somebody deleted an Agent on their own server.
   * That costs the operator that one coworker, quietly, and nobody else. It
   * does not come back on its own either — the plan row stays, unprojected,
   * so returning is an explicit choice rather than a resnapshot's side effect.
   *
   * What is deliberately NOT filtered is a plan that is broken rather than
   * outdated: a duplicate mapping, two coworkers claiming one Exawatt id, an
   * unreadable row. Those still reach the kernel, still refuse the projection,
   * and are reported. Quietly dropping them would turn corruption into a
   * roster that is silently missing people.
   */
  agents(): RemoteAgentView[] {
    const snapshots: AgentSourceTopologySnapshot[] = [];
    const entries = new Map<string, SessionEntry>();
    const configured = new Map<string, Set<string>>();
    for (const entry of this.sessions.values()) {
      const snapshot = entry.session.snapshot;
      if (!snapshot) continue;
      snapshots.push(snapshot);
      entries.set(snapshot.configuredSourceId, entry);
      configured.set(
        snapshot.configuredSourceId,
        new Set(
          snapshot.agents
            .filter(stillDeclared)
            .map(agent => agent.nativeAgentId)
        )
      );
    }
    if (snapshots.length === 0) return [];

    const plan = this.deps.plans.read();
    const labels = new Map(
      plan.mappings.map(mapping => [
        mapping.exawattAgentId,
        mapping.projectLabel,
      ])
    );
    const mappings: AgentProjectionMapping[] = plan.mappings
      .filter(mapping =>
        Boolean(
          configured.get(mapping.configuredSourceId)?.has(mapping.nativeAgentId)
        )
      )
      .map(mapping => ({
        configuredSourceId: mapping.configuredSourceId,
        nativeAgentId: mapping.nativeAgentId,
        exawattAgentId: mapping.exawattAgentId,
        projectId: mapping.projectId,
        displayNameOverride: mapping.displayNameOverride,
      }));

    const projected = projectAgentTopology(snapshots, {
      projectionVersion: plan.projectionVersion,
      mappings,
    });
    if (!projected.ok) {
      this.deps.recordDiagnostic?.('connected-sources.projection-refused', {
        codes: [
          ...new Set(
            projected.issues
              .filter(issue => issue.severity === 'error')
              .map(issue => issue.code)
          ),
        ].sort(),
        errorCount: projected.issues.filter(issue => issue.severity === 'error')
          .length,
        mappingCount: mappings.length,
        sourceCount: snapshots.length,
      });
      return [];
    }

    const views: RemoteAgentView[] = [];
    for (const agent of projected.projection.agents) {
      const entry = entries.get(agent.configuredSourceId);
      if (!entry) continue;
      const snapshot = entry.session.snapshot;
      if (!snapshot) continue;
      views.push(
        toRemoteAgentView(
          agent,
          snapshot,
          entry.record,
          labels.get(agent.id) ?? agent.projectId,
          this.connectionFor(entry)
        )
      );
    }
    return views;
  }

  /**
   * One coworker's primary conversation, bounded (ENG-033 H2).
   *
   * `chat.history` is already in the read allowlist, so this needs no new
   * authority: an operator who can see a coworker can read what was said to
   * it. The read is bounded three ways at once, and every bound reports
   * itself: at most `MAX_CONVERSATION_TURNS` come back from the source, at
   * most `limit` turns come back to the caller, and the page spends a
   * character budget from the newest turn backward. Anything older sets
   * `hasMore`, because a page that quietly stops is indistinguishable from a
   * conversation that quietly stopped.
   *
   * A coworker whose source declares no primary conversation gets the explicit
   * `no-primary-conversation` answer. One of the operator's own Agents is
   * exactly that: automations only, never conversed with. Returning an empty
   * transcript for it would render as silence from someone who has never been
   * spoken to.
   */
  async conversation(
    agentId: string,
    request: ConversationRequest = {}
  ): Promise<ConversationResult> {
    const resolved = this.resolveTarget(agentId);
    if (!resolved.ok) {
      return {
        ok: false,
        agentId,
        outcome: resolved.outcome,
        message: resolved.message,
      };
    }
    const { entry, contextId } = resolved;

    let payload: unknown;
    try {
      payload = await entry.session.read('chat.history', {
        sessionKey: contextId,
        // One bounded read, asking for one past the cap so that "older turns
        // exist" is observed rather than guessed.
        limit: MAX_CONVERSATION_TURNS + 1,
      });
    } catch (error) {
      return {
        ok: false,
        agentId,
        outcome: 'unreadable',
        message: describeSourceError(
          error,
          'The Gateway did not answer that read.'
        ),
      };
    }

    const page = boundConversation(readTranscript(payload, contextId), request);
    return {
      ok: true,
      agentId,
      sourceId: entry.record.id,
      contextId,
      turns: page.turns,
      hasMore: page.hasMore,
      characterCount: page.characterCount,
      observedAt: this.deps.now(),
      connection: this.connectionFor(entry),
    };
  }

  /**
   * Ask one source to raise Exawatt from observation to conversation.
   *
   * The operator act that precedes any send. Three answers matter and the
   * runtime keeps the third: `granted` and a plain `refused` both settle the
   * question, while `approval-required` leaves a request standing on the
   * server, which is what lets a later send say "waiting for your approval"
   * instead of "read-only" and send the operator somewhere useful.
   */
  async requestCommandAuthority(
    sourceId: string
  ): Promise<AuthorityRequestResult> {
    const record = this.deps.store.get(sourceId);
    if (!record) {
      return {
        outcome: 'refused',
        authority: 'read',
        message: 'That source is no longer configured.',
      };
    }
    const entry = this.sessions.get(sourceId);
    if (!entry) {
      return {
        outcome: 'refused',
        authority: record.grantedAuthority,
        message: `Exawatt is not observing ${record.displayName} right now, so there is nothing to ask.`,
      };
    }
    const result = await entry.session.requestWriteAuthority();
    if (result.outcome === 'approval-required') {
      this.awaitingApproval.add(sourceId);
    } else {
      this.awaitingApproval.delete(sourceId);
    }
    entry.record = this.deps.store.get(sourceId) ?? entry.record;
    this.emit(entry);
    return result;
  }

  /**
   * Hand write authority back and keep observing.
   *
   * The operator's way to a read-only source without detaching it. It changes
   * what Exawatt may do and nothing about what the coworker is doing.
   */
  async relinquishCommandAuthority(
    sourceId: string
  ): Promise<AuthorityRequestResult> {
    const record = this.deps.store.get(sourceId);
    if (!record) {
      return {
        outcome: 'refused',
        authority: 'read',
        message: 'That source is no longer configured.',
      };
    }
    const entry = this.sessions.get(sourceId);
    if (!entry) {
      return {
        outcome: 'refused',
        authority: record.grantedAuthority,
        message: `Exawatt is not observing ${record.displayName} right now, so there is nothing to hand back.`,
      };
    }
    const result = await entry.session.relinquishWriteAuthority();
    this.awaitingApproval.delete(sourceId);
    entry.record = this.deps.store.get(sourceId) ?? entry.record;
    this.emit(entry);
    return result;
  }

  /**
   * Say something to a coworker (ENG-033 H2).
   *
   * The signature is the design rule. It takes an Exawatt Agent id and
   * resolves the address from the projection, so there is no parameter a
   * caller could use to aim a message at a cron context, a helper session, or
   * a delegated child. Opening a subordinate context to read it therefore
   * cannot retarget this call, whatever the surface above does.
   *
   * Authority is checked before the connection is, so a source Exawatt only
   * watches declines every send without the Gateway client ever seeing the
   * method name.
   */
  async send(
    agentId: string,
    text: string,
    options: SendToAgentOptions = {}
  ): Promise<SendToAgentResult> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return {
        ok: false,
        agentId,
        outcome: 'invalid-message',
        message: 'Write a message to send.',
      };
    }
    if (text.length > MAX_MESSAGE_CHARACTERS) {
      return {
        ok: false,
        agentId,
        outcome: 'invalid-message',
        message: `One message carries up to ${MAX_MESSAGE_CHARACTERS} characters.`,
      };
    }

    const mapping = this.mappingFor(agentId);
    const record = mapping
      ? this.deps.store.get(mapping.configuredSourceId)
      : null;
    if (!mapping || !record) {
      return {
        ok: false,
        agentId,
        outcome: 'unknown-agent',
        message: 'Exawatt has no coworker with that id.',
      };
    }

    if (record.grantedAuthority !== 'write') {
      return this.awaitingApproval.has(record.id)
        ? {
            ok: false,
            agentId,
            outcome: 'approval-pending',
            message: `Exawatt has asked ${record.displayName} for write access. ${AWAITING_APPROVAL_MESSAGE}`,
          }
        : {
            ok: false,
            agentId,
            outcome: 'read-only-source',
            message: `Exawatt observes ${record.displayName}. Ask this source for write access to talk here.`,
          };
    }

    const resolved = this.resolveTarget(agentId);
    if (!resolved.ok) {
      return {
        ok: false,
        agentId,
        outcome: resolved.outcome,
        message: resolved.message,
      };
    }
    const { entry, contextId } = resolved;

    const idempotencyKey = validText(options.idempotencyKey, MAX_ID_LENGTH)
      ? options.idempotencyKey
      : randomUUID();
    const inflightKey = `${entry.record.id}\0${contextId}\0${idempotencyKey}`;
    const running = this.inflightSends.get(inflightKey);
    if (running) return running;

    const attempt = this.postMessage(
      entry,
      agentId,
      contextId,
      text,
      idempotencyKey
    ).finally(() => {
      this.inflightSends.delete(inflightKey);
    });
    this.inflightSends.set(inflightKey, attempt);
    return attempt;
  }

  /**
   * Save where each discovered Agent belongs.
   *
   * A mapping edit is an Exawatt decision. Nothing here calls the Gateway, so
   * renaming a coworker or moving it between Projects cannot rename, move,
   * restart, or otherwise disturb anything on the server. The held snapshot is
   * not touched either: it is the source's truth, and this is Exawatt's.
   */
  mapAgents(
    sourceId: string,
    mappings: readonly AgentMappingInput[]
  ): MapAgentsResult {
    const record = this.deps.store.get(sourceId);
    if (!record)
      return { ok: false, issues: ['That source is not configured.'] };
    if (!Array.isArray(mappings)) {
      return { ok: false, issues: ['Mappings must be a list.'] };
    }
    if (mappings.length > MAX_MAPPINGS) {
      return { ok: false, issues: ['Too many mappings for one source.'] };
    }

    const issues: string[] = [];
    const plan = this.deps.plans.read();
    const existing = new Map(
      plan.mappings.map(mapping => [sourceAgentKey(mapping), mapping])
    );
    const next: ConnectedAgentMapping[] = [];
    const seen = new Set<string>();

    for (const input of mappings) {
      if (!input || typeof input !== 'object') {
        issues.push('Each mapping must be a record.');
        continue;
      }
      if (!validText(input.nativeAgentId, MAX_ID_LENGTH)) {
        issues.push('Each mapping needs the source Agent it maps.');
        continue;
      }
      if (!validText(input.projectId, MAX_ID_LENGTH)) {
        issues.push(`Choose a Project for ${input.nativeAgentId}.`);
        continue;
      }
      const override = input.displayNameOverride ?? null;
      if (override !== null && !validText(override)) {
        issues.push(`That name cannot be used for ${input.nativeAgentId}.`);
        continue;
      }
      const key = sourceAgentKey({
        configuredSourceId: sourceId,
        nativeAgentId: input.nativeAgentId,
      });
      if (seen.has(key)) {
        issues.push(`${input.nativeAgentId} was mapped twice.`);
        continue;
      }
      seen.add(key);
      next.push({
        configuredSourceId: sourceId,
        nativeAgentId: input.nativeAgentId,
        // A coworker keeps the id it already had. Reminting it on every edit
        // would make a Project change read downstream as a different person.
        exawattAgentId:
          existing.get(key)?.exawattAgentId ??
          deriveRemoteAgentId(sourceId, input.nativeAgentId),
        projectId: input.projectId,
        displayNameOverride: override,
        projectLabel: validText(input.projectLabel)
          ? input.projectLabel
          : input.projectId,
      });
    }

    if (issues.length > 0) return { ok: false, issues };

    // Replace this source's entries, leave every other source's alone.
    const others = plan.mappings.filter(
      mapping => mapping.configuredSourceId !== sourceId
    );
    this.deps.plans.write({
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: [...others, ...next],
      boundIdentities: plan.boundIdentities,
    });

    const entry = this.sessions.get(sourceId);
    if (entry) this.emit(entry);
    return { ok: true, mapped: next.length };
  }

  /**
   * Stop observing one source. The remote keeps working.
   *
   * The session object stays, holding its last authoritative snapshot, so the
   * coworkers remain in the roster as last-known with an honest freshness
   * signal instead of vanishing. Removing them is detach, and detach is the
   * registry's job.
   */
  async disconnect(sourceId: string): Promise<{ ok: boolean }> {
    const entry = this.sessions.get(sourceId);
    if (!entry) return { ok: false };
    await entry.session.disconnect();
    this.emit(entry);
    return { ok: true };
  }

  /**
   * Detach one source: everything this process and this plan hold about it.
   *
   * The counterpart to `disconnect`, and the difference is the whole point.
   * Disconnecting stops watching a source the operator still has; detaching is
   * the operator saying they no longer have it, so the session, its last
   * authoritative snapshot, and that source's rows in the projection plan all
   * go. Leaving any of them behind is what kept detached coworkers in the
   * roster until the app quit and left their mappings on disk forever.
   *
   * Nothing here reaches the source beyond closing the connection Exawatt
   * opened. The remote installation, its Agents, workspaces, contexts,
   * history, automations, and its own credentials are exactly as they were,
   * and the device Exawatt paired stays revocable with the source's own
   * tooling. The registry record and the stored credential are the store's to
   * remove, and the caller removes them after this returns.
   */
  async detach(sourceId: string): Promise<void> {
    const plan = this.deps.plans.read();
    const kept = plan.mappings.filter(
      mapping => mapping.configuredSourceId !== sourceId
    );
    const boundIdentities = { ...plan.boundIdentities };
    const wasBound = sourceId in boundIdentities;
    delete boundIdentities[sourceId];
    if (kept.length !== plan.mappings.length || wasBound) {
      this.deps.plans.write({
        projectionVersion: AGENT_PROJECTION_VERSION,
        mappings: kept,
        boundIdentities,
      });
    }

    this.awaitingApproval.delete(sourceId);
    for (const key of [...this.inflightSends.keys()]) {
      if (key.startsWith(`${sourceId}\0`)) this.inflightSends.delete(key);
    }

    const entry = this.sessions.get(sourceId);
    this.sessions.delete(sourceId);
    if (!entry) return;
    if (!entry.closed) {
      entry.closed = true;
      entry.offPhase();
      entry.offEvents();
      entry.forwardedByRun.clear();
      await entry.session.disconnect();
    }
    // One last change, so a renderer holding a roster reads it again and finds
    // the coworkers of a source Exawatt no longer knows about gone.
    this.emit(entry);
  }

  /**
   * App quit. Every session closes exactly once, and closing observes nothing
   * about remote work: no pause, no stop, no abort, no schedule change.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    this.listeners.clear();
    this.conversationListeners.clear();
    this.inflightSends.clear();
    this.awaitingApproval.clear();
    await Promise.allSettled(
      entries.map(async entry => {
        if (entry.closed) return;
        entry.closed = true;
        entry.offPhase();
        entry.offEvents();
        entry.forwardedByRun.clear();
        await entry.session.disconnect();
      })
    );
  }

  // ---- Internals ---------------------------------------------------------

  /**
   * Persist the installation this source's projection is bound to.
   *
   * Written after every observation, so the next launch has something to
   * compare against and a Gateway swapped while Exawatt was closed cannot be
   * accepted in silence. Unconditional on purpose: a session that just
   * reported drift still answers `identity` with the BOUND identity rather
   * than the drifted one, so writing it back preserves the binding the
   * operator has not yet been asked about. A session with nothing observed
   * writes nothing.
   */
  private rememberBoundIdentity(entry: SessionEntry): void {
    const identity = entry.session.identity;
    if (!identity) return;
    const plan = this.deps.plans.read();
    const current = plan.boundIdentities[entry.record.id];
    // What makes two observations the same installation is one rule, and it
    // lives with the identity rather than with whoever happens to be storing
    // one; a second comparison written here is how a value reads as equal in
    // one place and different in another.
    if (current && sameGatewayIdentity(current, identity)) return;
    this.deps.plans.write({
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: plan.mappings,
      boundIdentities: {
        ...plan.boundIdentities,
        [entry.record.id]: {
          version: identity.version,
          nativeAgentIds: [...identity.nativeAgentIds],
        },
      },
    });
  }

  /**
   * One authoritative snapshot landed, or none did. The only place the
   * revision moves.
   *
   * Called wherever the runtime can learn that the session replaced its
   * topology — the operator's own connect, and the reconnect ladder's return —
   * rather than at one of them, because the doc promises the number tracks
   * authoritative snapshots and a renderer keyed on it has no other way to
   * discover what a reconnect brought in. It is idempotent, so calling it from
   * both places on one snapshot bumps once.
   *
   * A drifted or failed reconnect leaves the cached snapshot exactly where it
   * was, so nothing here bumps for it: the operator is being asked to remap or
   * detach, not being told there is new content to read.
   */
  private noteAuthoritativeSnapshot(entry: SessionEntry): void {
    const snapshot = entry.session.snapshot;
    if (snapshot === null || snapshot === entry.observedSnapshot) return;
    entry.observedSnapshot = snapshot;
    entry.snapshotRevision += 1;
  }

  private ensureSession(record: ConnectedSourceRecord): SessionEntry {
    const existing = this.sessions.get(record.id);
    if (existing) {
      existing.record = record;
      return existing;
    }
    const session = this.deps.createSession(record, {
      knownIdentity: this.deps.plans.read().boundIdentities[record.id] ?? null,
    });
    const entry: SessionEntry = {
      record,
      session,
      snapshotRevision: 0,
      observedSnapshot: null,
      offPhase: () => {},
      offEvents: () => {},
      closed: false,
      forwardedByRun: new Map(),
      awaitingResnapshot: false,
    };
    // Phase movement is freshness news, not new content, so it never bumps
    // the snapshot revision: a renderer that only cares about topology can
    // ignore a reconnect ladder entirely.
    entry.offPhase = session.onPhaseChange(phase => {
      this.followPhase(entry, phase);
      this.emit(entry);
    });
    // Streaming is capability-declared. A session that exposes no event
    // stream forwards nothing, and the operator still sees the reply on the
    // next authoritative read.
    entry.offEvents =
      session.onGatewayEvent?.('chat.segment', payload =>
        this.forwardSegment(entry, payload)
      ) ?? (() => {});
    this.sessions.set(record.id, entry);
    return entry;
  }

  /**
   * A connection moved. Two transitions matter to a conversation.
   *
   * Losing observation invalidates every half-streamed reply: Exawatt has no
   * idea what arrived while it was not watching, and the Gateway replays
   * nothing. Regaining it means the session has already resnapshotted
   * authoritatively, so the renderer is told to read history again. That is
   * how a reply in flight across a drop is recovered: from the source's own
   * record of it, reconciled by stable turn identity, never from a replayed
   * frame or a stored sequence.
   *
   * None of this says anything about the remote Agent, which kept working
   * throughout.
   */
  private followPhase(entry: SessionEntry, phase: ConnectedGatewayPhase): void {
    if (phase === 'reconnecting' || phase === 'failed' || phase === 'idle') {
      entry.forwardedByRun.clear();
      entry.awaitingResnapshot = true;
      return;
    }
    if (phase !== 'connected') return;
    // The session resnapshots on its own way back up, so a connection that
    // comes back carries new content whether or not anyone asked for it.
    this.noteAuthoritativeSnapshot(entry);
    if (!entry.awaitingResnapshot) return;
    entry.awaitingResnapshot = false;
    // This is also the other place an observation is confirmed and the plan's
    // binding is refreshed.
    this.rememberBoundIdentity(entry);
    for (const target of this.primaryTargetsOf(entry)) {
      this.publish({
        agentId: target.agentId,
        sourceId: entry.record.id,
        contextId: target.contextId,
        runId: null,
        kind: 'resnapshot',
        text: '',
        ordinal: this.nextOrdinal(),
        at: this.deps.now(),
      });
    }
  }

  /**
   * One streamed reply fragment, forwarded if and only if it belongs to a
   * mapped coworker's primary conversation. An event for any other context is
   * a work record: H2's conversation surface has one address, and this is the
   * transport-side half of that promise.
   */
  private forwardSegment(entry: SessionEntry, payload: unknown): void {
    if (this.disposed || entry.closed) return;
    if (!payload || typeof payload !== 'object') return;
    const row = payload as Record<string, unknown>;
    if (!validText(row.sessionKey, MAX_ID_LENGTH)) return;
    const sessionKey = row.sessionKey;
    const target = this.primaryTargetsOf(entry).find(
      candidate => candidate.contextId === sessionKey
    );
    if (!target) return;

    const runId = validText(row.runId, MAX_ID_LENGTH) ? row.runId : null;
    const runKey = runId ?? sessionKey;
    const forwarded = entry.forwardedByRun.get(runKey) ?? 0;
    const base = {
      agentId: target.agentId,
      sourceId: entry.record.id,
      contextId: target.contextId,
      runId,
      at: this.deps.now(),
    };

    if (forwarded > MAX_UPDATES_PER_RUN) return;
    if (forwarded === MAX_UPDATES_PER_RUN) {
      // Said once, then quiet. The renderer reads the conversation for the
      // rest rather than receiving an unbounded stream.
      entry.forwardedByRun.set(runKey, forwarded + 1);
      this.publish({
        ...base,
        kind: 'bounded',
        text: '',
        ordinal: this.nextOrdinal(),
      });
      return;
    }
    entry.forwardedByRun.set(runKey, forwarded + 1);

    const delta = typeof row.delta === 'string' ? row.delta : '';
    if (delta.length > 0) {
      this.publish({
        ...base,
        kind: 'delta',
        text: delta.slice(0, MAX_UPDATE_CHARACTERS),
        ordinal: this.nextOrdinal(),
      });
    }
    if (row.done === true) {
      entry.forwardedByRun.delete(runKey);
      this.publish({
        ...base,
        kind: 'complete',
        text: '',
        ordinal: this.nextOrdinal(),
      });
    }
  }

  /**
   * Every mapped coworker on this source that has a primary conversation,
   * with the exact address the source declared for it. The one place a
   * session key is derived, and it is derived from the projection.
   */
  private primaryTargetsOf(
    entry: SessionEntry
  ): { agentId: string; contextId: string }[] {
    const snapshot = entry.session.snapshot;
    if (!snapshot) return [];
    const targets: { agentId: string; contextId: string }[] = [];
    for (const mapping of this.deps.plans.read().mappings) {
      if (mapping.configuredSourceId !== entry.record.id) continue;
      const primary = findPrimaryConversation(snapshot, mapping.nativeAgentId);
      if (!primary) continue;
      targets.push({
        agentId: mapping.exawattAgentId,
        contextId: primary.nativeContextId,
      });
    }
    return targets;
  }

  private mappingFor(agentId: string): ConnectedAgentMapping | null {
    if (!validText(agentId, MAX_ID_LENGTH)) return null;
    return (
      this.deps.plans
        .read()
        .mappings.find(mapping => mapping.exawattAgentId === agentId) ?? null
    );
  }

  /**
   * Resolve a coworker's conversation address, or say precisely why there is
   * none. The mapping is durable and the snapshot is not, which is why an
   * unopened source answers `disconnected` rather than losing the coworker.
   */
  private resolveTarget(agentId: string):
    | { ok: true; entry: SessionEntry; contextId: string }
    | {
        ok: false;
        outcome: 'unknown-agent' | 'no-primary-conversation' | 'disconnected';
        message: string;
      } {
    const mapping = this.mappingFor(agentId);
    if (!mapping) {
      return {
        ok: false,
        outcome: 'unknown-agent',
        message: 'Exawatt has no coworker with that id.',
      };
    }
    const record = this.deps.store.get(mapping.configuredSourceId);
    if (!record) {
      return {
        ok: false,
        outcome: 'unknown-agent',
        message: "That coworker's source is no longer configured.",
      };
    }
    const entry = this.sessions.get(mapping.configuredSourceId);
    const snapshot = entry?.session.snapshot ?? null;
    if (!entry || !snapshot) {
      return {
        ok: false,
        outcome: 'disconnected',
        message: `Exawatt is not observing ${record.displayName} right now. Reconnect to catch up.`,
      };
    }
    if (
      !snapshot.agents.some(
        agent =>
          agent.nativeAgentId === mapping.nativeAgentId && stillDeclared(agent)
      )
    ) {
      return {
        ok: false,
        outcome: 'unknown-agent',
        message: "That coworker is not in the source's current configuration.",
      };
    }
    const primary = findPrimaryConversation(snapshot, mapping.nativeAgentId);
    if (!primary) {
      return {
        ok: false,
        outcome: 'no-primary-conversation',
        message:
          'This coworker holds no conversation on its source. Its automations and results are where it reports.',
      };
    }
    return { ok: true, entry, contextId: primary.nativeContextId };
  }

  /** The one place `chat.send` is formed, behind every check above it. */
  private async postMessage(
    entry: SessionEntry,
    agentId: string,
    contextId: string,
    text: string,
    idempotencyKey: string
  ): Promise<SendToAgentResult> {
    let payload: unknown;
    try {
      payload = await entry.session.write('chat.send', {
        sessionKey: contextId,
        text,
        idempotencyKey,
      });
    } catch (error) {
      return {
        ok: false,
        agentId,
        outcome: 'refused',
        message: describeSourceError(
          error,
          'The Gateway did not accept that message.'
        ),
      };
    }
    const result =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    return {
      ok: true,
      agentId,
      sourceId: entry.record.id,
      contextId,
      runId: validText(result.runId, MAX_ID_LENGTH) ? result.runId : null,
      status: result.status === 'queued' ? 'queued' : 'sent',
      idempotencyKey,
      at: this.deps.now(),
    };
  }

  private nextOrdinal(): number {
    this.updateOrdinal += 1;
    return this.updateOrdinal;
  }

  private publish(update: ConversationUpdate): void {
    if (this.disposed) return;
    for (const listener of this.conversationListeners) listener(update);
  }

  private connectionFor(entry: SessionEntry | null): SourceConnectionView {
    const status = entry
      ? entry.session.status()
      : resolveConnectionStatus({
          // Never opened this launch. Unavailable is the honest answer: it
          // says Exawatt is not observing, and says nothing at all about
          // whether the source is doing work.
          transportUp: false,
          retrying: false,
          lastObservedAt: null,
          failure: null,
          now: this.deps.now(),
        });
    return {
      state: status.state,
      label: CONNECTION_STATE_LABELS[status.state],
      detail: describeConnectionStatus(status),
      observationAgeMs: status.observationAgeMs,
      stalePresentation: status.stalePresentation,
      failure: status.failure,
    };
  }

  private statusFor(
    entry: SessionEntry | null,
    record: ConnectedSourceRecord
  ): ConnectedSourceStatusView {
    return {
      sourceId: record.id,
      displayName: record.displayName,
      adapterId: record.adapterId,
      placement: record.placement,
      placementLabel: PLACEMENT_LABELS[record.placement],
      observing: entry !== null,
      phase: entry?.session.phase ?? 'idle',
      connection: this.connectionFor(entry),
      /*
       * Last observed, not last connected. The session keeps what it read
       * across a drop, so a stale or unavailable source still reports the
       * version and capabilities it actually had; `connection` and the
       * snapshot age are what say how current the view is. A source this
       * launch has never reached reports nothing, which is why these are
       * read off the session rather than off the record.
       */
      version: observedVersion(entry?.session.facts ?? null, record),
      capabilities: observedCapabilities(entry?.session.facts ?? null, record),
      identityDrift: entry?.session.identityDrift != null,
      snapshotRevision: entry?.snapshotRevision ?? 0,
    };
  }

  private emit(entry: SessionEntry): void {
    if (this.disposed) return;
    const change: ConnectedSourceChange = {
      sourceId: entry.record.id,
      phase: entry.session.phase,
      connection: this.connectionFor(entry),
      snapshotRevision: entry.snapshotRevision,
    };
    for (const listener of this.listeners) listener(change);
  }
}

/* ---- Observed source facts ------------------------------------------------ */

/**
 * Where each observed fact came from, in the operator's words rather than the
 * protocol's. Method names are diagnostics; these are the sentence fragments a
 * source-detail row prints under a value.
 */
const VERSION_PROVENANCE = 'Gateway status';
const AUTHORITY_PROVENANCE = 'Gateway scope grant';
const AUTOMATION_PROVENANCE = 'Gateway automation list';

/**
 * The version the source reported, or null when it reported none.
 *
 * A Gateway that declares no version leaves this empty, and empty stays null
 * all the way to the surface: a row that says "not observed yet" is true, and
 * a row that invented "unknown version" would be Exawatt speaking for a
 * server that said nothing.
 */
function observedVersion(
  facts: ObservedGatewayFacts | null,
  record: ConnectedSourceRecord
): ObservedSourceFact | null {
  const version = facts?.version.trim() ?? '';
  if (version.length === 0) return null;
  return {
    value: version,
    basis: evidenceBasisForAdapter(record.adapterId),
    provenance: VERSION_PROVENANCE,
  };
}

/**
 * What Exawatt may do with this source, once it has actually reached it.
 *
 * Both rows are observations rather than promises. Conversation reads the
 * authority the Gateway granted this device, which is the same value the send
 * path gates on, so the page cannot advertise a voice the transport would
 * refuse. Automations reads the count discovery already paid for and says
 * plainly that Exawatt does not edit them: scheduling is `operator.admin`,
 * which Exawatt never requests.
 *
 * Nothing is reported before the first discovery. Authority survives on the
 * record across launches, but a capability list assembled without an
 * observation would tell an operator what Exawatt could do to a server it has
 * not managed to reach.
 */
function observedCapabilities(
  facts: ObservedGatewayFacts | null,
  record: ConnectedSourceRecord
): readonly ObservedSourceCapability[] {
  if (facts === null) return [];
  const basis = evidenceBasisForAdapter(record.adapterId);
  return [
    {
      label: 'Conversation',
      value:
        record.grantedAuthority === 'write' ? 'Read and send' : 'Read only',
      basis,
      provenance: AUTHORITY_PROVENANCE,
    },
    {
      label: 'Automations',
      value:
        facts.automationCount === 0
          ? 'None listed'
          : `${facts.automationCount} listed, not editable`,
      basis,
      provenance: AUTOMATION_PROVENANCE,
    },
  ];
}

/**
 * The same observation, as the Connect flow's fact list wants it: raw tokens
 * and nulls, because that surface owns its own vocabulary for them.
 *
 * The scopes are the ones this source's granted authority presents on the
 * handshake, which is what the Gateway approved on the device record. Identity
 * stays null: a Gateway reports a version and a roster, never a name for
 * itself, and Exawatt's own name for the connection is not an observation.
 */
function observedFactsView(
  facts: ObservedGatewayFacts | null,
  record: ConnectedSourceRecord
): ObservedSourceFactsView | null {
  if (facts === null) return null;
  const version = facts.version.trim();
  return {
    identity: null,
    version: version.length > 0 ? version : null,
    capabilities: [...SCOPES_FOR_AUTHORITY[record.grantedAuthority]],
    observedAt: facts.observedAt,
  };
}

/* ---- Pure projection helpers --------------------------------------------- */

/**
 * Does the source still declare this Agent?
 *
 * `retired` is the only answer that costs the operator a coworker, and it is
 * ordinary: somebody deleted an Agent on their own server. `unknown` is
 * silence, and silence is not a retirement, so a coworker the source said
 * nothing about stays exactly where it was.
 *
 * One predicate, because the roster and the conversation address used to
 * disagree. `agents()` dropped a retired coworker while `resolveTarget`
 * matched on the native id alone, so the same coworker could be gone from the
 * roster and still resolvable to an address.
 */
function stillDeclared(agent: {
  discoveryState: SourceAgentDiscoveryState;
}): boolean {
  return agent.discoveryState !== 'retired';
}

/**
 * Discovery, as the Connect dialog needs it: who exists, whether Exawatt has
 * placed them before, and enough shape to decide whether to import them.
 */
export function describeDiscoveredAgents(
  snapshot: AgentSourceTopologySnapshot,
  plan: ConnectedAgentProjectionPlan
): DiscoveredSourceAgent[] {
  const mapped = new Map(
    plan.mappings.map(mapping => [sourceAgentKey(mapping), mapping])
  );
  return snapshot.agents.map(agent => {
    const contexts = snapshot.contexts.filter(
      context => context.nativeAgentId === agent.nativeAgentId
    );
    const mapping = mapped.get(sourceAgentKey(agent)) ?? null;
    return {
      nativeAgentId: agent.nativeAgentId,
      displayName: agent.displayName,
      discoveryState: agent.discoveryState,
      contextCount: contexts.length,
      hasPrimaryConversation: contexts.some(isPrimaryConversation),
      mapping: mapping
        ? {
            exawattAgentId: mapping.exawattAgentId,
            projectId: mapping.projectId,
            projectLabel: mapping.projectLabel,
            displayNameOverride: mapping.displayNameOverride,
          }
        : null,
    };
  });
}

export function toRemoteAgentView(
  agent: ProjectedAgent,
  snapshot: AgentSourceTopologySnapshot,
  record: ConnectedSourceRecord,
  projectLabel: string,
  connection: SourceConnectionView
): RemoteAgentView {
  let createdAt = snapshot.observedAt;
  let lastActiveAt = 0;
  for (const context of agent.contexts) {
    if (context.createdAt !== undefined && context.createdAt < createdAt) {
      createdAt = context.createdAt;
    }
    if (
      context.lastActiveAt !== undefined &&
      context.lastActiveAt > lastActiveAt
    ) {
      lastActiveAt = context.lastActiveAt;
    }
  }
  return {
    id: agent.id,
    displayName: agent.displayName,
    projectId: agent.projectId,
    projectLabel,
    discoveryState: agent.discoveryState,
    placement: agent.placement,
    placementLabel: PLACEMENT_LABELS[agent.placement],
    adapterId: agent.adapterId,
    source: { id: record.id, displayName: record.displayName },
    nativeAgentId: agent.nativeAgentId,
    primaryContextId: agent.primaryConversation?.nativeContextId ?? null,
    workState: agent.workState,
    contextCount: agent.contexts.length,
    observedAt: snapshot.observedAt,
    createdAt,
    lastActiveAt: lastActiveAt === 0 ? snapshot.observedAt : lastActiveAt,
    connection,
    projectionVersion: AGENT_PROJECTION_VERSION,
  };
}
