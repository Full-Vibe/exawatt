import {
  adaptOpenClawTopology,
  generateDeviceKeypair,
  readGrantedAuthority,
  resolveConnectionStatus,
  type AgentSourceAdapterId,
  type AgentSourceEvidenceBasis,
  type AgentSourceTopologySnapshot,
  type ConnectedSourceRecord,
  type ConnectionStatus,
  type OCClientConfig,
  type OCDeviceKeypair,
  type OCGatewayClient,
  type OpenClawTopologyIssue,
  type SourceAuthority,
  type SourceFailureClass,
  type SourceTransport,
} from '@exawatt/core';
import { findPrimaryConversation } from './connected-conversation';
import {
  H1_READ_METHODS,
  H2_WRITE_METHODS,
  SCOPES_FOR_AUTHORITY,
  authorityForGrantedScopes,
  isH1ReadMethod,
  isH2WriteMethod,
  narrowerAuthority,
  type AuthorityRequestResult,
  type H1ReadMethod,
  type H2WriteMethod,
} from './connected-gateway-authority';
import {
  BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE,
  TUNNEL_FAILURE_TO_SOURCE_FAILURE,
  classifyAuthorityRefusal,
  classifyHandshakeFailure,
} from './connected-source-failure';
import type { ConnectedSourceStore } from './connected-source-store';
import type {
  GatewayBootstrapFacts,
  RemoteExec,
  resolveGatewayCredential,
} from './gateway-bootstrap';
import {
  gatewayIdentityDrifted,
  gatewayIdentityOf,
  normalizeGatewayIdentity,
  type GatewayIdentity,
  type GatewayIdentityDrift,
} from './gateway-identity';
import type { openSshTunnel, SshTunnel, SshTunnelTarget } from './ssh-tunnel';
import {
  MAX_ID_LENGTH,
  MAX_TEXT_LENGTH,
  describeSourceError,
  isRecord,
  sourceSentence,
} from './untrusted-input';

/**
 * ENG-010 C1: one configured source's whole read-only lifecycle.
 *
 * A `ConnectedGatewaySession` owns everything between "the operator saved this
 * source" and "Exawatt holds an authoritative topology snapshot for it":
 * transport, credential custody, pairing, discovery, freshness, reconnect, and
 * detach. It owns no UI, no projection policy, and no remote authority.
 *
 * Five rules shape every decision in this file.
 *
 * 1. **Read-only is the default, and the source enforces it.** The session
 *    requests exactly the scopes its granted authority earns, which for every
 *    new source is `operator.read`, so the Gateway itself refuses a write even
 *    if Exawatt asks for one. The local method allowlists are the second lock,
 *    not the first: they stop a typo or a future edit from ever forming the
 *    request. They live in `connected-gateway-authority`, which is the whole
 *    security vocabulary on one screen with no session state near it.
 * 2. **Losing the connection is not evidence about the remote Agent.** A drop
 *    means Exawatt stopped observing. It never means work stopped, paused, or
 *    ended, so nothing here writes such a conclusion into state or copy.
 * 3. **Reconnect resnapshots authoritatively.** The cached topology is
 *    discarded and rebuilt from a fresh `agents.list`/`sessions.list`; deltas
 *    are never merged into a stale tree. The Gateway's WebSocket frame
 *    sequence resets per connection and events are not replayed, so a sequence
 *    number must never be persisted as a catch-up cursor. Nothing in this file
 *    stores one.
 * 4. **Detach is not destruction.** `disconnect()` closes a tunnel and a
 *    socket. Quitting Exawatt detaches observation, not execution: the remote
 *    installation, its Agents, workspaces, history, automations, and
 *    credentials are untouched, and the device Exawatt paired stays revocable
 *    on the source with the source's own tooling.
 * 5. **Authority is granted, never assumed (ENG-033 H2).** Write authority is
 *    something the source's operator approves on the source; asking for it is
 *    a request whose honest outcomes include "an approval is waiting for you
 *    on the server". Exawatt records only what the Gateway answered with, and
 *    the write surface consults that record, so a surface that runs ahead of
 *    an approval is refused here rather than at the server. Exawatt never
 *    tries to approve its own device: doing so would need the admin-capable
 *    authority this whole custody model exists to avoid holding.
 */

export type ConnectedGatewayPhase =
  | 'idle'
  | 'opening-tunnel'
  | 'bootstrapping'
  | 'pairing'
  | 'discovering'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * Bounded facts observed alongside the snapshot. Deliberately counts and one
 * version string rather than retained `cron.list`/`status` payloads: those
 * carry workspace paths and schedules that belong to a later projection step,
 * and holding them here would put remote data in a transport object with no
 * contract for it.
 *
 * Observed on every discovery and not yet rendered anywhere: this is what a
 * source-detail surface needs and C2 has not built. It is kept rather than
 * dropped because the reads that produce it happen regardless, and because
 * `version` is already half of the identity a drift check compares.
 */
export interface ObservedGatewayFacts {
  version: string;
  configuredAgentCount: number;
  automationCount: number;
  observedAt: number;
}

export type SnapshotResult =
  | {
      ok: true;
      outcome: 'connected';
      snapshot: AgentSourceTopologySnapshot;
      identity: GatewayIdentity;
      facts: ObservedGatewayFacts;
      issues: readonly OpenClawTopologyIssue[];
    }
  | {
      ok: false;
      outcome: 'identity-drift';
      drift: GatewayIdentityDrift;
      message: string;
    }
  | {
      ok: false;
      outcome: 'failed';
      failure: SourceFailureClass;
      message: string;
    };

/**
 * Connecting ends in the same place a resnapshot does: one authoritative
 * snapshot, a drift report, or a classified failure. They share a type because
 * a first connect and a reconnect must produce indistinguishable results.
 */
export type ConnectResult = SnapshotResult;

/** The protocol client this session drives. */
export type ConnectedGatewayClient = OCGatewayClient & {
  connect(): Promise<void>;
  disconnect(): void;
  /**
   * The device token in play. Set before `connect()` to present a persisted
   * one; read after `connect()` to pick up a freshly issued one.
   */
  deviceToken?: string | null;
  /**
   * Scopes the Gateway reported granting on the last completed handshake, when
   * it reported any.
   *
   * The seam exists so that a Gateway which echoes its own device record can
   * correct Exawatt's belief. It is read in one direction: a report can only
   * narrow what Exawatt records, never widen it. Absent means the Gateway said
   * nothing, which is not evidence of a wider grant.
   */
  grantedScopes?: readonly string[] | null;
};

export interface ConnectedGatewaySessionDeps {
  store: Pick<
    ConnectedSourceStore,
    | 'readDeviceToken'
    | 'readDeviceKeypair'
    | 'writeDeviceCredential'
    | 'clearDeviceToken'
    | 'setGrantedAuthority'
    | 'setDiscoveredGatewayPort'
  >;
  openTunnel: typeof openSshTunnel;
  resolveCredential: typeof resolveGatewayCredential;
  remoteExec: RemoteExec;
  createClient: (config: OCClientConfig) => ConnectedGatewayClient;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  maxReconnectAttempts?: number;
  /**
   * The identity Exawatt last observed behind this source, when it holds one.
   *
   * Drift is a comparison, so a session with nothing to compare against
   * cannot make it. A relaunch builds a fresh session, and a relaunch is
   * exactly when a Gateway swapped for a different installation is most
   * likely and least visible: the app was closed while it happened. Learning
   * the previous identity only by watching would therefore accept the swap in
   * silence, which is the one outcome the doc rules out.
   *
   * So the previous identity is an input. The caller that owns the record
   * persists what `identity` reports after a successful snapshot and hands it
   * back here on the next launch; this session compares against it, reports
   * drift, and never guesses by display name. Read once, at construction, and
   * sanitised on the way in because it arrives from disk.
   */
  knownIdentity?: GatewayIdentity | null;
}

/**
 * The persisted transport, as the tunnel owner's target.
 *
 * Explicit field by field rather than a spread: the record and the target are
 * two models that happen to agree today, and a spread would carry any field a
 * later record shape adds straight into an `ssh` argument vector.
 */
export function tunnelTargetFor(
  transport: Exclude<SourceTransport, { kind: 'local-loopback' }>
): SshTunnelTarget {
  if (transport.kind === 'ssh-alias') {
    return {
      kind: 'ssh-alias',
      alias: transport.alias,
      remotePort: transport.remotePort,
    };
  }
  return {
    kind: 'ssh-manual',
    host: transport.host,
    user: transport.user,
    port: transport.port,
    identityFile: transport.identityFile,
    remotePort: transport.remotePort,
  };
}

/** Bounded exponential backoff. Exported so copy and tests share one number. */
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 6;
/** A quiet maintenance retry after the fast ladder, so a long outage heals. */
export const LONG_OUTAGE_RETRY_DELAY_MS = 60_000;
/** Freshness expires at 60s; a healthy source is observed twice inside that. */
export const PERIODIC_RESNAPSHOT_INTERVAL_MS = 30_000;
/** Presence bursts buy one authoritative read, never one read per frame. */
export const RESNAPSHOT_COALESCE_DELAY_MS = 500;
/** No configuration may turn the fast ladder into an unbounded hot loop. */
const RECONNECT_ATTEMPT_CEILING = 32;

const LOOPBACK_HOST = '127.0.0.1';

/**
 * The Gateway rejects any client id outside its own closed vocabulary, so
 * Exawatt maps to the platform's UI client rather than inventing a name that
 * would be refused. `clientVersion` is where the true identity travels.
 */
export function describeExawattClient(
  platform: NodeJS.Platform = process.platform,
  version = 'exawatt'
): Pick<
  OCClientConfig,
  'clientId' | 'clientMode' | 'clientVersion' | 'clientPlatform'
> {
  const clientId =
    platform === 'darwin'
      ? 'openclaw-macos'
      : platform === 'android'
        ? 'openclaw-android'
        : 'openclaw-control-ui';
  return {
    clientId,
    clientMode: 'ui',
    clientVersion: version,
    clientPlatform: platform,
  };
}

/*
 * Bounds on what a remote peer can make this process do before the adapter's
 * own validation runs. A Gateway is untrusted input, including a Gateway the
 * operator trusts: it may be compromised, downgraded, or simply buggy.
 */
const MAX_DISCOVERY_AGENTS = 500;

/**
 * Native Agent ids for the per-Agent `sessions.list` fan-out. Deliberately
 * minimal: this reads ids only, and `adaptOpenClawTopology` remains the one
 * place that decides what a valid Agent record is.
 */
function readNativeAgentIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.agents)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of payload.agents.slice(0, MAX_DISCOVERY_AGENTS)) {
    if (!isRecord(entry)) continue;
    const id: unknown = entry.id;
    if (typeof id !== 'string') continue;
    if (id.trim().length === 0 || id.length > MAX_ID_LENGTH) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function readGatewayVersion(payload: unknown): string {
  if (!isRecord(payload)) return '';
  for (const key of ['version', 'gatewayVersion']) {
    const value: unknown = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, MAX_TEXT_LENGTH);
    }
  }
  return '';
}

function countAutomations(payload: unknown): number {
  if (!isRecord(payload)) return 0;
  for (const key of ['jobs', 'crons', 'items']) {
    const value: unknown = payload[key];
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

/** Only outages heal by waiting. Credentials, config, and identity need a person. */
function retryableConnectionFailure(failure: SourceFailureClass): boolean {
  return failure === 'host-unreachable' || failure === 'gateway-down';
}

/** Read after a handshake: the client mutates this across an awaited call. */
function issuedDeviceToken(client: ConnectedGatewayClient): string | null {
  const value: unknown = client.deviceToken;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * What a source's answers are entitled to claim about themselves.
 *
 * Read off the source's own adapter rather than asserted at the call site. A
 * Demo source drives this exact lifecycle over a simulated Gateway, and
 * recording its answers as `observed` would let simulated data claim an
 * observation, which is precisely what the Demo-and-live parity criterion
 * exists to prevent. Every other adapter is reading a real installation over a
 * real socket, so what comes back is an observation.
 */
export function evidenceBasisForAdapter(
  adapterId: AgentSourceAdapterId
): AgentSourceEvidenceBasis {
  return adapterId === 'demo' ? 'simulated' : 'observed';
}

/** One carried event subscription: what to listen for, and who to tell. */
interface GatewayEventSubscription {
  eventName: string;
  handler: (payload: unknown) => void;
}

export class ConnectedGatewaySession {
  private readonly record: ConnectedSourceRecord;
  private readonly deps: ConnectedGatewaySessionDeps;
  private readonly maxReconnectAttempts: number;

  private currentPhase: ConnectedGatewayPhase = 'idle';
  private readonly phaseListeners = new Set<
    (phase: ConnectedGatewayPhase) => void
  >();
  private readonly snapshotListeners = new Set<() => void>();

  private tunnel: SshTunnel | null = null;
  private stopWatchingTunnel: (() => void) | null = null;
  private client: ConnectedGatewayClient | null = null;
  private stopWatchingClient: (() => void) | null = null;
  /**
   * Event subscriptions this session carries, whether or not a connection is
   * open. A caller subscribes when it takes an interest, which is when the
   * session is created and before anything has connected; holding the
   * subscriptions here rather than on a client is what lets that interest
   * survive into the connection that follows and into every later one.
   */
  private readonly subscriptions = new Set<GatewayEventSubscription>();
  /**
   * The client every carried subscription is attached to right now, if any.
   * Held so a teardown detaches from the client the handlers actually reached
   * rather than from whatever `this.client` has become by then.
   */
  private subscribedClient: ConnectedGatewayClient | null = null;
  /**
   * The config object the live client kept. Held because a scope change is a
   * property of the handshake, so renegotiating means changing `scopes` on the
   * object the client reads and connecting the same client again. `pair()`
   * already clears `token` on this same object for the same reason.
   */
  private clientConfig: OCClientConfig | null = null;
  /** One fresh alias bootstrap carried from port discovery into pairing. */
  private pendingBootstrapFacts: GatewayBootstrapFacts | null = null;
  /** The port this launch observed, even before the immutable record is rebuilt. */
  private resolvedAliasGatewayPort: number | null = null;

  /** Last authoritative snapshot. Retained across a drop, never merged into. */
  private lastSnapshot: AgentSourceTopologySnapshot | null = null;
  private lastIdentity: GatewayIdentity | null = null;
  private lastFacts: ObservedGatewayFacts | null = null;
  private lastObservedAt: number | null = null;

  private transportUp = false;
  private retrying = false;
  private terminalFailure: SourceFailureClass | null = null;
  private drift: GatewayIdentityDrift | null = null;

  /**
   * Authority the Gateway granted this device, as last observed. The seeded
   * value is what the store persisted; every later value comes from a
   * completed handshake. The record passed to the constructor is a snapshot
   * and is never mutated, so this field is the live truth.
   */
  private grantedAuthority: SourceAuthority;

  private reconnectTimer: unknown = null;
  private reconnectAttempts = 0;
  private periodicResnapshotTimer: unknown = null;
  private coalescedResnapshotTimer: unknown = null;
  private resnapshotInFlight: Promise<SnapshotResult> | null = null;
  private resnapshotQueued = false;
  /** A topology hint is invalidation only; the authoritative reads replace it. */
  private readonly topologyInvalidated = (): void => {
    this.queueCoalescedResnapshot();
  };
  /** Set while this session is deliberately tearing a connection down. */
  private tearingDown = false;
  /**
   * Set while this session is deliberately cycling the socket to change scope.
   * The drop it causes is not an outage and must not start the retry ladder.
   */
  private renegotiating = false;
  /** Set by `disconnect()`; cleared by a later `connect()`. */
  private detached = false;

  constructor(
    record: ConnectedSourceRecord,
    deps: ConnectedGatewaySessionDeps
  ) {
    this.record = record;
    this.deps = deps;
    this.grantedAuthority = readGrantedAuthority(record.grantedAuthority);
    /*
     * What the last process saw behind this source, when the caller kept it.
     * A relaunch is a fresh session over a source that has a history, and this
     * is that history: without it the first snapshot has nothing to be drift
     * against and a swapped installation is accepted in silence.
     */
    this.lastIdentity = normalizeGatewayIdentity(deps.knownIdentity);
    const configured =
      deps.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.maxReconnectAttempts = Math.max(
      0,
      Math.min(RECONNECT_ATTEMPT_CEILING, Math.floor(configured))
    );
  }

  get phase(): ConnectedGatewayPhase {
    return this.currentPhase;
  }

  /** Last authoritative topology. Null until the first successful discovery. */
  get snapshot(): AgentSourceTopologySnapshot | null {
    return this.lastSnapshot;
  }

  get identity(): GatewayIdentity | null {
    return this.lastIdentity;
  }

  get facts(): ObservedGatewayFacts | null {
    return this.lastFacts;
  }

  /** Non-null once a reconnect observed a different installation. */
  get identityDrift(): GatewayIdentityDrift | null {
    return this.drift;
  }

  /**
   * Authority the source granted this device. The one gate the write surface
   * consults, and the one value a caller should read before offering a verb.
   */
  get authority(): SourceAuthority {
    return this.grantedAuthority;
  }

  onPhaseChange(listener: (phase: ConnectedGatewayPhase) => void): () => void {
    this.phaseListeners.add(listener);
    return () => {
      this.phaseListeners.delete(listener);
    };
  }

  /** Every successful authoritative replacement, including quiet refreshes. */
  onSnapshot(listener: () => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  /**
   * Open observation, from whatever state this session is in.
   *
   * The first thing it does is close whatever is already open, exactly as the
   * reconnect ladder does. Connecting over a live connection would leave an
   * orphaned `ssh` child holding a port open on the operator's server and an
   * unwatched socket carrying the traffic, so the session would keep
   * reporting Live through a drop it could no longer see. Reconnect is a
   * button in the product and it calls straight through to here, so this is
   * not a defensive nicety: it is the ordinary path.
   */
  async connect(): Promise<ConnectResult> {
    this.detached = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.retrying = false;
    await this.teardownConnection();
    const result = await this.establish();
    if (!result.ok) {
      if (
        result.outcome === 'failed' &&
        retryableConnectionFailure(result.failure)
      ) {
        // The caller still receives the first failure as its immediate answer,
        // while the saved source remains visibly Reconnecting and heals when a
        // server that was down during app launch returns.
        this.retrying = true;
        this.terminalFailure = result.failure;
        this.setPhase('reconnecting');
        this.scheduleReconnect();
      } else {
        this.setPhase('failed');
      }
    }
    return result;
  }

  /**
   * Follow Gateway events for this source.
   *
   * Subscribing is observation, so this rides the read authority H1 already
   * holds. The returned unsubscribe is the only way off: a listener that
   * outlived its owner would keep forwarding a conversation nobody is
   * watching, and the Gateway replays nothing after a reconnect, so a stale
   * listener would be silently wrong rather than merely wasteful.
   *
   * Ordering across a reconnect is deliberately NOT this method's problem.
   * The frame sequence resets per connection, so the consumer reconciles
   * against an authoritative read instead of trusting event order to survive.
   *
   * Connection order is not the caller's problem either. A subscription taken
   * before anything is connected is carried by the session and attached to the
   * connection that follows, and it is re-established on every later
   * connection rather than resumed: the client is new, the handlers are
   * registered on it afresh, and no sequence number is kept anywhere, because
   * the Gateway replays nothing and a resumed cursor would silently skip
   * whatever arrived while the socket was down.
   */
  onGatewayEvent(
    eventName: string,
    handler: (payload: unknown) => void
  ): () => void {
    const subscription: GatewayEventSubscription = { eventName, handler };
    this.subscriptions.add(subscription);
    this.subscribedClient?.onOCEvent(eventName, handler);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subscriptions.delete(subscription);
      this.subscribedClient?.offOCEvent(eventName, handler);
    };
  }

  /**
   * Authoritative resnapshot. Discards the cached topology and rebuilds it from
   * a fresh `agents.list`/`sessions.list`; it never merges deltas into a cached
   * view, and it stores no frame sequence as a catch-up cursor because the
   * Gateway resets that sequence per connection and replays nothing.
   *
   * Idempotent by construction: the adapter orders every Agent and context
   * deterministically and `observedAt` is the only field that moves, so running
   * this twice over identical source state produces an identical topology.
   */
  async resnapshot(): Promise<SnapshotResult> {
    if (!this.client) {
      return {
        ok: false,
        outcome: 'failed',
        failure: 'gateway-down',
        message: 'No Gateway connection is open for this source.',
      };
    }
    return this.runResnapshot(true);
  }

  /** One shared refresh for manual, periodic, and event-invalidated reads. */
  private async runResnapshot(announcePhase: boolean): Promise<SnapshotResult> {
    if (this.resnapshotInFlight !== null) {
      this.resnapshotQueued = true;
      return this.resnapshotInFlight;
    }
    const operation = this.performResnapshot(announcePhase);
    this.resnapshotInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.resnapshotInFlight === operation) {
        this.resnapshotInFlight = null;
      }
      if (this.resnapshotQueued) {
        this.resnapshotQueued = false;
        this.queueCoalescedResnapshot();
      }
    }
  }

  private async performResnapshot(
    announcePhase: boolean
  ): Promise<SnapshotResult> {
    const result = await this.discover(announcePhase);
    if (result.ok) {
      if (announcePhase) this.setPhase('connected');
      this.schedulePeriodicResnapshot();
      return result;
    }
    if (result.outcome === 'failed') this.handleDrop(result.failure);
    return result;
  }

  /** Presence may burst; one delayed authoritative replacement absorbs it. */
  private queueCoalescedResnapshot(): void {
    if (this.detached || !this.transportUp || this.drift !== null) return;
    if (this.resnapshotInFlight !== null) {
      this.resnapshotQueued = true;
      return;
    }
    if (this.coalescedResnapshotTimer !== null) return;
    this.coalescedResnapshotTimer = this.deps.setTimer(() => {
      this.coalescedResnapshotTimer = null;
      void this.runResnapshot(false);
    }, RESNAPSHOT_COALESCE_DELAY_MS);
  }

  private schedulePeriodicResnapshot(): void {
    if (this.detached || !this.transportUp || this.drift !== null) return;
    if (this.periodicResnapshotTimer !== null) {
      this.deps.clearTimer(this.periodicResnapshotTimer);
    }
    this.periodicResnapshotTimer = this.deps.setTimer(() => {
      this.periodicResnapshotTimer = null;
      void this.runResnapshot(false);
    }, PERIODIC_RESNAPSHOT_INTERVAL_MS);
  }

  private clearObservationTimers(): void {
    if (this.periodicResnapshotTimer !== null) {
      this.deps.clearTimer(this.periodicResnapshotTimer);
      this.periodicResnapshotTimer = null;
    }
    if (this.coalescedResnapshotTimer !== null) {
      this.deps.clearTimer(this.coalescedResnapshotTimer);
      this.coalescedResnapshotTimer = null;
    }
    this.resnapshotQueued = false;
  }

  /**
   * Ask the Gateway to stream this source's conversations.
   *
   * Best effort on purpose. A Gateway that does not accept the subscription
   * leaves the operator reading replies on the next authoritative read, which
   * is slower and still correct; failing the whole connection over it would
   * trade a working read-only source for nothing. The subscription is
   * re-established on every socket this session opens rather than resumed:
   * after a reconnect, and after a scope change that cycles the socket
   * deliberately. Events are not replayed, so a resumed cursor would silently
   * skip whatever arrived while the socket was down.
   */
  private async followConversations(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    for (const agent of snapshot.agents) {
      if (agent.discoveryState !== 'configured') continue;
      const primary = findPrimaryConversation(snapshot, agent.nativeAgentId);
      if (!primary) continue;
      try {
        await this.read('sessions.messages.subscribe', {
          key: primary.nativeContextId,
        });
      } catch {
        // Reported by absence: no stream, and the reader falls back to
        // authoritative history. Nothing here may fail the connection.
      }
    }
  }

  status(): ConnectionStatus {
    return resolveConnectionStatus({
      /*
       * A drifted session has a healthy socket and an unknown subject. Saying
       * `Live` would claim the cached view is current for coworkers Exawatt can
       * no longer confirm it is watching, so identity drift withdraws the
       * transport's vote on freshness. It is not a `SourceFailureClass`,
       * because nothing about the connection failed.
       */
      transportUp: this.transportUp && this.drift === null,
      retrying: this.retrying,
      lastObservedAt: this.lastObservedAt,
      failure: this.terminalFailure,
      now: this.deps.now(),
    });
  }

  /**
   * The only public Gateway call surface, and the only place a method name
   * reaches the client. C2 needs `chat.history` for a bounded conversation
   * view; it gets it through this guard, not around it.
   */
  async read<R = unknown>(method: string, params?: unknown): Promise<R> {
    return this.callGateway<R>(method, params);
  }

  /**
   * The command surface (ENG-033 H2), and the only place a write method name
   * reaches the client.
   *
   * Two separate refusals, in this order. A method outside `H2_WRITE_METHODS`
   * is not a write verb at all, so it is refused regardless of authority:
   * `read()` cannot reach a write method, this cannot reach a read one, and
   * neither can reach an admin one. Then the granted authority decides,
   * because a surface that offered a composer before the source's operator
   * approved the device would otherwise turn a local mistake into a confusing
   * server-side rejection.
   */
  async write<R = unknown>(method: string, params?: unknown): Promise<R> {
    return this.callGatewayWrite<R>(method, params);
  }

  /**
   * Ask the source to raise this device from observation to conversation.
   *
   * This is a request, and the honest set of answers includes one that is
   * neither yes nor no: the Gateway will not raise an already-approved
   * device's scope without an approval performed on the source itself. When
   * that is the answer, the source keeps working exactly as it was and the
   * result says what the operator has to do.
   *
   * Nothing here changes device identity or approves the request. A live
   * Gateway proved that a read-scoped token cannot mint its wider replacement
   * even after the source operator approves the device. The explicit ask must
   * therefore read the source's shared secret again, present the SAME keypair,
   * and persist the newly issued scoped token. The secret remains memory-only
   * and the completed handshake remains the only fact that can widen authority.
   */
  async requestWriteAuthority(): Promise<AuthorityRequestResult> {
    if (this.grantedAuthority === 'write') {
      return {
        outcome: 'unchanged',
        authority: 'write',
        message: 'This source has already granted Exawatt write authority.',
      };
    }

    const client = this.client;
    const config = this.clientConfig;
    if (!client || !config) {
      return {
        outcome: 'refused',
        authority: this.grantedAuthority,
        message:
          'No Gateway connection is open for this source, so there is nothing to ask.',
      };
    }

    const credential = await this.deps.resolveCredential(
      this.record.transport,
      {
        exec: this.deps.remoteExec,
      }
    );
    if (!credential.ok) {
      return {
        outcome: 'refused',
        authority: this.grantedAuthority,
        message: `Exawatt could not ask this source for write access. ${credential.message}`,
      };
    }

    const keypair = config.deviceKeypair;
    if (!keypair) {
      return {
        outcome: 'refused',
        authority: this.grantedAuthority,
        message:
          'Exawatt cannot prove which paired device is asking for write access.',
      };
    }

    this.renegotiating = true;
    let restoreFailed = false;
    const previousToken = client.deviceToken ?? null;
    let sharedSecret: string | null = credential.facts.sharedToken;
    try {
      // The source binds a device token to both keypair and scope. The shared
      // secret authorises issuance; the unchanged keypair proves this is the
      // already-visible Exawatt device, not a second device pairing itself.
      client.deviceToken = null;
      config.token = sharedSecret;
      const attempt = await this.renegotiate(client, config, 'write');
      // The explicit handshake is over. No restore, stream subscription, or
      // later reconnect may inherit the admin-capable bootstrap credential.
      sharedSecret = null;
      config.token = undefined;
      if (attempt.ok) {
        const granted = this.grantedFrom(client, 'write');
        const issued = issuedDeviceToken(client);
        if (granted === 'write' && issued !== null) {
          const stored = this.deps.store.writeDeviceCredential(this.record.id, {
            token: issued,
            keypair,
          });
          if (!stored.ok) {
            client.deviceToken = previousToken;
            const restored = await this.renegotiate(client, config, 'read');
            restoreFailed = !restored.ok;
            return {
              outcome: 'refused',
              authority: 'read',
              message:
                'This source granted write access, but Exawatt could not keep the scoped device credential safely. Read-only observation continues.',
            };
          }
          this.applyGrantedAuthority('write');
          return {
            outcome: 'granted',
            authority: 'write',
            message: 'This source granted Exawatt write authority.',
          };
        }
        /*
         * The handshake completed and the Gateway reported a narrower grant
         * than the one asked for. Recording the ask would be the exact lie
         * this whole field exists to prevent, so the narrower grant wins.
         */
        client.deviceToken = previousToken;
        const restored = await this.renegotiate(client, config, 'read');
        restoreFailed = !restored.ok;
        return {
          outcome: 'refused',
          authority: 'read',
          message:
            'This source granted observation only, so Exawatt still holds read access.',
        };
      }

      // Refused. Put the connection back the way the operator had it: the
      // request failing must not cost them the view they already had.
      client.deviceToken = previousToken;
      const restored = await this.renegotiate(client, config, 'read');
      restoreFailed = !restored.ok;
      return {
        outcome: attempt.refusal,
        authority: this.grantedAuthority,
        message:
          attempt.refusal === 'approval-required'
            ? 'This source needs its own operator to approve write access for the Exawatt device. Approve it with the source device tooling, then ask again.'
            : attempt.sentence === null
              ? 'This source refused write access.'
              : `This source refused write access. It said "${attempt.sentence}".`,
      };
    } finally {
      sharedSecret = null;
      config.token = undefined;
      this.renegotiating = false;
      if (restoreFailed) {
        // The refusal is answered above; the lost socket is an ordinary drop
        // and the existing ladder is what repairs it.
        this.handleDrop('gateway-down');
      }
    }
  }

  /**
   * Give write authority back.
   *
   * Asking for less than the source approved always succeeds, so this needs
   * nobody's permission and takes effect locally first: the write surface is
   * shut before any socket work, and it stays shut even if the Gateway is
   * unreachable.
   *
   * What this achieves, said plainly: **Exawatt stops asking.** It reconnects
   * requesting `operator.read`, so this session and every later one hold read
   * scopes only. It does not revoke the device and it is not known to lower
   * the approval the source recorded, which was verified only in the raising
   * direction. An operator who wants the source-side approval itself withdrawn
   * revokes or re-approves the Exawatt device with the source's own tooling,
   * and the message says so rather than claiming a revocation that may not
   * have happened.
   */
  async relinquishWriteAuthority(): Promise<AuthorityRequestResult> {
    if (this.grantedAuthority === 'read') {
      return {
        outcome: 'unchanged',
        authority: 'read',
        message: 'Exawatt already holds read access only on this source.',
      };
    }

    this.applyGrantedAuthority('read');

    const client = this.client;
    const config = this.clientConfig;
    if (!client || !config) {
      return {
        outcome: 'granted',
        authority: 'read',
        message:
          'Exawatt gave up write access and will ask for read access only. The device stays paired on the source until you revoke it there.',
      };
    }

    this.renegotiating = true;
    let dropped = false;
    try {
      const narrowed = await this.renegotiate(client, config, 'read');
      dropped = !narrowed.ok;
      return {
        outcome: 'granted',
        authority: 'read',
        message: narrowed.ok
          ? 'Exawatt gave up write access and now asks for read access only. The device stays paired on the source until you revoke it there.'
          : 'Exawatt gave up write access and will ask for read access only when it reconnects. The device stays paired on the source until you revoke it there.',
      };
    } finally {
      this.renegotiating = false;
      if (dropped) this.handleDrop('gateway-down');
    }
  }

  /**
   * Detach. Idempotent, and it leaves the remote installation exactly as it
   * was: quitting Exawatt detaches observation, not execution. No pause, stop,
   * abort, cron change, or Gateway control is implied or issued here, and the
   * paired device remains listed and revocable on the source.
   */
  async disconnect(): Promise<void> {
    this.detached = true;
    this.clearReconnectTimer();
    this.retrying = false;
    await this.teardownConnection();
    this.setPhase('idle');
  }

  // ---- Lifecycle ---------------------------------------------------------

  private async establish(): Promise<ConnectResult> {
    const transport = await this.openTransport();
    if (!transport.ok) {
      this.transportUp = false;
      this.terminalFailure = transport.failure;
      return {
        ok: false,
        outcome: 'failed',
        failure: transport.failure,
        message: transport.message,
      };
    }

    const credential = await this.resolveCredential();
    if (!credential.ok) {
      await this.teardownConnection();
      this.terminalFailure = credential.failure;
      return {
        ok: false,
        outcome: 'failed',
        failure: credential.failure,
        message: credential.message,
      };
    }

    const paired = await this.pair(transport.port, credential);
    if (!paired.ok) {
      await this.teardownConnection();
      this.terminalFailure = paired.failure;
      return {
        ok: false,
        outcome: 'failed',
        failure: paired.failure,
        message: paired.message,
      };
    }

    const discovered = await this.discover();
    if (!discovered.ok) {
      if (discovered.outcome === 'failed') {
        await this.teardownConnection();
        this.terminalFailure = discovered.failure;
      }
      return discovered;
    }

    this.transportUp = true;
    this.retrying = false;
    this.terminalFailure = null;
    this.watchForDrops();
    /*
     * Every connection asks the Gateway to stream again. This is a fresh
     * subscription on a fresh socket, never a resumed one: the Gateway replays
     * nothing, so what arrived while Exawatt was away is recovered from the
     * authoritative snapshot taken a moment ago rather than from a cursor.
     */
    await this.followConversations();
    this.setPhase('connected');
    this.schedulePeriodicResnapshot();
    return discovered;
  }

  /**
   * Reach the Gateway's loopback port.
   *
   * `local-loopback` is the operator's own machine-local Gateway, which is one
   * more configured source now rather than a special case. It already listens
   * on this machine's loopback, so a tunnel would forward loopback to itself:
   * an extra `ssh` process that can only add failure modes.
   *
   * Both SSH transports open the same way. An alias and a manually entered
   * server differ in what they hand `ssh`, which is the tunnel owner's business
   * and validated there; from here they are one path.
   */
  private async openTransport(): Promise<
    | { ok: true; port: number }
    | { ok: false; failure: SourceFailureClass; message: string }
  > {
    const transport = this.record.transport;

    if (transport.kind === 'local-loopback') {
      return { ok: true, port: transport.port };
    }

    this.setPhase('opening-tunnel');
    let tunnelTransport = transport;
    if (transport.kind === 'ssh-alias') {
      const keypair = this.deps.store.readDeviceKeypair(this.record.id);
      const token = this.deps.store.readDeviceToken(this.record.id);
      const hasStoredCredential =
        keypair !== null && typeof token === 'string' && token.length > 0;

      if (!hasStoredCredential && this.resolvedAliasGatewayPort === null) {
        /*
         * An alias has nowhere for the operator to enter a Gateway port. Read
         * the source's own declaration before constructing the forward, carry
         * the same bootstrap result into pairing, and remember only the public
         * port. This is still one bounded bootstrap and one ephemeral secret.
         */
        const bootstrap = await this.deps.resolveCredential(transport, {
          exec: this.deps.remoteExec,
        });
        if (!bootstrap.ok) {
          return {
            ok: false,
            failure: BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE[bootstrap.failure],
            message: bootstrap.message,
          };
        }
        this.pendingBootstrapFacts = bootstrap.facts;
        this.resolvedAliasGatewayPort = bootstrap.facts.gatewayPort;
        this.deps.store.setDiscoveredGatewayPort(
          this.record.id,
          bootstrap.facts.gatewayPort
        );
      }

      tunnelTransport = {
        ...transport,
        remotePort: this.resolvedAliasGatewayPort ?? transport.remotePort,
      };
    }

    const opened = await this.deps.openTunnel(tunnelTargetFor(tunnelTransport));
    if (!opened.ok) {
      this.pendingBootstrapFacts = null;
      return {
        ok: false,
        failure: TUNNEL_FAILURE_TO_SOURCE_FAILURE[opened.failure.class],
        message: opened.failure.message,
      };
    }
    this.tunnel = opened.tunnel;
    return { ok: true, port: opened.tunnel.localPort };
  }

  /**
   * Credential custody, in one place.
   *
   * A credential is two things, and Exawatt is only the device this source
   * already knows when it holds both: the scoped token, and the keypair the
   * Gateway issued that token to. The Gateway derives the device id from the
   * public key and binds the token to it, so a launch that presented a stored
   * token behind a freshly minted keypair was refused every time with
   * "device token mismatch". That was not a rare edge: it was every relaunch
   * and every automatic reconnect of every saved source.
   *
   * So the identity is resolved first, and three states follow from it.
   *
   * 1. **Identity and token.** The steady state, and the reason this milestone
   *    exists: no bootstrap, no shared secret, no new device. One device,
   *    once, forever.
   * 2. **Identity, no token.** The token was cleared, expired, or refused.
   *    Exawatt pairs again as the device it already is, so the source gets a
   *    reissued token rather than a second device record.
   * 3. **No identity.** Nothing to be but someone new, so a keypair is minted
   *    here and persisted only once the Gateway has actually issued a token
   *    for it. A token found without its keypair is deliberately ignored:
   *    it belongs to a device this process can no longer be.
   *
   * Minting here rather than in the client is the point of the seam. The
   * identity belongs to the configured source, not to a socket, so the
   * session owns it and hands it to whatever client it builds; a client left
   * to mint its own would tie a persisted identity to whether that particular
   * client implementation happens to expose it.
   */
  private async resolveCredential(): Promise<
    | {
        ok: true;
        deviceToken: string | null;
        keypair: OCDeviceKeypair;
        sharedSecret: string | null;
      }
    | { ok: false; failure: SourceFailureClass; message: string }
  > {
    const identity = this.deps.store.readDeviceKeypair(this.record.id);
    if (identity !== null) {
      const stored = this.deps.store.readDeviceToken(this.record.id);
      if (typeof stored === 'string' && stored.length > 0) {
        return {
          ok: true,
          deviceToken: stored,
          keypair: identity,
          sharedSecret: null,
        };
      }
    }

    this.setPhase('bootstrapping');
    /*
     * One seam for every transport. It reads the source's own configuration
     * over SSH for a server, and on this machine for the operator's own
     * Gateway, which has no alias because it has no hop.
     */
    const carried = this.pendingBootstrapFacts;
    this.pendingBootstrapFacts = null;
    let facts: GatewayBootstrapFacts;
    if (carried !== null) {
      facts = carried;
    } else {
      const result = await this.deps.resolveCredential(this.record.transport, {
        exec: this.deps.remoteExec,
      });
      if (!result.ok) {
        return {
          ok: false,
          failure: BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE[result.failure],
          message: result.message,
        };
      }
      facts = result.facts;
    }
    return {
      ok: true,
      deviceToken: null,
      keypair: identity ?? (await generateDeviceKeypair()),
      sharedSecret: facts.sharedToken,
    };
  }

  /**
   * Pair Exawatt's own device identity at exactly the scopes its granted
   * authority earns, which for a source connecting for the first time is
   * `operator.read` and nothing else. Connecting never widens authority: it
   * presents what the record says the source already granted, and a refusal
   * narrows the ask rather than escalating it.
   *
   * The shared secret lives in one local variable for the length of this
   * method. It is presented once, the device token the Gateway answers with is
   * persisted, and the secret is then cleared from the config object the client
   * holds as well as from this scope. It is never returned, never logged, never
   * written to the store, and never placed on `this`.
   */
  /**
   * How Exawatt introduces itself on the handshake.
   *
   * The Gateway's client-id vocabulary is a closed set with no Exawatt member,
   * so the honest available answer is the platform's UI client; `clientVersion`
   * carries the real identity into the source's own logs and device list.
   *
   * The mode is load-bearing, not cosmetic. Connecting as `backend` over the
   * tunnel makes the Gateway treat Exawatt as a local self-connection and skip
   * device pairing entirely, so no device token is ever issued and every
   * launch would have to re-read the admin-capable shared secret. Connecting
   * as a UI client pairs properly and yields a token scoped to exactly the
   * scopes requested. Verified against a live Gateway: the resulting device
   * record carries `operator.read` and nothing else.
   */
  private async pair(
    port: number,
    credential: {
      deviceToken: string | null;
      keypair: OCDeviceKeypair;
      sharedSecret: string | null;
    }
  ): Promise<
    { ok: true } | { ok: false; failure: SourceFailureClass; message: string }
  > {
    this.setPhase('pairing');

    let sharedSecret: string | null = credential.sharedSecret;
    const config: OCClientConfig = {
      url: `ws://${LOOPBACK_HOST}:${port}`,
      scopes: [...SCOPES_FOR_AUTHORITY[this.grantedAuthority]],
      /*
       * The device Exawatt is on this source, carried on the config so that
       * every client this session builds is the same device: the first one,
       * the one a scope change cycles, and the one each reconnect opens.
       */
      deviceKeypair: credential.keypair,
      ...describeExawattClient(),
    };
    if (sharedSecret !== null) {
      config.token = sharedSecret;
    }

    const client = this.deps.createClient(config);
    this.client = client;
    this.clientConfig = config;
    /*
     * Before the handshake, so a subscription taken while nothing was
     * connected hears this connection from its first frame rather than from
     * whenever the caller happens to ask again.
     */
    this.attachSubscriptions(client);
    if (credential.deviceToken !== null) {
      client.deviceToken = credential.deviceToken;
    }

    let requested: SourceAuthority = this.grantedAuthority;
    let opened = await this.openHandshake(client);
    if (!opened.ok && requested === 'write') {
      /*
       * Asking for less than the source approved is always allowed, so a
       * refused write ask means the approval this record remembers no longer
       * stands: revoked, re-approved narrower, or a different installation's
       * device list. Falling back to read keeps observation alive and records
       * the honest downgrade instead of stranding the source over authority it
       * does not have. The reverse fallback does not exist and must not: no
       * failure may widen what Exawatt asks for.
       */
      requested = 'read';
      config.scopes = [...SCOPES_FOR_AUTHORITY.read];
      opened = await this.openHandshake(client);
    }
    if (!opened.ok) {
      sharedSecret = null;
      config.token = undefined;
      return this.refusedHandshake(
        opened.sentence,
        credential.deviceToken !== null
      );
    }

    const issued =
      typeof client.deviceToken === 'string' && client.deviceToken.length > 0
        ? client.deviceToken
        : null;

    if (issued !== null && issued !== credential.deviceToken) {
      /*
       * The token and the identity it was issued to, written together. A
       * token stored without its keypair is what broke every relaunch of
       * every saved source, so there is deliberately no path here that can
       * persist one without the other.
       */
      const written = this.deps.store.writeDeviceCredential(this.record.id, {
        token: issued,
        keypair: credential.keypair,
      });
      if (!written.ok) {
        /*
         * Encryption unavailable, or the write failed. The session continues:
         * observation is already authorized for this process, and refusing to
         * connect would punish the operator for an OS keychain state they did
         * not choose. What must not happen is claiming a credential Exawatt
         * cannot read back, so the store's own flag stays false and the next
         * launch simply bootstraps again.
         */
        this.deps.store.clearDeviceToken(this.record.id);
      }
    }

    // Drop the shared secret. Clearing the config's copy matters because the
    // client keeps that object; from here on it presents the device token.
    sharedSecret = null;
    config.token = undefined;

    this.applyGrantedAuthority(this.grantedFrom(client, requested));

    return { ok: true };
  }

  // ---- Authority ---------------------------------------------------------

  /**
   * One handshake attempt, with the client's own failure turned into a
   * sentence rather than an exception.
   *
   * `sentence` is the source's own account of the refusal, or null when the
   * connection died without giving one. Carrying it is the whole fix to the
   * second half of a live finding: a Gateway that refuses a credential says
   * exactly why, Exawatt threw that away, and the operator was sent to check
   * a Gateway that was answering perfectly well. It is protocol text, not
   * transport text, and it is the sentence that makes the next step obvious.
   */
  private async openHandshake(
    client: ConnectedGatewayClient
  ): Promise<{ ok: true } | { ok: false; sentence: string | null }> {
    try {
      await client.connect();
      return { ok: true };
    } catch (error) {
      return { ok: false, sentence: sourceSentence(error) };
    }
  }

  /**
   * A refused handshake, as the operator reads it.
   *
   * Two decisions live here. The failure is classified by what the source
   * actually said, so a refused credential stops being reported as an
   * unreachable Gateway; and a stored credential the source refuses is
   * discarded rather than presented again forever, because a source that can
   * never connect again until someone clears a keychain entry by hand is the
   * outcome this milestone exists to prevent.
   *
   * Discarding is where the recovery stops, deliberately. Pairing again mints
   * a NEW device on the operator's server and re-reads the admin-capable
   * shared secret, which is exactly the posture the credential model exists
   * to avoid. So this call ends in a reported failure that names what was
   * discarded and what connecting again will cost, the retry ladder stops on
   * this failure class rather than pairing on a timer, and the operator's
   * next connect is the act that pairs.
   */
  private refusedHandshake(
    sentence: string | null,
    presentedStoredCredential: boolean
  ): { ok: false; failure: SourceFailureClass; message: string } {
    const failure = classifyHandshakeFailure(sentence);
    const said = sentence === null ? '' : ` The source said "${sentence}".`;

    if (failure !== 'auth-rejected') {
      return {
        ok: false,
        failure,
        message: `Exawatt reached this source but the Gateway refused the connection.${said}`,
      };
    }

    if (!presentedStoredCredential) {
      return {
        ok: false,
        failure,
        message: `This source refused to pair the Exawatt device.${said}`,
      };
    }

    this.deps.store.clearDeviceToken(this.record.id);
    return {
      ok: false,
      failure,
      message: `This source refused the device credential Exawatt saved for it.${said} Exawatt has discarded that credential; connect again to pair a new device, which reads this source's Gateway secret one more time.`,
    };
  }

  /**
   * Present the same device again at a different scope.
   *
   * Scope is settled during the handshake, so changing it means cycling the
   * socket. The client instance is reused deliberately and this is the whole
   * distinction between an upgrade and a new device: it keeps the device
   * keypair the Gateway knows. A narrowing presents the persisted token; an
   * explicit widening presents the source-owned issuer secret long enough to
   * receive a replacement scoped token. The identity travels on the config,
   * so either route is still the same source-visible device.
   *
   * What the cycle does cost is the Gateway-side stream, which belongs to the
   * socket rather than to the device. It is asked for again here rather than
   * left for the next reconnect to repair.
   */
  private async renegotiate(
    client: ConnectedGatewayClient,
    config: OCClientConfig,
    authority: SourceAuthority
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        sentence: string | null;
        refusal: 'approval-required' | 'refused';
      }
  > {
    config.scopes = [...SCOPES_FOR_AUTHORITY[authority]];
    try {
      client.disconnect();
    } catch {
      // A socket that will not close cleanly must not stop the reconnect that
      // is the point of this call.
    }
    const opened = await this.openHandshake(client);
    if (opened.ok) {
      /*
       * A new socket carries no subscription, so the stream has to be asked
       * for again. The moment is the reason this is not optional: this runs
       * when the source has just granted the operator a voice, so the very
       * next thing they do is send a message, and a stream nobody re-asked
       * for would leave their first reply to appear on the next authoritative
       * read. Asked again, never resumed: the Gateway replays nothing.
       */
      await this.followConversations();
      return { ok: true };
    }
    return {
      ok: false,
      sentence: opened.sentence,
      refusal: classifyAuthorityRefusal(opened.sentence ?? ''),
    };
  }

  /**
   * What the Gateway granted on a handshake that completed.
   *
   * A completed handshake is the grant: verified live 2026-08-18, a Gateway
   * refuses the handshake outright when a device asks for more scope than its
   * record approves, by either credential route. So the requested authority is
   * the ceiling and the floor unless the Gateway itself reports otherwise,
   * and a report can only narrow.
   */
  private grantedFrom(
    client: ConnectedGatewayClient,
    requested: SourceAuthority
  ): SourceAuthority {
    const reported = client.grantedScopes;
    if (!Array.isArray(reported) || reported.length === 0) return requested;
    const scopes = reported.filter(
      (scope): scope is string => typeof scope === 'string'
    );
    return narrowerAuthority(requested, authorityForGrantedScopes(scopes));
  }

  /** Record a change in granted authority, in memory and on disk. */
  private applyGrantedAuthority(next: SourceAuthority): void {
    if (this.grantedAuthority === next) return;
    this.grantedAuthority = next;
    /*
     * A failed write means the record is missing or unreadable, in which case
     * there is no configured source left to hold authority on. The field above
     * is what this session's write surface obeys either way, so the gate never
     * depends on the disk answering.
     */
    this.deps.store.setGrantedAuthority(this.record.id, next);
  }

  /**
   * One authoritative observation: `agents.list`, then `sessions.list` per
   * configured Agent, plus `cron.list` and `status`. The result replaces the
   * cached topology outright.
   */
  private async discover(announcePhase = true): Promise<SnapshotResult> {
    if (announcePhase) this.setPhase('discovering');
    const observedAt = this.deps.now();

    let agentsList: unknown;
    const sessionLists: { nativeAgentId: string; payload: unknown }[] = [];
    let cronList: unknown;
    let statusPayload: unknown;
    try {
      agentsList = await this.callGateway('agents.list');
      for (const nativeAgentId of readNativeAgentIds(agentsList)) {
        sessionLists.push({
          nativeAgentId,
          payload: await this.callGateway('sessions.list', {
            agentId: nativeAgentId,
          }),
        });
      }
      cronList = await this.callGateway('cron.list');
      statusPayload = await this.callGateway('status');
    } catch (error) {
      return {
        ok: false,
        outcome: 'failed',
        failure: 'gateway-down',
        message: describeSourceError(
          error,
          'The Gateway stopped answering reads.'
        ),
      };
    }

    const adapted = adaptOpenClawTopology({
      configuredSourceId: this.record.id,
      /*
       * Exawatt's own stable handle for this Gateway. The server's hostname,
       * alias, and endpoint are connection material and must never enter a
       * snapshot that later crosses toward the renderer.
       */
      gatewayId: this.record.id,
      placement: this.record.placement,
      /*
       * Both come from the configured source rather than from this call site.
       * A Demo source runs this same path, and a snapshot that asserted
       * `observed` and `openclaw` over it would let simulated evidence wear a
       * live adapter's name.
       */
      adapterId: this.record.adapterId,
      evidenceBasis: evidenceBasisForAdapter(this.record.adapterId),
      observedAt,
      agentsList,
      sessionLists,
      /*
       * The evidence discovery just paid for. Without these the kernel cannot
       * derive a failing automation or a run's outcome, so a coworker whose
       * work is erroring reads as idle: the reads happened and the answers
       * were thrown away.
       */
      cronList,
      statusPayload,
    });
    if (!adapted.ok) {
      return {
        ok: false,
        outcome: 'failed',
        failure: 'incompatible',
        message: 'The Gateway returned a topology Exawatt cannot read.',
      };
    }

    const version = readGatewayVersion(statusPayload);
    const observedIdentity = gatewayIdentityOf(adapted.snapshot, version);

    if (
      this.lastIdentity !== null &&
      gatewayIdentityDrifted(this.lastIdentity, observedIdentity)
    ) {
      /*
       * Report, do not resolve. The last-known snapshot and identity are kept
       * so the operator sees the old mapping beside the newly observed source
       * identity and chooses to remap or detach; nothing here rebinds the
       * projection, and nothing here guesses by display name.
       */
      this.drift = { previous: this.lastIdentity, observed: observedIdentity };
      this.clearObservationTimers();
      this.retrying = false;
      this.setPhase('failed');
      return {
        ok: false,
        outcome: 'identity-drift',
        drift: this.drift,
        message:
          'This source now reports a different set of configured Agents than the one Exawatt is mapped to.',
      };
    }

    // Replacement, never a merge: the cached tree is dropped whole.
    this.lastSnapshot = adapted.snapshot;
    this.lastIdentity = observedIdentity;
    this.lastFacts = {
      version,
      configuredAgentCount: observedIdentity.nativeAgentIds.length,
      automationCount: countAutomations(cronList),
      observedAt,
    };
    this.lastObservedAt = observedAt;
    this.drift = null;
    for (const listener of [...this.snapshotListeners]) {
      try {
        listener();
      } catch {
        // Observation is already committed; one consumer cannot undo it.
      }
    }

    return {
      ok: true,
      outcome: 'connected',
      snapshot: adapted.snapshot,
      identity: observedIdentity,
      facts: this.lastFacts,
      issues: adapted.issues,
    };
  }

  /**
   * The read call path. Every read in this file goes through here.
   *
   * The source-side scope grant is the real enforcement; this allowlist is the
   * local guard that stops a typo or a future edit from ever forming a wider
   * request in the first place.
   */
  private async callGateway<R>(method: string, params?: unknown): Promise<R> {
    if (!isH1ReadMethod(method)) {
      throw new Error(
        `Refusing "${method}": ENG-010 H1 is read-only and allows only ${H1_READ_METHODS.join(', ')}.`
      );
    }
    return this.dispatch<R>(method, params);
  }

  /**
   * The write call path, and the second lock on the same reasoning as the
   * read one. The scopes on the device record are what actually stops a write
   * Exawatt was never granted; this allowlist plus the granted-authority gate
   * stop Exawatt from forming that request at all, so a surface that ran ahead
   * of an approval fails here with a sentence about the approval instead of
   * reaching the server and coming back with a protocol error.
   */
  private async callGatewayWrite<R>(
    method: string,
    params?: unknown
  ): Promise<R> {
    if (!isH2WriteMethod(method)) {
      throw new Error(
        `Refusing "${method}": the write surface allows only ${H2_WRITE_METHODS.join(', ')}.`
      );
    }
    if (this.grantedAuthority !== 'write') {
      throw new Error(
        `Refusing "${method}": this source has granted Exawatt read access only. Request write access and approve the Exawatt device on the source first.`
      );
    }
    return this.dispatch<R>(method, params);
  }

  /**
   * The one place a method name reaches the client, whichever tier sent it.
   *
   * The parameter is the allowlist union rather than `string`, so the compiler
   * is what proves no caller reached the client around a guard. Widening it
   * back to `string` is the edit that would silently undo both allowlists.
   */
  private async dispatch<R>(
    method: H1ReadMethod | H2WriteMethod,
    params?: unknown
  ): Promise<R> {
    const client = this.client;
    if (!client) {
      throw new Error('No Gateway connection is open for this source.');
    }
    return client.call<R>(method, params ?? {});
  }

  // ---- Reconnect ---------------------------------------------------------

  /**
   * Watch whatever connection is open right now.
   *
   * Always the current tunnel and the current client, never "the first one
   * that turned up": any watch left from an earlier connection is released
   * first, and each new watch checks that the handle it fired for is still
   * the one this session holds. The earlier version refused to attach while
   * its handles were set, so a second connect left the socket actually
   * carrying traffic unwatched and the session reported Live through a drop
   * it could not see.
   */
  private watchForDrops(): void {
    this.stopWatching();

    const tunnel = this.tunnel;
    if (tunnel) {
      this.stopWatchingTunnel = tunnel.onClosed(failure => {
        if (this.tunnel !== tunnel) return;
        this.handleDrop(
          failure === null
            ? null
            : TUNNEL_FAILURE_TO_SOURCE_FAILURE[failure.class]
        );
      });
    }

    const client = this.client;
    if (client) {
      const handler = (status: string): void => {
        if (this.client !== client) return;
        if (status === 'disconnected' || status === 'error') {
          this.handleDrop(status === 'error' ? 'gateway-down' : null);
        }
      };
      client.on('connection:status', handler);
      this.stopWatchingClient = () => {
        client.off('connection:status', handler);
      };
    }
  }

  /**
   * Stop watching. Safe to call twice, and it releases each watch through the
   * handle that created it, so a watch is never removed from an object it was
   * not attached to.
   */
  private stopWatching(): void {
    const stopTunnel = this.stopWatchingTunnel;
    this.stopWatchingTunnel = null;
    stopTunnel?.();

    const stopClient = this.stopWatchingClient;
    this.stopWatchingClient = null;
    stopClient?.();
  }

  /** Put every carried subscription on the connection that is current now. */
  private attachSubscriptions(client: ConnectedGatewayClient): void {
    if (this.subscribedClient !== null) {
      this.detachSubscriptions();
    }
    this.subscribedClient = client;
    client.onOCEvent('presence', this.topologyInvalidated);
    for (const subscription of [...this.subscriptions]) {
      client.onOCEvent(subscription.eventName, subscription.handler);
    }
  }

  /**
   * Take them off again. The subscriptions themselves survive: the caller's
   * interest outlives one socket, and the next connection re-establishes them.
   */
  private detachSubscriptions(): void {
    const client = this.subscribedClient;
    this.subscribedClient = null;
    if (!client) return;
    client.offOCEvent('presence', this.topologyInvalidated);
    for (const subscription of [...this.subscriptions]) {
      client.offOCEvent(subscription.eventName, subscription.handler);
    }
  }

  /**
   * An unexpected drop. The last-known snapshot is retained and the
   * presentation is marked stale; nothing here concludes that remote work
   * stopped, paused, or ended, because a lost connection is evidence about
   * Exawatt's observation and about nothing else.
   */
  private handleDrop(failure: SourceFailureClass | null): void {
    if (this.detached || this.tearingDown || this.renegotiating) return;
    if (this.currentPhase === 'reconnecting') return;

    this.transportUp = false;
    this.clearObservationTimers();
    this.retrying = true;
    this.terminalFailure = failure;
    this.setPhase('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.detached) return;
    if (this.reconnectTimer !== null) return;
    const exhaustedFastLadder =
      this.reconnectAttempts >= this.maxReconnectAttempts;
    const delay = exhaustedFastLadder
      ? LONG_OUTAGE_RETRY_DELAY_MS
      : Math.min(
          RECONNECT_MAX_DELAY_MS,
          RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts
        );
    if (!exhaustedFastLadder) this.reconnectAttempts += 1;
    this.reconnectTimer = this.deps.setTimer(() => {
      this.reconnectTimer = null;
      void this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.detached) return;
    await this.teardownConnection();
    if (this.detached) return;

    const result = await this.establish();
    if (result.ok) {
      this.reconnectAttempts = 0;
      return;
    }
    if (this.detached) return;
    if (result.outcome === 'identity-drift') {
      // Drift is not a transport fault, so retrying cannot fix it. The session
      // stops and the operator decides.
      this.retrying = false;
      return;
    }
    if (!retryableConnectionFailure(result.failure)) {
      /*
       * A credential the source refused, an SSH login it rejected, or a
       * secret it no longer publishes. None of them is an outage, so none of
       * them is repaired by asking again on a timer. The credential case is
       * the one that must not loop: the stored credential has just been
       * discarded, so the next attempt would pair a NEW device on the
       * operator's server and read the admin-capable shared secret again.
       * That is the posture this whole model exists to avoid holding, so it
       * happens when the operator connects, not when a timer fires.
       */
      this.retrying = false;
      this.setPhase('failed');
      return;
    }
    this.retrying = true;
    this.setPhase('reconnecting');
    this.scheduleReconnect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.deps.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Close whatever is open. Safe to call twice: each handle is nulled before it
   * is closed, so a second pass has nothing to close and `close()` is never
   * called twice on the same tunnel.
   */
  private async teardownConnection(): Promise<void> {
    this.tearingDown = true;
    try {
      this.clearObservationTimers();
      this.stopWatching();
      this.detachSubscriptions();

      const client = this.client;
      this.client = null;
      this.clientConfig = null;
      try {
        client?.disconnect();
      } catch {
        // A client that cannot be closed cleanly must not block the tunnel
        // close below, which is what actually releases the operator's server.
      }

      const tunnel = this.tunnel;
      this.tunnel = null;
      if (tunnel) {
        try {
          await tunnel.close();
        } catch {
          // The tunnel owner already bounds and force-kills its own child.
        }
      }

      this.transportUp = false;
      this.pendingBootstrapFacts = null;
    } finally {
      this.tearingDown = false;
    }
  }

  private setPhase(phase: ConnectedGatewayPhase): void {
    if (this.currentPhase === phase) return;
    this.currentPhase = phase;
    for (const listener of [...this.phaseListeners]) {
      try {
        listener(phase);
      } catch {
        // One bad observer must not stop the others or the lifecycle itself.
      }
    }
  }
}
