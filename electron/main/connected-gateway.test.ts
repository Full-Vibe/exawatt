import { describe, expect, it, vi } from 'vitest';
import {
  describeConnectionStatus,
  type ConnectedSourceRecord,
  type OCClientConfig,
  type SourceFailureClass,
} from '@exawatt/core';
import {
  BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE,
  ConnectedGatewaySession,
  H1_READ_METHODS,
  H1_READ_SCOPES,
  RECONNECT_BASE_DELAY_MS,
  TUNNEL_FAILURE_TO_SOURCE_FAILURE,
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

/** Words the product may never use about work it merely stopped watching. */
const STOPPED_WORK_WORDS = /stopped|paused|ended|halted|finished|terminated/iu;

// ---- Fake source ---------------------------------------------------------

class FakeGateway {
  agentIds: string[] = [AGENT_QUILL, AGENT_LUMEN];
  version = '2026.6.11';
  automationCount = 1;
  /** Methods the fake was asked for, in order. */
  readonly received: { method: string; params: unknown }[] = [];

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
      default:
        throw new Error(`FakeGateway received an unexpected method: ${method}`);
    }
  }
}

class FakeGatewayClient {
  deviceToken: string | null = null;
  disconnectCount = 0;
  presentedToken: string | null = null;
  private status = 'disconnected';
  readonly calls: { method: string; params: unknown }[] = [];
  private readonly statusHandlers = new Set<(status: string) => void>();

  constructor(
    readonly config: OCClientConfig,
    private readonly gateway: FakeGateway,
    private readonly issueToken: string | null,
    private readonly refuse: boolean
  ) {}

  async connect(): Promise<void> {
    if (this.refuse) throw new Error('gateway refused the handshake');
    this.presentedToken = this.deviceToken ?? this.config.token ?? null;
    if (this.deviceToken === null && this.issueToken !== null) {
      this.deviceToken = this.issueToken;
    }
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
        options.refuseHandshake ?? false
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
