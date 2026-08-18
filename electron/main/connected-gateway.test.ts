import { describe, expect, it, vi } from 'vitest';
import {
  describeConnectionStatus,
  type ConnectedSourceRecord,
  type OCClientConfig,
  type SourceAuthority,
  type SourceFailureClass,
} from '@exawatt/core';
import {
  BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE,
  ConnectedGatewaySession,
  H1_READ_METHODS,
  H1_READ_SCOPES,
  H2_WRITE_METHODS,
  H2_WRITE_SCOPES,
  RECONNECT_BASE_DELAY_MS,
  SCOPES_FOR_AUTHORITY,
  TUNNEL_FAILURE_TO_SOURCE_FAILURE,
  authorityForGrantedScopes,
  classifyAuthorityRefusal,
  type ConnectedGatewayClient,
  type ConnectedGatewayPhase,
  type ConnectedGatewaySessionDeps,
} from './connected-gateway';
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

const FIXED_NOW = 1_760_000_000_000;

/** Distinguishes one client instance's device identity from another's. */
let deviceKeys = 0;

/** Words the product may never use about work it merely stopped watching. */
const STOPPED_WORK_WORDS = /stopped|paused|ended|halted|finished|terminated/iu;

// ---- Fake source ---------------------------------------------------------

class FakeGateway {
  agentIds: string[] = [AGENT_QUILL, AGENT_LUMEN];
  version = '2026.6.11';
  automationCount = 1;
  /** Methods the fake was asked for, in order. */
  readonly received: { method: string; params: unknown }[] = [];

  /**
   * Scopes this source has approved for Exawatt's device. Null until the
   * device is known, which is what makes the first pairing the silent one.
   */
  approvedScopes: string[] | null = null;
  /** Scopes presented on each handshake, in order. */
  readonly handshakes: string[][] = [];
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
    deviceToken: string | null
  ): { ok: true } | { ok: false; message: string } {
    this.handshakes.push([...requested]);
    const scripted = this.handshakeErrors.shift();
    if (scripted !== undefined) return { ok: false, message: scripted };

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
          })),
        };
      case 'status':
        return { version: this.version, sessions: this.agentIds.length };
      case 'health':
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
  /** The device keypair a real client generates once and keeps for its life. */
  readonly deviceKey = `device-key-${++deviceKeys}`;
  private status = 'disconnected';
  readonly calls: { method: string; params: unknown }[] = [];
  private readonly statusHandlers = new Set<(status: string) => void>();

  constructor(
    readonly config: OCClientConfig,
    private readonly gateway: FakeGateway,
    private readonly issueToken: string | null,
    private readonly refuse: boolean,
    private readonly reportGrantedScopes: readonly string[] | null = null
  ) {}

  async connect(): Promise<void> {
    if (this.refuse) throw new Error('gateway refused the handshake');
    const requested = [...(this.config.scopes ?? [])];
    const paired = this.gateway.pair(requested, this.deviceToken);
    if (!paired.ok) {
      this.status = 'error';
      throw new Error(paired.message);
    }
    this.presentedToken = this.deviceToken ?? this.config.token ?? null;
    if (this.deviceToken === null && this.issueToken !== null) {
      this.deviceToken = this.issueToken;
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

  onOCEvent(): void {}
  offOCEvent(): void {}

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

function createFakeStore(initial: Record<string, string> = {}) {
  const tokens = new Map(Object.entries(initial));
  const writes: { id: string; token: string }[] = [];
  const cleared: string[] = [];
  const authorities: { id: string; authority: SourceAuthority }[] = [];
  let refuseWrites = false;
  return {
    tokens,
    writes,
    cleared,
    refuseEncryption(): void {
      refuseWrites = true;
    },
    readDeviceToken: vi.fn((id: string) => tokens.get(id) ?? null),
    writeDeviceToken: vi.fn((id: string, token: string) => {
      writes.push({ id, token });
      if (refuseWrites) {
        return { ok: false, reason: 'encryption-unavailable' } as const;
      }
      tokens.set(id, token);
      return { ok: true } as const;
    }),
    clearDeviceToken: vi.fn((id: string) => {
      cleared.push(id);
      tokens.delete(id);
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
}

function createHarness(options: HarnessOptions = {}) {
  const record = options.record ?? sshAliasRecord();
  const gateway = new FakeGateway();
  const store = createFakeStore(options.storedTokens);
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
    ]);
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
    expect(harness.store.writes).toEqual([
      { id: SOURCE_ID, token: DEVICE_TOKEN },
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

describe('ConnectedGatewaySession — failure vocabularies', () => {
  it('classifies every tunnel and bootstrap failure it can receive', () => {
    const sourceClasses: SourceFailureClass[] = [
      'host-unreachable',
      'gateway-down',
      'auth-rejected',
      'approval-required',
      'incompatible',
      'unknown',
    ];
    for (const mapped of Object.values(TUNNEL_FAILURE_TO_SOURCE_FAILURE)) {
      expect(sourceClasses).toContain(mapped);
    }
    for (const mapped of Object.values(BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE)) {
      expect(sourceClasses).toContain(mapped);
    }
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

describe('ConnectedGatewaySession — authority vocabularies', () => {
  it('allows exactly the Gateway operator.write methods and no pause verb', () => {
    expect([...H2_WRITE_METHODS]).toEqual([
      'chat.send',
      'chat.abort',
      'sessions.steer',
      'tasks.cancel',
    ]);
    expect(H2_WRITE_METHODS.join(' ')).not.toMatch(/pause|resume|stop/iu);
    expect([...H2_WRITE_SCOPES]).toEqual(['operator.read', 'operator.write']);
  });

  it('never puts an admin method on either surface', () => {
    const admin = [
      'cron.add',
      'cron.remove',
      'cron.update',
      'config.set',
      'config.get',
      'agents.create',
      'agents.delete',
    ];
    for (const method of admin) {
      expect(H1_READ_METHODS).not.toContain(method);
      expect(H2_WRITE_METHODS).not.toContain(method);
    }
    expect(JSON.stringify(SCOPES_FOR_AUTHORITY)).not.toContain(
      'operator.admin'
    );
  });

  it('maps each authority to the scopes it presents', () => {
    expect(SCOPES_FOR_AUTHORITY.read).toEqual([...H1_READ_SCOPES]);
    expect(SCOPES_FOR_AUTHORITY.write).toEqual([...H2_WRITE_SCOPES]);
  });

  it('reads write out of granted scopes only when the write scope is there', () => {
    expect(authorityForGrantedScopes(['operator.read'])).toBe('read');
    expect(authorityForGrantedScopes(['operator.read', 'operator.write'])).toBe(
      'write'
    );
    expect(authorityForGrantedScopes([])).toBe('read');
    expect(authorityForGrantedScopes(['operator.admin'])).toBe('read');
    expect(authorityForGrantedScopes(['operator.writer'])).toBe('read');
  });

  it('tells an approval apart from an outage in the Gateway own words', () => {
    for (const message of [
      'INVALID_REQUEST: unauthorized: device token scope mismatch (re-pair or approve scope upgrade)',
      'NOT_PAIRED: pairing required: device is asking for more scopes than currently approved',
    ]) {
      expect(classifyAuthorityRefusal(message)).toBe('approval-required');
    }
    for (const message of [
      'INTERNAL: the Gateway is restarting',
      'connection timeout after 10000ms',
      '',
    ]) {
      expect(classifyAuthorityRefusal(message)).toBe('refused');
    }
  });
});
