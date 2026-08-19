import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  describeConnectionStatus,
  type ConnectedSourceRecord,
  type OCClientConfig,
  type OCDeviceKeypair,
  type SourceAuthority,
  type SourceFailureClass,
} from '@exawatt/core';
import {
  H1_READ_METHODS,
  H1_READ_SCOPES,
  H2_WRITE_METHODS,
  H2_WRITE_SCOPES,
  SCOPES_FOR_AUTHORITY,
} from './connected-gateway-authority';
import {
  BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE,
  TUNNEL_FAILURE_TO_SOURCE_FAILURE,
} from './connected-source-failure';
import {
  ConnectedGatewaySession,
  RECONNECT_BASE_DELAY_MS,
  evidenceBasisForAdapter,
  type ConnectedGatewayClient,
  type ConnectedGatewayPhase,
  type ConnectedGatewaySessionDeps,
} from './connected-gateway';
import type { GatewayIdentity } from './gateway-identity';
import type {
  GatewayBootstrapFailure,
  resolveGatewayCredential,
} from './gateway-bootstrap';
import type {
  openSshTunnel,
  SshTunnel,
  SshTunnelFailure,
  SshTunnelFailureClass,
} from './ssh-tunnel';

/**
 * Contract tests for one configured source's read-only lifecycle (ENG-010 C1).
 *
 * Every dependency is injected, so nothing here opens a socket, spawns `ssh`,
 * or touches a keychain. Every identifier below is invented: this repository is
 * public, and a fixture that carried a real alias, host, agent name, or token
 * would publish infrastructure the product exists to keep private.
 *
 * Timing is injected too. The reconnect ladder is driven by a fake timer the
 * test fires by hand, so no assertion measures elapsed wall clock and no test
 * awaits a sleep; each one waits for the effect it cares about.
 */

const SOURCE_ID = 'src-northwind-01';
const ALIAS = 'workshop-north';
const REMOTE_PORT = 4501;
const LOCAL_PORT = 45_017;
const LOOPBACK_PORT = 4599;

/** Invented server access for the manual transport. Never a real server. */
const MANUAL_HOST = 'workshop-south.invalid';
const MANUAL_USER = 'workshop';
const MANUAL_SSH_PORT = 2202;
const MANUAL_KEY_PATH = '/home/workshop/keys/id_fixture';

/** Invented. Never a real credential, and never persisted by the session. */
const SHARED_SECRET = 'shared-secret-fixture-9f2c';
const DEVICE_TOKEN = 'device-token-fixture-4b71';

const AGENT_QUILL = 'agent-quill';
const AGENT_LUMEN = 'agent-lumen';
const AGENT_TESSERA = 'agent-tessera';

/** Invented. The source's own name for the one automation it schedules. */
const AUTOMATION_NAME = 'nightly-sweep';

const FIXED_NOW = 1_760_000_000_000;

/** Invented device material, in the encodings the Gateway parses. */
let mintedKeys = 0;
function mintKeypair(): OCDeviceKeypair {
  const seed = `fixture-device-${++mintedKeys}`;
  const publicKey = createHash('sha256').update(seed).digest('base64url');
  return {
    privateKey: createHash('sha256').update(`${seed}-secret`).digest('hex'),
    publicKey,
  };
}

/**
 * The device id a Gateway derives from a public key: SHA-256 over the raw key
 * bytes. Written the Gateway's way rather than the client's so a test cannot
 * agree with an implementation that is wrong in the same direction.
 */
function deviceIdOf(keypair: OCDeviceKeypair): string {
  return createHash('sha256')
    .update(Buffer.from(keypair.publicKey, 'base64url'))
    .digest('hex');
}

/** The identity a saved source paired with, as a relaunch reads it back. */
const SAVED_KEYPAIR = mintKeypair();

/** Words the product may never use about work it merely stopped watching. */
const STOPPED_WORK_WORDS = /stopped|paused|ended|halted|finished|terminated/iu;

// ---- Fake source ---------------------------------------------------------

class FakeGateway {
  agentIds: string[] = [AGENT_QUILL, AGENT_LUMEN];
  version = '2026.6.11';
  automationCount = 1;
  /** How the source says that automation last ended. Evidence, not a guess. */
  automationOutcome = 'failed';
  /** Source-wide task totals, exactly as `status` reports them. */
  taskTotals: Record<string, number> = {
    total: 3,
    active: 1,
    terminal: 2,
    failures: 1,
  };
  /** Methods the fake was asked for, in order. */
  readonly received: { method: string; params: unknown }[] = [];

  /**
   * Scopes this source has approved for Exawatt's device. Null until the
   * device is known, which is what makes the first pairing the silent one.
   */
  approvedScopes: string[] | null = null;
  /** Scopes presented on each handshake, in order. */
  readonly handshakes: string[][] = [];
  /** The device id presented on each handshake, in order. */
  readonly deviceIds: string[] = [];
  /**
   * Which device each issued token belongs to.
   *
   * This is the rule the live run found and no fixture modelled: a Gateway
   * derives the device id from the public key on the handshake and refuses a
   * token it issued to some other device. A token this fake has never issued
   * is accepted and bound to whoever presents it, so a test may seed a saved
   * credential without having watched it be issued.
   */
  private readonly tokenOwners = new Map<string, string>();
  /** Errors to answer the next handshakes with, consumed one per attempt. */
  private readonly handshakeErrors: string[] = [];

  /**
   * The server half of pairing, modelled on a live Gateway probed 2026-08-18.
   *
   * A device the source has never seen is approved silently for exactly what
   * it asks, and its record then pins those scopes. A device the source
   * already knows may reconnect asking for the same scopes or fewer; asking
   * for more is refused and the approved scopes are unchanged, whichever
   * credential it presents. Exawatt cannot approve itself, so this fake has no
   * path by which a client raises its own approval.
   */
  pair(
    requested: readonly string[],
    deviceToken: string | null,
    deviceId: string
  ): { ok: true } | { ok: false; message: string } {
    this.handshakes.push([...requested]);
    this.deviceIds.push(deviceId);
    const scripted = this.handshakeErrors.shift();
    if (scripted !== undefined) return { ok: false, message: scripted };

    const owner =
      deviceToken === null ? undefined : this.tokenOwners.get(deviceToken);
    if (owner !== undefined && owner !== deviceId) {
      // Verbatim from a live Gateway, 2026-08-18.
      return {
        ok: false,
        message:
          'unauthorized: device token mismatch (rotate/reissue device token)',
      };
    }

    if (this.approvedScopes === null || deviceToken === null) {
      this.approvedScopes = [...requested];
      return { ok: true };
    }
    const approved = new Set(this.approvedScopes);
    if (requested.every(scope => approved.has(scope))) return { ok: true };
    return {
      ok: false,
      message:
        'NOT_PAIRED: pairing required: device is asking for more scopes than currently approved',
    };
  }

  /** The operator approving the Exawatt device on the source itself. */
  approve(scopes: readonly string[]): void {
    this.approvedScopes = [...scopes];
  }

  /** A scoped token, bound to the device it was issued to. */
  issueToken(token: string, deviceId: string): void {
    this.tokenOwners.set(token, deviceId);
  }

  /** Script the next handshakes to fail, one message per attempt. */
  failHandshakes(...messages: string[]): void {
    this.handshakeErrors.push(...messages);
  }

  respond(method: string, params: unknown): unknown {
    this.received.push({ method, params });
    switch (method) {
      case 'agents.list':
        return {
          agents: this.agentIds.map(id => ({
            id,
            name: `${id}-configured-name`,
            // Fields the adapter must ignore rather than copy.
            workspace: '/invented/not/read',
            model: 'invented-model',
          })),
        };
      case 'sessions.list': {
        const agentId = (params as { agentId?: string } | undefined)?.agentId;
        if (typeof agentId !== 'string') return { sessions: [] };
        return {
          sessions: [
            {
              key: `agent:${agentId}:main`,
              kind: 'direct',
              sessionId: `${agentId}-main-run`,
              createdAt: 1_759_000_000_000,
              updatedAt: 1_759_900_000_000,
            },
            {
              key: `agent:${agentId}:cron:sweep`,
              kind: 'direct',
              createdAt: 1_759_100_000_000,
              updatedAt: 1_759_800_000_000,
            },
          ],
        };
      }
      case 'cron.list':
        return {
          jobs: Array.from({ length: this.automationCount }, (_, index) => ({
            id: `job-${index}`,
            name: `${AUTOMATION_NAME}-${index}`,
            agentId: this.agentIds[0] ?? AGENT_QUILL,
            enabled: true,
            state: {
              lastStatus: this.automationOutcome,
              lastRunAtMs: FIXED_NOW - 60_000,
            },
          })),
        };
      case 'status':
        return {
          version: this.version,
          sessions: this.agentIds.length,
          tasks: this.taskTotals,
        };
      case 'health':
        return { ok: true };
      case 'sessions.messages.subscribe':
      case 'sessions.messages.unsubscribe':
        return { ok: true };
      case 'chat.send':
      case 'chat.abort':
      case 'sessions.steer':
      case 'tasks.cancel':
        /*
         * The source is the real enforcement. A device approved only for
         * reading is refused here even if Exawatt manages to form the request,
         * which is what makes the local allowlist a second lock rather than
         * the only one.
         */
        if (!(this.approvedScopes ?? []).includes('operator.write')) {
          throw new Error('FORBIDDEN: operator.write scope required');
        }
        return { ok: true };
      default:
        throw new Error(`FakeGateway received an unexpected method: ${method}`);
    }
  }
}

class FakeGatewayClient {
  deviceToken: string | null = null;
  /** Scopes this client reports the Gateway granted, when it reports any. */
  grantedScopes: readonly string[] | null = null;
  disconnectCount = 0;
  presentedToken: string | null = null;
  /**
   * The identity this client presents. Supplied by the caller when it keeps
   * one, minted here when it does not, exactly as the real client does; the
   * device id follows from it the way the Gateway derives it.
   */
  readonly deviceKeypair: OCDeviceKeypair;
  readonly deviceKey: string;
  private status = 'disconnected';
  readonly calls: { method: string; params: unknown }[] = [];
  private readonly statusHandlers = new Set<(status: string) => void>();
  private readonly eventHandlers = new Map<
    string,
    Set<(payload: unknown) => void>
  >();

  constructor(
    readonly config: OCClientConfig,
    private readonly gateway: FakeGateway,
    private readonly issueToken: string | null,
    private readonly refuse: boolean,
    private readonly reportGrantedScopes: readonly string[] | null = null
  ) {
    this.deviceKeypair = config.deviceKeypair ?? mintKeypair();
    this.deviceKey = deviceIdOf(this.deviceKeypair);
  }

  async connect(): Promise<void> {
    if (this.refuse) throw new Error('gateway refused the handshake');
    const requested = [...(this.config.scopes ?? [])];
    const paired = this.gateway.pair(
      requested,
      this.deviceToken,
      this.deviceKey
    );
    if (!paired.ok) {
      this.status = 'error';
      throw new Error(paired.message);
    }
    this.presentedToken = this.deviceToken ?? this.config.token ?? null;
    if (this.deviceToken === null && this.issueToken !== null) {
      this.deviceToken = this.issueToken;
      // The Gateway remembers which device it issued this to, which is what
      // makes presenting it from a different device a refusal.
      this.gateway.issueToken(this.issueToken, this.deviceKey);
    }
    this.grantedScopes = this.reportGrantedScopes;
    this.status = 'connected';
  }

  disconnect(): void {
    this.disconnectCount += 1;
    this.status = 'disconnected';
  }

  getStatus(): string {
    return this.status;
  }

  async call<R = unknown>(method: string, params?: unknown): Promise<R> {
    this.calls.push({ method, params });
    return this.gateway.respond(method, params) as R;
  }

  /**
   * The Gateway's own event stream, as a client hands it over. Real handlers
   * rather than a no-op, because whether a subscription is attached to *this*
   * client is exactly what the streaming tests are about.
   */
  onOCEvent(eventName: string, handler: (payload: unknown) => void): void {
    const handlers =
      this.eventHandlers.get(eventName) ?? new Set<(p: unknown) => void>();
    handlers.add(handler);
    this.eventHandlers.set(eventName, handlers);
  }

  offOCEvent(eventName: string, handler: (payload: unknown) => void): void {
    this.eventHandlers.get(eventName)?.delete(handler);
  }

  /** A frame arriving on this client's socket. */
  emitOCEvent(eventName: string, payload: unknown): void {
    for (const handler of [...(this.eventHandlers.get(eventName) ?? [])]) {
      handler(payload);
    }
  }

  /** How many listeners this client is carrying for that event. */
  listenerCount(eventName: string): number {
    return this.eventHandlers.get(eventName)?.size ?? 0;
  }

  on(event: string, handler: (data: never) => void): void {
    if (event === 'connection:status') {
      this.statusHandlers.add(handler as unknown as (s: string) => void);
    }
  }

  off(event: string, handler: (data: never) => void): void {
    this.statusHandlers.delete(handler as unknown as (s: string) => void);
  }

  /** Simulate the socket dropping underneath a healthy session. */
  emitStatus(status: string): void {
    for (const handler of [...this.statusHandlers]) handler(status);
  }
}

interface FakeTunnelHandle {
  tunnel: SshTunnel;
  closeCount: () => number;
  drop: (failure: SshTunnelFailure | null) => void;
}

function createFakeTunnel(localPort = LOCAL_PORT): FakeTunnelHandle {
  const listeners = new Set<(failure: SshTunnelFailure | null) => void>();
  let closed = false;
  let closeCount = 0;
  const tunnel: SshTunnel = {
    localPort,
    get closed() {
      return closed;
    },
    close: async () => {
      closed = true;
      closeCount += 1;
    },
    onClosed: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    tunnel,
    closeCount: () => closeCount,
    drop: failure => {
      closed = true;
      for (const listener of [...listeners]) listener(failure);
    },
  };
}

/**
 * The keychain, as this session sees it.
 *
 * A saved source holds a whole credential, so seeding a token seeds the
 * identity it was issued to as well. That pairing is the fixture's honest
 * shape: a token on its own is not a state a correct pairing can produce, and
 * the one test that wants it constructs it deliberately.
 */
function createFakeStore(initial: Record<string, string> = {}) {
  const tokens = new Map(Object.entries(initial));
  const keypairs = new Map(
    Object.keys(initial).map(id => [id, SAVED_KEYPAIR] as const)
  );
  const writes: { id: string; token: string; keypair: OCDeviceKeypair }[] = [];
  const cleared: string[] = [];
  const authorities: { id: string; authority: SourceAuthority }[] = [];
  let refuseWrites = false;
  return {
    tokens,
    keypairs,
    writes,
    cleared,
    refuseEncryption(): void {
      refuseWrites = true;
    },
    readDeviceToken: vi.fn((id: string) => tokens.get(id) ?? null),
    readDeviceKeypair: vi.fn((id: string) => keypairs.get(id) ?? null),
    writeDeviceCredential: vi.fn(
      (id: string, credential: { token: string; keypair: OCDeviceKeypair }) => {
        writes.push({ id, ...credential });
        if (refuseWrites) {
          return { ok: false, reason: 'encryption-unavailable' } as const;
        }
        tokens.set(id, credential.token);
        keypairs.set(id, credential.keypair);
        return { ok: true } as const;
      }
    ),
    clearDeviceToken: vi.fn((id: string) => {
      cleared.push(id);
      tokens.delete(id);
      keypairs.delete(id);
    }),
    authorities,
    setGrantedAuthority: vi.fn((id: string, authority: SourceAuthority) => {
      authorities.push({ id, authority });
      return true;
    }),
  };
}

function createFakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const scheduled: number[] = [];
  let nextHandle = 1;
  return {
    pending,
    scheduled,
    setTimer: (fn: () => void, ms: number): unknown => {
      const handle = nextHandle++;
      pending.set(handle, { fn, ms });
      scheduled.push(ms);
      return handle;
    },
    clearTimer: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    /** Fire the earliest scheduled callback. Returns false when none is due. */
    fireNext(): boolean {
      const entry = [...pending.entries()][0];
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1].fn();
      return true;
    },
  };
}

// ---- Harness -------------------------------------------------------------

function sshAliasRecord(): ConnectedSourceRecord {
  return {
    id: SOURCE_ID,
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    displayName: 'North workshop',
    transport: { kind: 'ssh-alias', alias: ALIAS, remotePort: REMOTE_PORT },
    credentialOwner: 'source-owned-ssh',
    hasDeviceCredential: false,
    createdAt: FIXED_NOW - 86_400_000,
  };
}

function manualRecord(): ConnectedSourceRecord {
  return {
    ...sshAliasRecord(),
    id: 'src-southwind-01',
    displayName: 'South workshop',
    transport: {
      kind: 'ssh-manual',
      host: MANUAL_HOST,
      user: MANUAL_USER,
      port: MANUAL_SSH_PORT,
      identityFile: MANUAL_KEY_PATH,
      remotePort: REMOTE_PORT,
    },
    credentialOwner: 'exawatt-keychain',
  };
}

function loopbackRecord(): ConnectedSourceRecord {
  return {
    ...sshAliasRecord(),
    id: 'src-this-machine-01',
    placement: 'local',
    displayName: 'This machine',
    transport: { kind: 'local-loopback', port: LOOPBACK_PORT },
  };
}

/** A source whose Gateway is simulated, so its answers are not observations. */
function demoRecord(): ConnectedSourceRecord {
  return {
    ...loopbackRecord(),
    id: 'src-demo-01',
    adapterId: 'demo',
    displayName: 'Demo workshop',
  };
}

interface HarnessOptions {
  record?: ConnectedSourceRecord;
  storedTokens?: Record<string, string>;
  /** Tunnel outcomes, consumed in order; a missing entry opens successfully. */
  tunnelFailures?: (SshTunnelFailureClass | null)[];
  bootstrapFailure?: GatewayBootstrapFailure;
  issueDeviceToken?: string | null;
  refuseHandshake?: boolean;
  /** Scopes the fake Gateway echoes back as granted, when it echoes any. */
  reportGrantedScopes?: readonly string[];
  maxReconnectAttempts?: number;
  /** What the last process saw behind this source, as a relaunch supplies it. */
  knownIdentity?: GatewayIdentity | null;
  /**
   * A relaunch: the same server and the same keychain, a new process. Passing
   * a previous harness's gateway and store is how a test asks the question
   * only a second launch can answer.
   */
  gateway?: FakeGateway;
  store?: ReturnType<typeof createFakeStore>;
}

function createHarness(options: HarnessOptions = {}) {
  const record = options.record ?? sshAliasRecord();
  const gateway = options.gateway ?? new FakeGateway();
  const store = options.store ?? createFakeStore(options.storedTokens);
  const timers = createFakeTimers();
  const tunnels: FakeTunnelHandle[] = [];
  const clients: FakeGatewayClient[] = [];
  const phases: ConnectedGatewayPhase[] = [];
  const tunnelFailures = [...(options.tunnelFailures ?? [])];
  let clock = FIXED_NOW;

  const openTunnel = vi.fn<typeof openSshTunnel>(async () => {
    const failure = tunnelFailures.shift() ?? null;
    if (failure) {
      return {
        ok: false,
        failure: { class: failure, message: `tunnel failed: ${failure}` },
      };
    }
    const handle = createFakeTunnel();
    tunnels.push(handle);
    return { ok: true, tunnel: handle.tunnel };
  });

  const resolveCredential = vi.fn<typeof resolveGatewayCredential>(async () => {
    if (options.bootstrapFailure) {
      return {
        ok: false,
        failure: options.bootstrapFailure,
        message: 'bootstrap failed',
      };
    }
    return {
      ok: true,
      facts: {
        version: gateway.version,
        gatewayPort: REMOTE_PORT,
        sharedToken: SHARED_SECRET,
        tokenSource: 'cli',
      },
    };
  });

  const remoteExec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

  const deps: ConnectedGatewaySessionDeps = {
    store,
    openTunnel,
    resolveCredential,
    remoteExec,
    createClient: (config: OCClientConfig) => {
      const client = new FakeGatewayClient(
        config,
        gateway,
        options.issueDeviceToken === undefined
          ? DEVICE_TOKEN
          : options.issueDeviceToken,
        options.refuseHandshake ?? false,
        options.reportGrantedScopes ?? null
      );
      clients.push(client);
      return client as unknown as ConnectedGatewayClient;
    },
    now: () => clock,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...(options.maxReconnectAttempts === undefined
      ? {}
      : { maxReconnectAttempts: options.maxReconnectAttempts }),
    ...(options.knownIdentity === undefined
      ? {}
      : { knownIdentity: options.knownIdentity }),
  };

  const session = new ConnectedGatewaySession(record, deps);
  session.onPhaseChange(phase => phases.push(phase));

  return {
    record,
    gateway,
    store,
    timers,
    tunnels,
    clients,
    phases,
    openTunnel,
    resolveCredential,
    remoteExec,
    session,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function agentIdsOf(session: ConnectedGatewaySession): string[] {
  return (session.snapshot?.agents ?? []).map(agent => agent.nativeAgentId);
}

// ---- Tests ---------------------------------------------------------------

describe('ConnectedGatewaySession — connecting', () => {
  it('opens a tunnel, pairs, discovers, and ends connected with a snapshot', async () => {
    const harness = createHarness();

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.phase).toBe('connected');
    expect(harness.openTunnel).toHaveBeenCalledWith({
      kind: 'ssh-alias',
      alias: ALIAS,
      remotePort: REMOTE_PORT,
    });
    expect(harness.clients[0]?.config.url).toBe(`ws://127.0.0.1:${LOCAL_PORT}`);
    expect(agentIdsOf(harness.session)).toEqual([AGENT_LUMEN, AGENT_QUILL]);
    expect(harness.session.facts).toEqual({
      version: '2026.6.11',
      configuredAgentCount: 2,
      automationCount: 1,
      observedAt: FIXED_NOW,
    });
    expect(harness.session.status()).toMatchObject({
      state: 'live',
      stalePresentation: false,
    });
    expect(harness.phases).toEqual([
      'opening-tunnel',
      'bootstrapping',
      'pairing',
      'discovering',
      'connected',
    ]);
  });

  it('discovers with agents.list, one sessions.list per Agent, cron.list, and status', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.gateway.received.map(entry => entry.method)).toEqual([
      'agents.list',
      'sessions.list',
      'sessions.list',
      'cron.list',
      'status',
      // Connecting also asks the source to stream each coworker's primary
      // conversation, so a reply arrives as it is written rather than on the
      // next authoritative read.
      'sessions.messages.subscribe',
      'sessions.messages.subscribe',
    ]);
    expect(
      harness.gateway.received
        .filter(entry => entry.method === 'sessions.messages.subscribe')
        .map(entry => (entry.params as { key: string }).key)
    ).toEqual([`agent:${AGENT_LUMEN}:main`, `agent:${AGENT_QUILL}:main`]);
    expect(
      harness.gateway.received
        .filter(entry => entry.method === 'sessions.list')
        .map(entry => (entry.params as { agentId: string }).agentId)
    ).toEqual([AGENT_QUILL, AGENT_LUMEN]);
    // main is the source-declared primary conversation; cron stays subordinate.
    const contexts = harness.session.snapshot?.contexts ?? [];
    expect(contexts.filter(context => context.kind === 'main')).toHaveLength(2);
    expect(
      contexts.filter(context => context.roles.includes('primary-conversation'))
    ).toHaveLength(2);
  });

  it('never opens a tunnel for a local-loopback source', async () => {
    const harness = createHarness({ record: loopbackRecord() });

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.openTunnel).not.toHaveBeenCalled();
    expect(harness.clients[0]?.config.url).toBe(
      `ws://127.0.0.1:${LOOPBACK_PORT}`
    );
  });

  it('resolves the local credential from the transport, with no alias in sight', async () => {
    const record = loopbackRecord();
    const harness = createHarness({ record });

    await harness.session.connect();

    // The seam is handed the transport itself, so the local path can read this
    // machine's own configuration instead of being passed an empty alias.
    expect(harness.resolveCredential).toHaveBeenCalledWith(record.transport, {
      exec: harness.remoteExec,
    });
    expect(harness.phases).toEqual([
      'bootstrapping',
      'pairing',
      'discovering',
      'connected',
    ]);
  });

  it('opens a tunnel to a manually entered server and connects through it', async () => {
    const record = manualRecord();
    const harness = createHarness({ record });

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.phase).toBe('connected');
    // Every field the record holds reaches the tunnel owner, which is the only
    // place that decides whether they are safe to hand to ssh.
    expect(harness.openTunnel).toHaveBeenCalledWith({
      kind: 'ssh-manual',
      host: MANUAL_HOST,
      user: MANUAL_USER,
      port: MANUAL_SSH_PORT,
      identityFile: MANUAL_KEY_PATH,
      remotePort: REMOTE_PORT,
    });
    expect(harness.clients[0]?.config.url).toBe(`ws://127.0.0.1:${LOCAL_PORT}`);
    expect(harness.resolveCredential).toHaveBeenCalledWith(record.transport, {
      exec: harness.remoteExec,
    });
  });

  it('opens a tunnel to an alias server with only the alias and the port', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.openTunnel).toHaveBeenCalledWith({
      kind: 'ssh-alias',
      alias: ALIAS,
      remotePort: REMOTE_PORT,
    });
  });

  it('reconnects a manually entered server the same way it first connected', async () => {
    const harness = createHarness({
      record: manualRecord(),
      storedTokens: { 'src-southwind-01': DEVICE_TOKEN },
    });
    await harness.session.connect();

    harness.tunnels[0]!.drop({ class: 'host-unreachable', message: 'lost' });
    harness.timers.fireNext();

    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));
    expect(harness.openTunnel).toHaveBeenCalledTimes(2);
    expect(harness.tunnels).toHaveLength(2);
  });
});

describe('ConnectedGatewaySession — credential custody', () => {
  it('reuses a stored device token and never bootstraps again', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.resolveCredential).toHaveBeenCalledTimes(0);
    expect(harness.clients[0]?.presentedToken).toBe(DEVICE_TOKEN);
    expect(harness.clients[0]?.config.token).toBeUndefined();
    // Presented as the device the token belongs to, not as a new one.
    expect(harness.clients[0]?.deviceKeypair).toEqual(SAVED_KEYPAIR);
    expect(harness.store.writes).toEqual([]);
    expect(harness.phases).not.toContain('bootstrapping');
  });

  it('bootstraps once, persists the issued device token, and never exposes the shared secret', async () => {
    const harness = createHarness();

    const result = await harness.session.connect();

    expect(harness.resolveCredential).toHaveBeenCalledTimes(1);
    expect(harness.resolveCredential).toHaveBeenCalledWith(
      harness.record.transport,
      { exec: harness.remoteExec }
    );
    expect(harness.clients[0]?.presentedToken).toBe(SHARED_SECRET);
    // The token and the identity it was issued to, written together. Either
    // half alone is a credential the next launch cannot present.
    expect(harness.store.writes).toEqual([
      {
        id: SOURCE_ID,
        token: DEVICE_TOKEN,
        keypair: harness.clients[0]?.deviceKeypair,
      },
    ]);

    // The shared secret is admin-capable: it may not survive anywhere Exawatt
    // owns, including anything the session hands back to a caller.
    const exposed = JSON.stringify({
      result,
      phase: harness.session.phase,
      status: harness.session.status(),
      snapshot: harness.session.snapshot,
      identity: harness.session.identity,
      facts: harness.session.facts,
      drift: harness.session.identityDrift,
    });
    expect(exposed).not.toContain(SHARED_SECRET);
    for (const write of harness.store.writes) {
      expect(JSON.stringify(write)).not.toContain(SHARED_SECRET);
    }
    // Cleared from the config the client kept, too.
    expect(harness.clients[0]?.config.token).toBeUndefined();
  });

  it('stays connected when the OS refuses to persist the token, and claims no credential', async () => {
    const harness = createHarness();
    harness.store.refuseEncryption();

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.phase).toBe('connected');
    // No credential is claimed, so the next launch simply bootstraps again.
    expect(harness.store.clearDeviceToken).toHaveBeenCalledWith(SOURCE_ID);
  });

  it('requests exactly the operator.read scope', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.clients[0]?.config.scopes).toEqual(['operator.read']);
    expect(H1_READ_SCOPES).toEqual(['operator.read']);
  });
});

describe('ConnectedGatewaySession — one device, once, forever', () => {
  it('presents on the next launch the same device the token was issued to', async () => {
    // The regression. Exawatt minted a keypair per client, the Gateway
    // derives the device id from that key and binds the issued token to it,
    // so a token persisted by one launch was presented by a different device
    // on the next one and refused: "device token mismatch". Every relaunch
    // and every automatic reconnect of every saved source failed, and the
    // source stayed unavailable until someone cleared the token by hand.
    const first = createHarness();
    await first.session.connect();
    const pairedAs = first.clients[0]!.deviceKey;
    const writesWhenPaired = first.store.writes.length;

    // A second process over the same server and the same keychain.
    const relaunch = createHarness({
      gateway: first.gateway,
      store: first.store,
    });
    const result = await relaunch.session.connect();

    expect(result.ok).toBe(true);
    expect(relaunch.session.phase).toBe('connected');
    // One device across both launches, so the token still belongs to it.
    expect(relaunch.clients[0]?.deviceKey).toBe(pairedAs);
    expect(relaunch.gateway.deviceIds).toEqual([pairedAs, pairedAs]);
    expect(relaunch.clients[0]?.presentedToken).toBe(DEVICE_TOKEN);
    // No second device record on the operator's server, and the
    // admin-capable shared secret was never read a second time.
    expect(relaunch.resolveCredential).not.toHaveBeenCalled();
    expect(relaunch.store.writes).toHaveLength(writesWhenPaired);
    expect(relaunch.phases).not.toContain('bootstrapping');
  });

  it('is the same device across every connection one session opens', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();

    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();
    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));
    await harness.session.connect();

    expect(harness.gateway.deviceIds.length).toBeGreaterThan(1);
    expect(new Set(harness.gateway.deviceIds).size).toBe(1);
    expect(harness.gateway.deviceIds[0]).toBe(deviceIdOf(SAVED_KEYPAIR));
  });

  it('pairs again as the device it already is when only the token is gone', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    harness.store.tokens.delete(SOURCE_ID);

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    // A reissued token for the device this source already approved, rather
    // than a second device on the operator's server wearing the same name.
    expect(harness.resolveCredential).toHaveBeenCalledTimes(1);
    expect(harness.clients[0]?.deviceKeypair).toEqual(SAVED_KEYPAIR);
    expect(harness.gateway.deviceIds).toEqual([deviceIdOf(SAVED_KEYPAIR)]);
    expect(harness.store.writes).toEqual([
      { id: SOURCE_ID, token: DEVICE_TOKEN, keypair: SAVED_KEYPAIR },
    ]);
  });

  it('treats a token with no identity beside it as no credential at all', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    // What the shipped defect left on disk: a token, and no device that can
    // present it. Reading it back as a credential is what wedged the source.
    harness.store.keypairs.delete(SOURCE_ID);

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.resolveCredential).toHaveBeenCalledTimes(1);
    expect(harness.clients[0]?.presentedToken).toBe(SHARED_SECRET);
    expect(harness.store.writes).toEqual([
      {
        id: SOURCE_ID,
        token: DEVICE_TOKEN,
        keypair: harness.clients[0]?.deviceKeypair,
      },
    ]);
  });

  it('keeps the identity out of everything it hands a caller', async () => {
    const harness = createHarness();

    const result = await harness.session.connect();

    const exposed = JSON.stringify({
      result,
      phase: harness.session.phase,
      status: harness.session.status(),
      snapshot: harness.session.snapshot,
      identity: harness.session.identity,
      facts: harness.session.facts,
      drift: harness.session.identityDrift,
    });
    expect(exposed).not.toContain(harness.clients[0]!.deviceKeypair.privateKey);
  });
});

describe('ConnectedGatewaySession — a credential the source refuses', () => {
  /** A saved credential the source has since bound to a different device. */
  function refusedCredentialHarness() {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    harness.gateway.issueToken(DEVICE_TOKEN, 'a-device-that-is-not-exawatt');
    return harness;
  }

  it('names the credential rather than sending the operator to a healthy Gateway', async () => {
    const harness = refusedCredentialHarness();

    const result = await harness.session.connect();

    expect(result.ok).toBe(false);
    if (result.ok || result.outcome !== 'failed') return;
    // Not `gateway-down`. The Gateway answered, and it answered about the
    // credential; classifying it as an outage costs the operator the one
    // sentence that makes the next step obvious.
    expect(result.failure).toBe('auth-rejected');
    expect(result.message).toMatch(/credential/iu);
    expect(result.message).toContain('device token mismatch');
    expect(result.message).not.toMatch(STOPPED_WORK_WORDS);
  });

  it('discards the refused credential so the source can recover', async () => {
    const harness = refusedCredentialHarness();

    await harness.session.connect();

    expect(harness.store.clearDeviceToken).toHaveBeenCalledWith(SOURCE_ID);
    expect(harness.store.tokens.has(SOURCE_ID)).toBe(false);
    expect(harness.store.keypairs.has(SOURCE_ID)).toBe(false);
  });

  it('pairs a new device on the next connect, and never inside the refused one', async () => {
    const harness = refusedCredentialHarness();

    const refused = await harness.session.connect();
    // Reading the admin-capable shared secret again is the cost of recovery,
    // so it is reported and deliberate rather than retried inside the failure.
    expect(refused.ok).toBe(false);
    expect(harness.resolveCredential).not.toHaveBeenCalled();

    const recovered = await harness.session.connect();

    expect(recovered.ok).toBe(true);
    expect(harness.resolveCredential).toHaveBeenCalledTimes(1);
    expect(harness.store.writes).toHaveLength(1);
    expect(harness.session.phase).toBe('connected');
  });

  it('stops the retry ladder rather than pairing a new device on a timer', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    const devicesSeen = harness.gateway.deviceIds.length;

    // The source reissues Exawatt's token to a different device while nobody
    // is looking, and then the connection drops.
    harness.gateway.issueToken(DEVICE_TOKEN, 'a-device-that-is-not-exawatt');
    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();

    await vi.waitFor(() => expect(harness.session.phase).toBe('failed'));
    // The credential is gone, so the only way back is a pairing that mints a
    // new device and reads the source's admin-capable secret again. That is
    // an operator's decision, not a timer's: the ladder stops here.
    expect(harness.store.clearDeviceToken).toHaveBeenCalledWith(SOURCE_ID);
    expect(harness.timers.pending.size).toBe(0);
    expect(harness.resolveCredential).not.toHaveBeenCalled();
    expect(harness.gateway.deviceIds).toHaveLength(devicesSeen + 1);

    // And connecting again is all it takes.
    const recovered = await harness.session.connect();
    expect(recovered.ok).toBe(true);
    expect(harness.resolveCredential).toHaveBeenCalledTimes(1);
  });

  it('keeps a credential the source refused for some other reason', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    harness.gateway.failHandshakes('INTERNAL: the Gateway is restarting');

    const result = await harness.session.connect();

    expect(result.ok).toBe(false);
    if (result.ok || result.outcome !== 'failed') return;
    expect(result.failure).toBe('gateway-down');
    // The source's words travel either way; what changes is what Exawatt
    // concludes from them. A refusal that says nothing about the credential
    // must not cost the operator the device they already paired.
    expect(result.message).toContain('the Gateway is restarting');
    expect(harness.store.clearDeviceToken).not.toHaveBeenCalled();
    expect(harness.store.tokens.get(SOURCE_ID)).toBe(DEVICE_TOKEN);
  });
});

describe('ConnectedGatewaySession — read-only enforcement', () => {
  it('refuses every write method and never lets it reach the client', async () => {
    const harness = createHarness();
    await harness.session.connect();
    const client = harness.clients[0]!;
    const before = client.calls.length;

    for (const method of ['chat.send', 'cron.add', 'sessions.steer']) {
      await expect(harness.session.read(method, { text: 'x' })).rejects.toThrow(
        /read-only/u
      );
    }

    expect(client.calls).toHaveLength(before);
    expect(
      client.calls.some(call =>
        ['chat.send', 'cron.add', 'sessions.steer'].includes(call.method)
      )
    ).toBe(false);
  });

  it('allows the H1 read methods through the same guard', async () => {
    const harness = createHarness();
    await harness.session.connect();

    await expect(harness.session.read('health')).resolves.toEqual({ ok: true });
    expect(H1_READ_METHODS).toContain('chat.history');
    expect(H1_READ_METHODS).not.toContain('chat.send');
  });
});

describe('ConnectedGatewaySession — failure classification', () => {
  const cases: SshTunnelFailureClass[] = [
    'invalid-target',
    'host-unreachable',
    'auth-rejected',
    'gateway-down',
    'unknown',
  ];

  it.each(cases)(
    'maps the %s tunnel failure to its source failure class and phase failed',
    async tunnelFailure => {
      const harness = createHarness({ tunnelFailures: [tunnelFailure] });

      const result = await harness.session.connect();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.outcome).toBe('failed');
      if (result.outcome !== 'failed') return;
      expect(result.failure).toBe(
        TUNNEL_FAILURE_TO_SOURCE_FAILURE[tunnelFailure]
      );
      expect(harness.session.phase).toBe('failed');
      expect(harness.session.status().state).toBe('unavailable');
      expect(harness.resolveCredential).not.toHaveBeenCalled();
    }
  );

  it('maps a bootstrap failure to its source failure class', async () => {
    const harness = createHarness({ bootstrapFailure: 'openclaw-missing' });

    const result = await harness.session.connect();

    expect(result.ok).toBe(false);
    if (result.ok || result.outcome !== 'failed') return;
    expect(result.failure).toBe(
      BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE['openclaw-missing']
    );
    expect(harness.session.phase).toBe('failed');
  });
});

describe('ConnectedGatewaySession — losing the connection', () => {
  it('goes reconnecting, retains the last-known snapshot, and never implies work stopped', async () => {
    const harness = createHarness();
    await harness.session.connect();
    const snapshotBefore = harness.session.snapshot;

    harness.tunnels[0]!.drop({
      class: 'host-unreachable',
      message: 'link lost',
    });

    expect(harness.session.phase).toBe('reconnecting');
    expect(harness.session.snapshot).toBe(snapshotBefore);
    expect(agentIdsOf(harness.session)).toEqual([AGENT_LUMEN, AGENT_QUILL]);

    const status = harness.session.status();
    expect(status.state).toBe('reconnecting');
    expect(status.stalePresentation).toBe(true);

    const spoken = [
      JSON.stringify(status),
      describeConnectionStatus(status),
      harness.session.phase,
    ].join(' ');
    expect(spoken).not.toMatch(STOPPED_WORK_WORDS);
  });

  it('treats a socket drop the same way as a tunnel drop', async () => {
    const harness = createHarness();
    await harness.session.connect();

    harness.clients[0]!.emitStatus('disconnected');

    expect(harness.session.phase).toBe('reconnecting');
    expect(harness.session.status().stalePresentation).toBe(true);
  });

  it('resnapshots authoritatively on reconnect instead of merging deltas', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    expect(agentIdsOf(harness.session)).toEqual([AGENT_LUMEN, AGENT_QUILL]);

    // The source retires one Agent while Exawatt is not watching.
    harness.gateway.agentIds = [AGENT_QUILL];
    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();

    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));
    expect(agentIdsOf(harness.session)).toEqual([AGENT_QUILL]);
    const contexts = harness.session.snapshot?.contexts ?? [];
    expect(
      contexts.some(context => context.nativeAgentId === AGENT_LUMEN)
    ).toBe(false);
    expect(harness.tunnels).toHaveLength(2);
    expect(harness.tunnels[0]!.closeCount()).toBe(1);
  });

  it('backs off with a bounded ladder and gives up after the attempt budget', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
      maxReconnectAttempts: 2,
    });
    await harness.session.connect();

    // Every retry from here on finds the server unreachable.
    harness.tunnels[0]!.drop({ class: 'host-unreachable', message: 'lost' });
    const failing = harness.openTunnel;
    failing.mockImplementation(async () => ({
      ok: false,
      failure: { class: 'host-unreachable', message: 'still unreachable' },
    }));

    expect(harness.session.phase).toBe('reconnecting');
    harness.timers.fireNext();
    await vi.waitFor(() => expect(harness.timers.pending.size).toBe(1));
    expect(harness.session.phase).toBe('reconnecting');
    harness.timers.fireNext();

    await vi.waitFor(() => expect(harness.session.phase).toBe('failed'));
    expect(harness.timers.pending.size).toBe(0);
    expect(harness.timers.scheduled).toEqual([
      RECONNECT_BASE_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2,
    ]);
    // Last-known content survives the give-up; it is stale, never stopped.
    expect(agentIdsOf(harness.session)).toEqual([AGENT_LUMEN, AGENT_QUILL]);
    expect(harness.session.status().state).toBe('unavailable');
  });

  it('reports identity drift instead of silently rebinding the projection', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    const boundSnapshot = harness.session.snapshot;

    // A completely different installation now answers behind the same alias.
    harness.gateway.agentIds = [AGENT_TESSERA];
    harness.gateway.version = '2026.7.02';
    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();

    await vi.waitFor(() =>
      expect(harness.session.identityDrift).not.toBeNull()
    );
    const drift = harness.session.identityDrift!;
    expect(drift.previous.nativeAgentIds).toEqual([AGENT_LUMEN, AGENT_QUILL]);
    expect(drift.observed.nativeAgentIds).toEqual([AGENT_TESSERA]);
    expect(drift.observed.version).toBe('2026.7.02');
    // The old mapping is retained for the operator to remap or detach.
    expect(harness.session.snapshot).toBe(boundSnapshot);
    expect(harness.session.phase).toBe('failed');
    expect(harness.session.status().state).not.toBe('live');
    // Drift is not a transport fault, so the ladder stops rather than retrying.
    expect(harness.timers.pending.size).toBe(0);
  });

  it('does not call an ordinary roster change identity drift', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();

    harness.gateway.agentIds = [AGENT_QUILL, AGENT_TESSERA];
    harness.gateway.version = '2026.7.02';
    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();

    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));
    expect(harness.session.identityDrift).toBeNull();
    expect(agentIdsOf(harness.session)).toEqual([AGENT_QUILL, AGENT_TESSERA]);
  });
});

describe('ConnectedGatewaySession — resnapshot', () => {
  it('is idempotent over identical source state', async () => {
    const harness = createHarness();
    await harness.session.connect();

    const first = await harness.session.resnapshot();
    const second = await harness.session.resnapshot();

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.snapshot).toEqual(first.snapshot);

    // Only the observation time may move when the clock does.
    harness.advance(5_000);
    const third = await harness.session.resnapshot();
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect({ ...third.snapshot, observedAt: 0 }).toEqual({
      ...first.snapshot,
      observedAt: 0,
    });
    expect(third.snapshot.observedAt).toBe(FIXED_NOW + 5_000);
  });

  it('refuses to resnapshot without an open connection', async () => {
    const harness = createHarness();

    const result = await harness.session.resnapshot();

    expect(result.ok).toBe(false);
  });
});

describe('ConnectedGatewaySession — connecting again', () => {
  /** The operator's own Reconnect, over a source that is already connected. */
  function reconnectableHarness() {
    return createHarness({ storedTokens: { [SOURCE_ID]: DEVICE_TOKEN } });
  }

  it('closes the connection it had before it opens another', async () => {
    const harness = reconnectableHarness();
    await harness.session.connect();

    const again = await harness.session.connect();

    expect(again.ok).toBe(true);
    expect(harness.session.phase).toBe('connected');
    expect(harness.tunnels).toHaveLength(2);
    expect(harness.clients).toHaveLength(2);
    // Exactly once each: an `ssh` child left holding a port open on the
    // operator's server is the whole cost of getting this wrong.
    expect(harness.tunnels[0]!.closeCount()).toBe(1);
    expect(harness.clients[0]!.disconnectCount).toBe(1);
    expect(harness.tunnels[1]!.tunnel.closed).toBe(false);
    expect(harness.clients[1]!.disconnectCount).toBe(0);
  });

  it('watches the connection it is now on, so a later drop is still seen', async () => {
    const harness = reconnectableHarness();
    await harness.session.connect();
    await harness.session.connect();

    harness.tunnels[1]!.drop({
      class: 'host-unreachable',
      message: 'the hop went away',
    });

    expect(harness.session.phase).toBe('reconnecting');
    expect(harness.session.status().stalePresentation).toBe(true);
    // And the ladder repairs it, so the drop is an outage rather than a wall.
    harness.timers.fireNext();
    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));
  });

  it('sees the socket underneath the new connection drop as well', async () => {
    const harness = reconnectableHarness();
    await harness.session.connect();
    await harness.session.connect();

    harness.clients[1]!.emitStatus('disconnected');

    expect(harness.session.phase).toBe('reconnecting');
  });

  it('ignores a drop reported by the connection it already closed', async () => {
    const harness = reconnectableHarness();
    await harness.session.connect();
    await harness.session.connect();

    harness.tunnels[0]!.drop(null);
    harness.clients[0]!.emitStatus('error');

    expect(harness.session.phase).toBe('connected');
    expect(harness.session.status().state).toBe('live');
  });

  it('takes a fresh authoritative snapshot rather than presenting the old one', async () => {
    const harness = reconnectableHarness();
    await harness.session.connect();
    expect(agentIdsOf(harness.session)).toEqual([AGENT_LUMEN, AGENT_QUILL]);

    // The source retires one Agent between the two connects.
    harness.gateway.agentIds = [AGENT_QUILL];
    harness.advance(1_000);
    await harness.session.connect();

    expect(agentIdsOf(harness.session)).toEqual([AGENT_QUILL]);
    expect(harness.session.snapshot?.observedAt).toBe(FIXED_NOW + 1_000);
  });
});

describe('ConnectedGatewaySession — an identity remembered across a relaunch', () => {
  /** What the previous process observed, as a caller persisted it. */
  const REMEMBERED: GatewayIdentity = {
    version: '2026.6.11',
    nativeAgentIds: [AGENT_LUMEN, AGENT_QUILL],
  };

  it('publishes the identity a caller has to keep for the next launch', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.session.identity).toEqual(REMEMBERED);
  });

  it('reports drift the first time it looks, without ever having watched', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
      knownIdentity: REMEMBERED,
    });
    // A different installation is answering behind the same alias, and this
    // process never saw the one before it.
    harness.gateway.agentIds = [AGENT_TESSERA];
    harness.gateway.version = '2026.7.02';

    const result = await harness.session.connect();

    expect(result).toMatchObject({ ok: false, outcome: 'identity-drift' });
    const drift = harness.session.identityDrift;
    expect(drift?.previous.nativeAgentIds).toEqual([AGENT_LUMEN, AGENT_QUILL]);
    expect(drift?.observed.nativeAgentIds).toEqual([AGENT_TESSERA]);
    expect(drift?.observed.version).toBe('2026.7.02');
    // Nothing is rebound, and nothing reads as current.
    expect(harness.session.snapshot).toBeNull();
    expect(harness.session.identity).toEqual(REMEMBERED);
    expect(harness.session.status().state).not.toBe('live');
  });

  it('does not call an ordinary roster change drift', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
      knownIdentity: REMEMBERED,
    });
    harness.gateway.agentIds = [AGENT_QUILL, AGENT_TESSERA];
    harness.gateway.version = '2026.7.02';

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.identityDrift).toBeNull();
    expect(harness.session.identity).toEqual({
      version: '2026.7.02',
      nativeAgentIds: [AGENT_QUILL, AGENT_TESSERA],
    });
  });

  it('sorts a remembered roster, so the order it was stored in cannot read as drift', async () => {
    const harness = createHarness({
      knownIdentity: {
        version: '',
        nativeAgentIds: [AGENT_QUILL, AGENT_LUMEN],
      },
    });

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.identityDrift).toBeNull();
  });

  it('treats a remembered identity it cannot read as never having seen the source', async () => {
    const harness = createHarness({
      knownIdentity: {
        version: '',
        nativeAgentIds: ['   ', 42 as unknown as string],
      },
    });
    harness.gateway.agentIds = [AGENT_TESSERA];

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.identityDrift).toBeNull();
  });

  it('needs no remembered identity to work, and reports none until it observes one', async () => {
    const harness = createHarness({ knownIdentity: null });

    expect(harness.session.identity).toBeNull();
    expect((await harness.session.connect()).ok).toBe(true);
    expect(harness.session.identity).toEqual(REMEMBERED);
  });
});

describe('ConnectedGatewaySession — the evidence a snapshot carries', () => {
  it('records a live source as its own adapter, observed', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.session.snapshot).toMatchObject({
      adapterId: 'openclaw',
      evidenceBasis: 'observed',
    });
  });

  it('records a simulated source as simulated, so it cannot read as an observation', async () => {
    const harness = createHarness({ record: demoRecord() });

    await harness.session.connect();

    expect(harness.session.snapshot).toMatchObject({
      adapterId: 'demo',
      evidenceBasis: 'simulated',
    });
  });

  it('maps each adapter to the basis its answers are entitled to claim', () => {
    expect(evidenceBasisForAdapter('demo')).toBe('simulated');
    for (const adapterId of ['openclaw', 'claude', 'codex'] as const) {
      expect(evidenceBasisForAdapter(adapterId)).toBe('observed');
    }
  });

  it('gives the adapter the automations discovery paid for', async () => {
    const harness = createHarness();

    await harness.session.connect();

    // The failing automation is the evidence D40 needs; discovery used to read
    // it and throw it away, which left a coworker whose work is erroring
    // reading as idle.
    expect(harness.session.snapshot?.automations).toEqual([
      {
        configuredSourceId: SOURCE_ID,
        nativeAgentId: AGENT_QUILL,
        nativeAutomationId: `${AUTOMATION_NAME}-0`,
        enabled: true,
        lastOutcome: 'failed',
        lastRunAt: FIXED_NOW - 60_000,
        targetContextId: null,
      },
    ]);
  });

  it('gives the adapter the source task totals discovery paid for', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.session.snapshot?.taskFacts).toEqual({
      total: 3,
      active: 1,
      terminal: 2,
      failures: 1,
      byStatus: {},
      byRuntime: {},
    });
  });
});

describe('ConnectedGatewaySession — following the conversation', () => {
  const SEGMENT = 'chat.segment';

  function subscribesIn(harness: ReturnType<typeof createHarness>) {
    return harness.gateway.received.filter(
      entry => entry.method === 'sessions.messages.subscribe'
    );
  }

  it('delivers to a subscription taken before anything was connected', async () => {
    const harness = createHarness();
    const seen: unknown[] = [];
    const release = harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });

    await harness.session.connect();
    harness.clients[0]!.emitOCEvent(SEGMENT, { text: 'on its way' });

    expect(seen).toEqual([{ text: 'on its way' }]);
    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(1);

    release();
    harness.clients[0]!.emitOCEvent(SEGMENT, { text: 'after the release' });
    expect(seen).toEqual([{ text: 'on its way' }]);
    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(0);
  });

  it('never attaches a subscription released before the connection existed', async () => {
    const harness = createHarness();
    const seen: unknown[] = [];
    const release = harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });
    release();

    await harness.session.connect();
    harness.clients[0]!.emitOCEvent(SEGMENT, { text: 'nobody is listening' });

    expect(seen).toEqual([]);
    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(0);
  });

  it('re-establishes the subscription on the connection that replaces a dropped one', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    const seen: unknown[] = [];
    harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });
    await harness.session.connect();

    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();
    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));

    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(0);
    expect(harness.clients[1]!.listenerCount(SEGMENT)).toBe(1);

    harness.clients[1]!.emitOCEvent(SEGMENT, { text: 'after the drop' });
    expect(seen).toEqual([{ text: 'after the drop' }]);
  });

  it('asks the source to stream again on every connection, and resumes nothing', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    expect(subscribesIn(harness)).toHaveLength(2);

    harness.tunnels[0]!.drop(null);
    harness.timers.fireNext();
    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));

    // Two coworkers, twice: re-established, never resumed. The Gateway resets
    // its frame sequence per connection and replays nothing, so no subscribe
    // may carry a cursor of any kind.
    expect(subscribesIn(harness)).toHaveLength(4);
    for (const entry of subscribesIn(harness)) {
      expect(Object.keys(entry.params as Record<string, unknown>)).toEqual([
        'key',
      ]);
    }
  });

  it('carries the subscription through an operator Reconnect', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    const seen: unknown[] = [];
    harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });
    await harness.session.connect();

    await harness.session.connect();

    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(0);
    expect(harness.clients[1]!.listenerCount(SEGMENT)).toBe(1);
    harness.clients[1]!.emitOCEvent(SEGMENT, { text: 'after the reconnect' });
    expect(seen).toEqual([{ text: 'after the reconnect' }]);
  });

  it('asks the source to stream again after write authority is granted', async () => {
    const harness = createHarness();
    await harness.session.connect();
    expect(subscribesIn(harness)).toHaveLength(2);
    // The operator approves the Exawatt device on the source itself.
    harness.gateway.approve([...H2_WRITE_SCOPES]);
    const seen: unknown[] = [];
    harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });

    const granted = await harness.session.requestWriteAuthority();

    expect(granted.outcome).toBe('granted');
    // A scope change is settled on the handshake, so it cycles the socket, and
    // a new socket carries no subscription. This is the moment the operator
    // has just been given a voice and is about to send their first message, so
    // the stream is asked for again on the connection the session now holds.
    // Two coworkers, twice: re-established, never resumed.
    expect(subscribesIn(harness)).toHaveLength(4);
    // Same device, same client, so the handlers stay attached exactly once.
    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(1);
    harness.clients[0]!.emitOCEvent(SEGMENT, { text: 'the first reply' });
    expect(seen).toEqual([{ text: 'the first reply' }]);
  });

  it('asks the source to stream again after write authority is given back', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    expect(subscribesIn(harness)).toHaveLength(2);
    const seen: unknown[] = [];
    harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });

    const relinquished = await harness.session.relinquishWriteAuthority();

    // Narrowing cycles the same socket for the same reason, and an operator
    // who gave up writing is still reading, so the stream is asked for again
    // here too rather than left for the next reconnect to repair.
    expect(relinquished.authority).toBe('read');
    expect(subscribesIn(harness)).toHaveLength(4);
    harness.clients[0]!.emitOCEvent(SEGMENT, { text: 'still watching' });
    expect(seen).toEqual([{ text: 'still watching' }]);
  });

  it('stops delivering once the source is detached', async () => {
    const harness = createHarness();
    const seen: unknown[] = [];
    harness.session.onGatewayEvent(SEGMENT, payload => {
      seen.push(payload);
    });
    await harness.session.connect();

    await harness.session.disconnect();

    expect(harness.clients[0]!.listenerCount(SEGMENT)).toBe(0);
    harness.clients[0]!.emitOCEvent(SEGMENT, { text: 'nobody is watching' });
    expect(seen).toEqual([]);
  });
});

describe("ConnectedGatewaySession — the operator's own machine", () => {
  /**
   * `local-loopback` is meant to be one more configured source rather than a
   * special case, and until now only its first connect was exercised. What
   * follows is the rest of the lifecycle over a transport that has no tunnel:
   * an outage, the ladder, a credential refusal, and a detach. Any divergence
   * from the remote path shows up here rather than on the operator's own
   * machine.
   */
  it('recovers from a dropped socket with no tunnel anywhere in the ladder', async () => {
    const harness = createHarness({
      record: loopbackRecord(),
      storedTokens: { 'src-this-machine-01': DEVICE_TOKEN },
    });
    await harness.session.connect();
    expect(harness.session.phase).toBe('connected');

    // A local Gateway restarting is a socket drop and nothing else: there is
    // no tunnel to notice it, so the client watch is the only witness.
    harness.clients[0]!.emitStatus('disconnected');
    expect(harness.session.phase).toBe('reconnecting');
    harness.timers.fireNext();

    await vi.waitFor(() => expect(harness.session.phase).toBe('connected'));
    expect(harness.openTunnel).not.toHaveBeenCalled();
    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[1]!.config.url).toBe(
      `ws://127.0.0.1:${LOOPBACK_PORT}`
    );
    expect(agentIdsOf(harness.session)).toEqual([AGENT_LUMEN, AGENT_QUILL]);
  });

  it('is the same device, at the same scopes, as a source across a network', async () => {
    const harness = createHarness({ record: loopbackRecord() });

    await harness.session.connect();

    // Nothing about being on this machine relaxes the custody model: the
    // Gateway pairs a device, issues a scoped token for it, and the shared
    // secret is gone from the config the client keeps.
    const client = harness.clients[0]!;
    expect(client.config.scopes).toEqual([...H1_READ_SCOPES]);
    expect(client.config.deviceKeypair).toBeDefined();
    expect(client.config.token).toBeUndefined();
    expect(harness.store.tokens.get('src-this-machine-01')).toBe(DEVICE_TOKEN);
    expect(harness.store.keypairs.get('src-this-machine-01')).toEqual(
      client.deviceKeypair
    );
  });

  it("discards a credential this machine's own Gateway refuses", async () => {
    const harness = createHarness({
      record: loopbackRecord(),
      storedTokens: { 'src-this-machine-01': DEVICE_TOKEN },
    });
    harness.gateway.failHandshakes(
      'unauthorized: device token mismatch (rotate/reissue device token)'
    );

    const result = await harness.session.connect();

    expect(result.ok).toBe(false);
    if (result.ok || result.outcome !== 'failed') return;
    expect(result.failure).toBe('auth-rejected');
    expect(harness.store.tokens.has('src-this-machine-01')).toBe(false);
  });

  it('detaches by closing a socket, with no tunnel to close', async () => {
    const harness = createHarness({ record: loopbackRecord() });
    await harness.session.connect();

    await harness.session.disconnect();

    expect(harness.session.phase).toBe('idle');
    expect(harness.clients[0]!.disconnectCount).toBe(1);
    expect(harness.tunnels).toHaveLength(0);
    // Detach is not destruction, on this machine as anywhere else: everything
    // this source was ever asked for is on the read allowlist.
    for (const call of harness.clients[0]!.calls) {
      expect(H1_READ_METHODS).toContain(call.method);
    }
  });
});

describe('ConnectedGatewaySession — detaching', () => {
  it('is safe twice and closes the tunnel exactly once', async () => {
    const harness = createHarness();
    await harness.session.connect();

    await harness.session.disconnect();
    await harness.session.disconnect();

    expect(harness.tunnels[0]!.closeCount()).toBe(1);
    expect(harness.clients[0]!.disconnectCount).toBe(1);
    expect(harness.session.phase).toBe('idle');
    // Detach removes Exawatt's observation and nothing else: no store write,
    // no credential clear, and nothing asked of the remote installation.
    expect(harness.store.clearDeviceToken).not.toHaveBeenCalled();
  });

  it('cancels a pending reconnect rather than retrying after detach', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    harness.tunnels[0]!.drop(null);
    expect(harness.timers.pending.size).toBe(1);

    await harness.session.disconnect();

    expect(harness.timers.pending.size).toBe(0);
    expect(harness.session.phase).toBe('idle');
    expect(harness.openTunnel).toHaveBeenCalledTimes(1);
  });

  it('can be connected again after a detach', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    await harness.session.disconnect();

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.session.phase).toBe('connected');
    expect(harness.openTunnel).toHaveBeenCalledTimes(2);
  });
});

// ---- ENG-033 H2: granted authority ---------------------------------------

/** A source that already holds a granted write authority from an earlier run. */
function writeAuthorityRecord(): ConnectedSourceRecord {
  return { ...sshAliasRecord(), grantedAuthority: 'write' };
}

/** A source whose device the operator has already approved for write. */
function writeGrantedHarness() {
  const harness = createHarness({
    record: writeAuthorityRecord(),
    storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
  });
  harness.gateway.approve([...H2_WRITE_SCOPES]);
  return harness;
}

describe('ConnectedGatewaySession — granted authority', () => {
  it('starts read-only and records nothing it was not granted', async () => {
    const harness = createHarness();

    await harness.session.connect();

    expect(harness.session.authority).toBe('read');
    expect(harness.gateway.handshakes).toEqual([['operator.read']]);
    expect(harness.store.authorities).toEqual([]);
  });

  it('presents the wider scope for a source that already holds write', async () => {
    const harness = writeGrantedHarness();

    const result = await harness.session.connect();

    expect(result.ok).toBe(true);
    expect(harness.clients[0]?.config.scopes).toEqual([...H2_WRITE_SCOPES]);
    expect(harness.session.authority).toBe('write');
  });

  it('falls back to read when the source no longer approves the remembered write', async () => {
    const harness = createHarness({
      record: writeAuthorityRecord(),
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    // The operator narrowed or re-approved the device on the source itself.
    harness.gateway.approve([...H1_READ_SCOPES]);

    const result = await harness.session.connect();

    // Observation survives, and the record stops claiming authority the source
    // no longer grants. Never the reverse: no failure widens what Exawatt asks.
    expect(result.ok).toBe(true);
    expect(harness.session.authority).toBe('read');
    expect(harness.session.status()).toMatchObject({ state: 'live' });
    expect(harness.store.authorities).toEqual([
      { id: SOURCE_ID, authority: 'read' },
    ]);
    expect(harness.gateway.handshakes).toEqual([
      [...H2_WRITE_SCOPES],
      [...H1_READ_SCOPES],
    ]);
    await expect(harness.session.write('chat.send')).rejects.toThrow(
      /read access only/u
    );
  });

  it('believes the Gateway over the ask when the two disagree', async () => {
    const harness = createHarness({
      record: writeAuthorityRecord(),
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
      // The handshake completes, and the source reports a narrower grant.
      reportGrantedScopes: ['operator.read'],
    });
    harness.gateway.approve([...H2_WRITE_SCOPES]);

    await harness.session.connect();

    expect(harness.session.authority).toBe('read');
    expect(harness.store.authorities).toEqual([
      { id: SOURCE_ID, authority: 'read' },
    ]);
  });

  it('cannot be widened by a Gateway reporting more than was asked', async () => {
    const harness = createHarness({
      reportGrantedScopes: [
        'operator.read',
        'operator.write',
        'operator.admin',
      ],
    });

    await harness.session.connect();

    expect(harness.session.authority).toBe('read');
    await expect(harness.session.write('chat.send')).rejects.toThrow(
      /read access only/u
    );
  });
});

describe('ConnectedGatewaySession — requesting write authority', () => {
  it('reports the approval the source needs and keeps working read-only', async () => {
    const harness = createHarness();
    await harness.session.connect();

    const result = await harness.session.requestWriteAuthority();

    expect(result.outcome).toBe('approval-required');
    expect(result.authority).toBe('read');
    expect(result.message).toMatch(/approve/iu);
    expect(result.message).not.toMatch(STOPPED_WORK_WORDS);

    // Nothing was recorded, and the source is still being observed.
    expect(harness.store.authorities).toEqual([]);
    expect(harness.session.authority).toBe('read');
    expect(harness.session.phase).toBe('connected');
    await expect(harness.session.read('health')).resolves.toEqual({ ok: true });
    await expect(harness.session.write('chat.send')).rejects.toThrow(
      /read access only/u
    );

    // Asked wider, was refused, went back to the scope it holds.
    expect(harness.gateway.handshakes).toEqual([
      [...H1_READ_SCOPES],
      [...H2_WRITE_SCOPES],
      [...H1_READ_SCOPES],
    ]);
  });

  it('asks as the device it already is, and never re-pairs', async () => {
    const harness = createHarness({
      storedTokens: { [SOURCE_ID]: DEVICE_TOKEN },
    });
    await harness.session.connect();
    const client = harness.clients[0]!;

    await harness.session.requestWriteAuthority();

    // One client for the life of the session means one device keypair, and the
    // persisted device token is what it presents. A second client would be a
    // second device on the operator's server: the failure mode this prevents.
    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]?.deviceKey).toBe(client.deviceKey);
    expect(client.presentedToken).toBe(DEVICE_TOKEN);
    expect(harness.store.clearDeviceToken).not.toHaveBeenCalled();
    expect(harness.store.writes).toEqual([]);
    // The admin-capable shared secret is not read again to buy authority.
    expect(harness.resolveCredential).not.toHaveBeenCalled();
  });

  it('is granted once the operator approves the device on the source', async () => {
    const harness = createHarness();
    await harness.session.connect();
    expect((await harness.session.requestWriteAuthority()).outcome).toBe(
      'approval-required'
    );

    // The operator approves the Exawatt device on the server itself. Exawatt
    // has no method for this, by design.
    harness.gateway.approve([...H2_WRITE_SCOPES]);

    const result = await harness.session.requestWriteAuthority();

    expect(result.outcome).toBe('granted');
    expect(result.authority).toBe('write');
    expect(harness.session.authority).toBe('write');
    expect(harness.store.authorities).toEqual([
      { id: SOURCE_ID, authority: 'write' },
    ]);

    const client = harness.clients[0]!;
    const before = client.calls.length;
    await harness.session.write('chat.send', { text: 'ready when you are' });
    expect(client.calls.slice(before)).toEqual([
      { method: 'chat.send', params: { text: 'ready when you are' } },
    ]);
  });

  it('reports a plain refusal as a refusal, with the source still observed', async () => {
    const harness = createHarness();
    await harness.session.connect();
    harness.gateway.failHandshakes('INTERNAL: the Gateway is restarting');

    const result = await harness.session.requestWriteAuthority();

    expect(result.outcome).toBe('refused');
    expect(result.authority).toBe('read');
    expect(result.message).toContain('the Gateway is restarting');
    expect(harness.session.phase).toBe('connected');
    await expect(harness.session.read('health')).resolves.toEqual({ ok: true });
  });

  it('has nothing to ask when no connection is open', async () => {
    const harness = createHarness();

    const result = await harness.session.requestWriteAuthority();

    expect(result.outcome).toBe('refused');
    expect(result.authority).toBe('read');
    expect(result.message).toMatch(/no gateway connection/iu);
    expect(harness.clients).toHaveLength(0);
  });

  it('asks the Gateway nothing when the authority is already held', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    const handshakes = harness.gateway.handshakes.length;

    const result = await harness.session.requestWriteAuthority();

    expect(result.outcome).toBe('unchanged');
    expect(result.authority).toBe('write');
    expect(harness.gateway.handshakes).toHaveLength(handshakes);
  });

  it('repairs observation through the ordinary ladder when the refusal costs the socket', async () => {
    const harness = createHarness();
    await harness.session.connect();
    harness.gateway.failHandshakes(
      'NOT_PAIRED: pairing required: device is asking for more scopes than currently approved',
      'INTERNAL: the Gateway went away'
    );

    const result = await harness.session.requestWriteAuthority();

    expect(result.outcome).toBe('approval-required');
    expect(result.authority).toBe('read');
    // The lost socket is an outage like any other, not a new failure mode.
    expect(harness.session.phase).toBe('reconnecting');
    expect(harness.timers.scheduled).toEqual([RECONNECT_BASE_DELAY_MS]);
    expect(describeConnectionStatus(harness.session.status())).not.toMatch(
      STOPPED_WORK_WORDS
    );
  });
});

describe('ConnectedGatewaySession — relinquishing write authority', () => {
  it('returns the source to read-only and shuts the write surface', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    const client = harness.clients[0]!;

    const result = await harness.session.relinquishWriteAuthority();

    expect(result.outcome).toBe('granted');
    expect(result.authority).toBe('read');
    expect(harness.session.authority).toBe('read');
    expect(harness.store.authorities).toEqual([
      { id: SOURCE_ID, authority: 'read' },
    ]);
    // It stopped asking: the last handshake presents read scopes only.
    expect(harness.gateway.handshakes.at(-1)).toEqual([...H1_READ_SCOPES]);
    expect(client.config.scopes).toEqual([...H1_READ_SCOPES]);

    const before = client.calls.length;
    for (const method of H2_WRITE_METHODS) {
      await expect(harness.session.write(method)).rejects.toThrow(
        /read access only/u
      );
    }
    expect(client.calls).toHaveLength(before);
    await expect(harness.session.read('health')).resolves.toEqual({ ok: true });
  });

  it('does not claim the device was revoked, because it was not', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();

    const result = await harness.session.relinquishWriteAuthority();

    // Exawatt stopped asking. The approval on the source is the operator's to
    // withdraw with the source's own tooling, so no copy may say it happened.
    expect(result.message).not.toMatch(/revoked|removed|deleted|unpaired/iu);
    expect(result.message).toMatch(/revoke it there/u);
  });

  it('needs no connection, because asking for less needs no permission', async () => {
    const harness = createHarness({ record: writeAuthorityRecord() });

    const result = await harness.session.relinquishWriteAuthority();

    expect(result.outcome).toBe('granted');
    expect(result.authority).toBe('read');
    expect(harness.store.authorities).toEqual([
      { id: SOURCE_ID, authority: 'read' },
    ]);
    expect(harness.clients).toHaveLength(0);
  });

  it('reports unchanged for a source that never held write', async () => {
    const harness = createHarness();
    await harness.session.connect();
    const handshakes = harness.gateway.handshakes.length;

    const result = await harness.session.relinquishWriteAuthority();

    expect(result.outcome).toBe('unchanged');
    expect(result.authority).toBe('read');
    expect(harness.gateway.handshakes).toHaveLength(handshakes);
    expect(harness.store.authorities).toEqual([]);
  });

  it('keeps the write surface shut even when the narrowing reconnect fails', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    harness.gateway.failHandshakes('INTERNAL: the Gateway went away');

    const result = await harness.session.relinquishWriteAuthority();

    expect(result.authority).toBe('read');
    expect(harness.session.authority).toBe('read');
    await expect(harness.session.write('chat.send')).rejects.toThrow(
      /read access only/u
    );
  });
});

describe('ConnectedGatewaySession — the write surface', () => {
  it.each(H2_WRITE_METHODS)(
    'lets %s through once write is granted',
    async method => {
      const harness = writeGrantedHarness();
      await harness.session.connect();
      const client = harness.clients[0]!;
      const before = client.calls.length;

      await harness.session.write(method, { note: 'invented' });

      expect(client.calls.slice(before)).toEqual([
        { method, params: { note: 'invented' } },
      ]);
    }
  );

  it('refuses everything outside the write allowlist without reaching the client', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    const client = harness.clients[0]!;
    const before = client.calls.length;

    for (const method of [
      // Admin, in every shape the Gateway classifies as one.
      'cron.add',
      'cron.remove',
      'cron.update',
      'config.set',
      'agents.create',
      'agents.delete',
      'sessions.create',
      // Reads belong to the read surface, not this one.
      'agents.list',
      'chat.history',
      // And the verbs the doc defers until the source can prove them.
      'sessions.pause',
      'sessions.resume',
      'sessions.stop',
      '',
    ]) {
      await expect(harness.session.write(method)).rejects.toThrow(
        /write surface allows only/u
      );
    }

    expect(client.calls).toHaveLength(before);
  });

  it('refuses every write method on a read-only source without reaching the client', async () => {
    const harness = createHarness();
    await harness.session.connect();
    const client = harness.clients[0]!;
    const before = client.calls.length;

    for (const method of H2_WRITE_METHODS) {
      await expect(
        harness.session.write(method, { text: 'x' })
      ).rejects.toThrow(/read access only/u);
    }

    expect(client.calls).toHaveLength(before);
    expect(
      client.calls.some(call =>
        (H2_WRITE_METHODS as readonly string[]).includes(call.method)
      )
    ).toBe(false);
  });

  it('cannot be reached through the read surface, whatever the authority', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    const client = harness.clients[0]!;
    const before = client.calls.length;

    for (const method of H2_WRITE_METHODS) {
      await expect(harness.session.read(method)).rejects.toThrow(/read-only/u);
    }
    for (const method of ['cron.add', 'agents.create']) {
      await expect(harness.session.read(method)).rejects.toThrow(/read-only/u);
      await expect(harness.session.write(method)).rejects.toThrow(
        /write surface allows only/u
      );
    }

    expect(client.calls).toHaveLength(before);
  });

  it('refuses a granted write with no connection open', async () => {
    const harness = writeGrantedHarness();
    await harness.session.connect();
    await harness.session.disconnect();

    await expect(harness.session.write('chat.send')).rejects.toThrow(
      /no gateway connection/iu
    );
  });
});
