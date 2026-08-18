import {
  adaptOpenClawTopology,
  resolveConnectionStatus,
  type AgentSourceTopologySnapshot,
  type ConnectedSourceRecord,
  type ConnectionStatus,
  type OCClientConfig,
  type OCGatewayClient,
  type OCGatewayOperatorScope,
  type OpenClawTopologyIssue,
  type SourceFailureClass,
  type SourceTransport,
} from '@exawatt/core';
import type { ConnectedSourceStore } from './connected-source-store';
import type {
  GatewayBootstrapFailure,
  RemoteExec,
  resolveGatewayCredential,
} from './gateway-bootstrap';
import type {
  openSshTunnel,
  SshTunnel,
  SshTunnelFailureClass,
  SshTunnelTarget,
} from './ssh-tunnel';

/**
 * ENG-010 C1: one configured source's whole read-only lifecycle.
 *
 * A `ConnectedGatewaySession` owns everything between "the operator saved this
 * source" and "Exawatt holds an authoritative topology snapshot for it":
 * transport, credential custody, pairing, discovery, freshness, reconnect, and
 * detach. It owns no UI, no projection policy, and no remote authority.
 *
 * Four rules shape every decision in this file.
 *
 * 1. **H1 is read-only, and the source enforces it.** The session requests
 *    exactly `operator.read` on connect, so the Gateway itself refuses a write
 *    even if Exawatt asks for one. The local method allowlist below is the
 *    second lock, not the first: it stops a typo or a future edit from ever
 *    forming the request. See `H1_READ_METHODS`.
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
 */

/**
 * Exactly the scopes H1 needs. This is the real read-only enforcement: the
 * Gateway stores the requested scopes on the device record, so a device paired
 * here cannot send, steer, abort, or mutate a schedule no matter what Exawatt
 * later asks.
 */
export const H1_READ_SCOPES = ['operator.read'] as const;

/** Every Gateway method H1 is allowed to call. */
export const H1_READ_METHODS = [
  'health',
  'status',
  'agents.list',
  'sessions.list',
  'chat.history',
  'cron.list',
  'cron.runs',
  'tasks.list',
] as const;

export type H1ReadMethod = (typeof H1_READ_METHODS)[number];

/*
 * A Set so the guard is a cheap lookup on an untrusted string, built from the
 * exported tuple so the runtime check cannot drift from the union.
 */
const H1_READ_METHOD_SET: ReadonlySet<string> = new Set(H1_READ_METHODS);

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
 * Gateway identity, as observed. Only the source's own version string and its
 * configured native Agent ids: display names are never part of identity,
 * because renaming a coworker on the source must not read as a different
 * installation, and two installations may legitimately use the same names.
 */
export interface GatewayIdentity {
  /** The source's reported version, or '' when it declared none. */
  version: string;
  /** Sorted configured native Agent ids. */
  nativeAgentIds: readonly string[];
}

export interface GatewayIdentityDrift {
  previous: GatewayIdentity;
  observed: GatewayIdentity;
}

/**
 * Bounded facts observed alongside the snapshot. Deliberately counts and one
 * version string rather than retained `cron.list`/`status` payloads: those
 * carry workspace paths and schedules that belong to a later projection step,
 * and holding them here would put remote data in a transport object with no
 * contract for it.
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
  getStatus(): string;
  /**
   * The device token in play. Set before `connect()` to present a persisted
   * one; read after `connect()` to pick up a freshly issued one.
   */
  deviceToken?: string | null;
};

export interface ConnectedGatewaySessionDeps {
  store: Pick<
    ConnectedSourceStore,
    'readDeviceToken' | 'writeDeviceToken' | 'clearDeviceToken'
  >;
  openTunnel: typeof openSshTunnel;
  resolveCredential: typeof resolveGatewayCredential;
  remoteExec: RemoteExec;
  createClient: (config: OCClientConfig) => ConnectedGatewayClient;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  maxReconnectAttempts?: number;
}

/**
 * Transport failures classified by the tunnel owner, translated into the
 * product's own failure vocabulary. Exported so the mapping is one table a test
 * can read rather than a switch buried in a private method.
 *
 * `invalid-target` becomes `unknown` on purpose: it is a configuration fault on
 * this machine, not an observation about the server, and calling it
 * `host-unreachable` would send the operator to check a network that is fine.
 */
export const TUNNEL_FAILURE_TO_SOURCE_FAILURE: Readonly<
  Record<SshTunnelFailureClass, SourceFailureClass>
> = {
  'invalid-target': 'unknown',
  'host-unreachable': 'host-unreachable',
  'auth-rejected': 'auth-rejected',
  'gateway-down': 'gateway-down',
  unknown: 'unknown',
};

/**
 * Bootstrap failures translated the same way.
 *
 * `openclaw-missing` is `gateway-down`: the login worked and nothing is serving
 * a Gateway there. `token-unavailable` is `auth-rejected`: the source declares
 * no shared secret, so Exawatt has no credential to present, and the operator
 * resolves it the same way as any other credential problem (the documented
 * paste-a-token fallback). `unreadable-config` stays `unknown` rather than
 * guessing which of several causes applied.
 */
export const BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE: Readonly<
  Record<GatewayBootstrapFailure, SourceFailureClass>
> = {
  'invalid-target': 'unknown',
  unreachable: 'host-unreachable',
  'auth-rejected': 'auth-rejected',
  'openclaw-missing': 'gateway-down',
  'token-unavailable': 'auth-rejected',
  'unreadable-config': 'unknown',
  unknown: 'unknown',
};

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
/** No configuration may turn the ladder into an unbounded retry loop. */
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
const MAX_ID_LENGTH = 4_096;
const MAX_LABEL_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
      return value.trim().slice(0, MAX_LABEL_LENGTH);
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

function identityOf(
  snapshot: AgentSourceTopologySnapshot,
  version: string
): GatewayIdentity {
  return {
    version,
    nativeAgentIds: snapshot.agents
      .filter(agent => agent.discoveryState === 'configured')
      .map(agent => agent.nativeAgentId)
      .sort(),
  };
}

/**
 * Is the Gateway behind this source a different installation than the one the
 * projection was bound to?
 *
 * The brief leaves the threshold to the implementation, and the two candidate
 * signals mean different things:
 *
 * - A changed **version** is an ordinary upgrade. Treating it as drift would
 *   ask the operator to remap every time they update OpenClaw, which trains
 *   them to dismiss the one prompt that matters. It is carried in the reported
 *   identity so the operator sees it, but it never decides on its own.
 * - A changed **roster** is ordinary source-side work: Agents get added and
 *   retired, and the authoritative resnapshot already replaces the old tree.
 *
 * What no ordinary change explains is a roster with *nothing* in common with
 * the one Exawatt was observing. That is a different installation wearing the
 * same alias, and rebinding to it would silently move the operator's coworkers
 * onto a machine they never connected. So drift is disjointness, and the
 * session only reports it: remap or detach is the operator's decision.
 */
function isIdentityDrift(
  previous: GatewayIdentity,
  observed: GatewayIdentity
): boolean {
  if (previous.nativeAgentIds.length === 0) return false;
  if (observed.nativeAgentIds.length === 0) return true;
  const known = new Set(previous.nativeAgentIds);
  return !observed.nativeAgentIds.some(id => known.has(id));
}

export class ConnectedGatewaySession {
  private readonly record: ConnectedSourceRecord;
  private readonly deps: ConnectedGatewaySessionDeps;
  private readonly maxReconnectAttempts: number;

  private currentPhase: ConnectedGatewayPhase = 'idle';
  private readonly phaseListeners = new Set<
    (phase: ConnectedGatewayPhase) => void
  >();

  private tunnel: SshTunnel | null = null;
  private stopWatchingTunnel: (() => void) | null = null;
  private client: ConnectedGatewayClient | null = null;
  private clientStatusHandler: ((status: string) => void) | null = null;

  /** Last authoritative snapshot. Retained across a drop, never merged into. */
  private lastSnapshot: AgentSourceTopologySnapshot | null = null;
  private lastIdentity: GatewayIdentity | null = null;
  private lastFacts: ObservedGatewayFacts | null = null;
  private lastObservedAt: number | null = null;

  private transportUp = false;
  private retrying = false;
  private terminalFailure: SourceFailureClass | null = null;
  private drift: GatewayIdentityDrift | null = null;

  private reconnectTimer: unknown = null;
  private reconnectAttempts = 0;
  /** Set while this session is deliberately tearing a connection down. */
  private tearingDown = false;
  /** Set by `disconnect()`; cleared by a later `connect()`. */
  private detached = false;

  constructor(
    record: ConnectedSourceRecord,
    deps: ConnectedGatewaySessionDeps
  ) {
    this.record = record;
    this.deps = deps;
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

  onPhaseChange(listener: (phase: ConnectedGatewayPhase) => void): () => void {
    this.phaseListeners.add(listener);
    return () => {
      this.phaseListeners.delete(listener);
    };
  }

  async connect(): Promise<ConnectResult> {
    this.detached = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.retrying = false;
    const result = await this.establish();
    if (!result.ok) {
      // An operator-initiated connect reports its failure rather than starting
      // the retry ladder. The ladder exists for a connection that was working
      // and was lost; a first attempt that fails is an answer, not an outage.
      this.setPhase('failed');
    }
    return result;
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
    const result = await this.discover();
    if (result.ok) this.setPhase('connected');
    return result;
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
    this.setPhase('connected');
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
    const opened = await this.deps.openTunnel(tunnelTargetFor(transport));
    if (!opened.ok) {
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
   * The steady state is the first branch: a device token already exists, so
   * bootstrap never runs again. Bootstrap is a once-ever step, and re-reading
   * the source's admin-capable shared secret on every launch would be a
   * strictly worse posture than holding a read-only, per-device, revocable
   * token.
   */
  private async resolveCredential(): Promise<
    | { ok: true; deviceToken: string | null; sharedSecret: string | null }
    | { ok: false; failure: SourceFailureClass; message: string }
  > {
    const stored = this.deps.store.readDeviceToken(this.record.id);
    if (typeof stored === 'string' && stored.length > 0) {
      return { ok: true, deviceToken: stored, sharedSecret: null };
    }

    this.setPhase('bootstrapping');
    /*
     * One seam for every transport. It reads the source's own configuration
     * over SSH for a server, and on this machine for the operator's own
     * Gateway, which has no alias because it has no hop.
     */
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
    return {
      ok: true,
      deviceToken: null,
      sharedSecret: result.facts.sharedToken,
    };
  }

  /**
   * Pair Exawatt's own device identity at exactly `operator.read`.
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
    credential: { deviceToken: string | null; sharedSecret: string | null }
  ): Promise<
    { ok: true } | { ok: false; failure: SourceFailureClass; message: string }
  > {
    this.setPhase('pairing');

    let sharedSecret: string | null = credential.sharedSecret;
    const scopes: readonly OCGatewayOperatorScope[] = [...H1_READ_SCOPES];
    const config: OCClientConfig = {
      url: `ws://${LOOPBACK_HOST}:${port}`,
      scopes,
      ...describeExawattClient(),
    };
    if (sharedSecret !== null) {
      config.token = sharedSecret;
    }

    const client = this.deps.createClient(config);
    this.client = client;
    if (credential.deviceToken !== null) {
      client.deviceToken = credential.deviceToken;
    }

    try {
      await client.connect();
    } catch (error) {
      sharedSecret = null;
      config.token = undefined;
      return {
        ok: false,
        failure: 'gateway-down',
        message: messageOf(error, 'The Gateway refused the connection.'),
      };
    }

    const issued =
      typeof client.deviceToken === 'string' && client.deviceToken.length > 0
        ? client.deviceToken
        : null;

    if (issued !== null && issued !== credential.deviceToken) {
      const written = this.deps.store.writeDeviceToken(this.record.id, issued);
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

    return { ok: true };
  }

  /**
   * One authoritative observation: `agents.list`, then `sessions.list` per
   * configured Agent, plus `cron.list` and `status`. The result replaces the
   * cached topology outright.
   */
  private async discover(): Promise<SnapshotResult> {
    this.setPhase('discovering');
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
        message: messageOf(error, 'The Gateway stopped answering reads.'),
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
      evidenceBasis: 'observed',
      observedAt,
      agentsList,
      sessionLists,
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
    const observedIdentity = identityOf(adapted.snapshot, version);

    if (
      this.lastIdentity !== null &&
      isIdentityDrift(this.lastIdentity, observedIdentity)
    ) {
      /*
       * Report, do not resolve. The last-known snapshot and identity are kept
       * so the operator sees the old mapping beside the newly observed source
       * identity and chooses to remap or detach; nothing here rebinds the
       * projection, and nothing here guesses by display name.
       */
      this.drift = { previous: this.lastIdentity, observed: observedIdentity };
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
   * The single gateway call path. Every read in this file goes through here.
   *
   * The source-side scope grant is the real read-only enforcement; this
   * allowlist is the local guard that stops a typo or a future edit from ever
   * forming a write request in the first place.
   */
  private async callGateway<R>(method: string, params?: unknown): Promise<R> {
    if (!H1_READ_METHOD_SET.has(method)) {
      throw new Error(
        `Refusing "${method}": ENG-010 H1 is read-only and allows only ${H1_READ_METHODS.join(', ')}.`
      );
    }
    const client = this.client;
    if (!client) {
      throw new Error('No Gateway connection is open for this source.');
    }
    return client.call<R>(method, params ?? {});
  }

  // ---- Reconnect ---------------------------------------------------------

  private watchForDrops(): void {
    const tunnel = this.tunnel;
    if (tunnel && !this.stopWatchingTunnel) {
      this.stopWatchingTunnel = tunnel.onClosed(failure => {
        this.handleDrop(
          failure === null
            ? null
            : TUNNEL_FAILURE_TO_SOURCE_FAILURE[failure.class]
        );
      });
    }

    const client = this.client;
    if (client && !this.clientStatusHandler) {
      const handler = (status: string): void => {
        if (status === 'disconnected' || status === 'error') {
          this.handleDrop(status === 'error' ? 'gateway-down' : null);
        }
      };
      this.clientStatusHandler = handler;
      client.on('connection:status', handler);
    }
  }

  /**
   * An unexpected drop. The last-known snapshot is retained and the
   * presentation is marked stale; nothing here concludes that remote work
   * stopped, paused, or ended, because a lost connection is evidence about
   * Exawatt's observation and about nothing else.
   */
  private handleDrop(failure: SourceFailureClass | null): void {
    if (this.detached || this.tearingDown) return;
    if (this.currentPhase === 'reconnecting') return;

    this.transportUp = false;
    this.retrying = true;
    this.terminalFailure = failure;
    this.setPhase('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.detached) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Bounded: the ladder gives up rather than retrying forever. The cached
      // snapshot stays, still last-known and still never "stopped".
      this.retrying = false;
      this.setPhase('failed');
      return;
    }
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts
    );
    this.reconnectAttempts += 1;
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
      const stopWatching = this.stopWatchingTunnel;
      this.stopWatchingTunnel = null;
      stopWatching?.();

      const client = this.client;
      const statusHandler = this.clientStatusHandler;
      this.client = null;
      this.clientStatusHandler = null;
      if (client && statusHandler) {
        client.off('connection:status', statusHandler);
      }
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

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, MAX_LABEL_LENGTH);
  }
  return fallback;
}
