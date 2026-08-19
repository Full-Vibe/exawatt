import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DemoConnectedSource,
  DEMO_CONNECTED_SOURCE_NOW_MS,
  DEMO_SOURCE_UNREACHABLE_MESSAGE,
  type AgentSourceAdapterId,
  type AgentSourceEvidenceBasis,
  type OCClientConfig,
} from '@exawatt/core';
import {
  ConnectedGatewaySession,
  type ConnectedGatewayClient,
} from './connected-gateway';
import {
  ConnectedSourceRuntime,
  FileConnectedAgentProjectionPlanStore,
  type ConnectedAgentMapping,
  type ConnectedSourceSession,
} from './connected-source-runtime';
import { ConnectedSourceStore } from './connected-source-store';
import type { SshTunnel, SshTunnelFailure } from './ssh-tunnel';
import {
  CONNECTED_SOURCE_LIFECYCLE_CONTRACT,
  LIFECYCLE_CONTRACT_CASE_IDS,
  unsupportedLever,
  type ConnectedSourceLifecycleAdapter,
  type LifecycleContractCase,
  type LifecycleRenameInput,
  type LifecycleWorld,
} from './connected-source-lifecycle.contract';

/**
 * The Demo adapter's run of the connected-source lifecycle contract
 * (ENG-010 C3).
 *
 * This is the half of the H1 parity criterion that runs in CI. It stands the
 * real `ConnectedSourceRuntime` and the real `ConnectedGatewaySession` up over
 * the Demo connected source, so relaunch, outage, restart, rename, detach, and
 * retirement are proved against the shipping code rather than against a
 * re-implementation of it. A live adapter runs the same case list from the
 * same module against the operator's own servers.
 *
 * Hermetic by construction. The transport, the credential bootstrap, the
 * protocol client, and every timer are injected, so nothing here opens a
 * socket, spawns `ssh`, reads an SSH configuration, or touches a keychain.
 * The clock is a number this file moves by hand; no assertion measures elapsed
 * wall time. Every identifier is invented: this repository is public, and a
 * fixture carrying a real alias, host, agent, or token would publish exactly
 * what the product exists to keep private.
 */

/* ---- Invented configuration ---------------------------------------------- */

const DEMO_ALIAS = 'voltaic-ops-demo';
const DEMO_REMOTE_PORT = 4711;
const DEMO_LOCAL_PORT = 47_110;
const DEMO_SHARED_SECRET = 'demo-shared-secret-never-persisted';
const DEMO_DEVICE_TOKEN = 'demo-device-token-read-only';
const DEMO_SOURCE_NAME = 'Voltaic ops (demo)';
const DEMO_ADAPTER_ID: AgentSourceAdapterId = 'demo';

/** Where each Demo coworker lands, as the Connect flow's Project step would. */
const DEMO_PROJECT_BY_AGENT: Readonly<
  Record<string, { id: string; label: string }>
> = {
  'market-watch': { id: 'demo-project-market-intel', label: 'Market Research' },
  newsroom: { id: 'demo-project-demand-gen', label: 'Social Marketing Team' },
};

const FALLBACK_PROJECT = { id: 'demo-project-connected', label: 'Connected' };

/** One step of the fixture clock. Well under the staleness threshold. */
const CLOCK_STEP_MS = 1_000;
/** What a relaunch costs: the app was closed for a while. */
const RELAUNCH_GAP_MS = 5 * 60_000;

/**
 * A stand-in for the OS keychain, shaped like the one the store's own tests
 * use: the ciphertext does not contain the plaintext, so a test that checks a
 * token never lands on disk in the clear is testing the store.
 */
function fakeEncryption() {
  return {
    isAvailable: () => true,
    encryptString: (plain: string) =>
      Buffer.from(`enc:${Buffer.from(plain, 'utf8').toString('hex')}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('not decryptable');
      return Buffer.from(text.slice(4), 'hex').toString('utf8');
    },
  };
}

/** Let every promise the runtime started settle before asserting on it. */
async function settle(turns = 25): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/* ---- Injected transport -------------------------------------------------- */

interface FakeTunnelHandle {
  tunnel: SshTunnel;
  drop(failure: SshTunnelFailure | null): void;
}

function createFakeTunnel(localPort: number): FakeTunnelHandle {
  const listeners = new Set<(failure: SshTunnelFailure | null) => void>();
  let closed = false;
  const tunnel: SshTunnel = {
    localPort,
    get closed() {
      return closed;
    },
    close: async () => {
      closed = true;
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
    drop: failure => {
      closed = true;
      for (const listener of [...listeners]) listener(failure);
    },
  };
}

/**
 * The protocol client, backed by the Demo source.
 *
 * Every method the session forms is answered by the Demo source itself, so the
 * allowlists, the refusals, and the read-only posture are exercised end to end
 * rather than asserted against a script written to agree with them.
 */
class DemoGatewayClient implements ConnectedGatewayClient {
  deviceToken: string | null = null;
  grantedScopes: readonly string[] | null = null;
  private status = 'disconnected';
  private readonly statusHandlers = new Set<(status: string) => void>();

  constructor(
    readonly config: OCClientConfig,
    private readonly source: DemoConnectedSource
  ) {}

  async connect(): Promise<void> {
    if (!this.source.answering) {
      throw new Error(DEMO_SOURCE_UNREACHABLE_MESSAGE);
    }
    // First pairing issues a scoped device token, exactly as a Gateway does
    // for a device it has never seen connecting from loopback.
    if (this.deviceToken === null) this.deviceToken = DEMO_DEVICE_TOKEN;
    this.status = 'connected';
  }

  disconnect(): void {
    this.status = 'disconnected';
  }

  getStatus(): string {
    return this.status;
  }

  async call<R = unknown>(method: string, params?: unknown): Promise<R> {
    return this.source.call(method, params) as R;
  }

  onOCEvent(): void {}
  offOCEvent(): void {}

  on(event: string, handler: (data: never) => void): void {
    if (event !== 'connection:status') return;
    this.statusHandlers.add(handler as unknown as (status: string) => void);
  }

  off(_event: string, handler: (data: never) => void): void {
    this.statusHandlers.delete(handler as unknown as (status: string) => void);
  }

  /** The socket dropping underneath a healthy session. */
  emitStatus(status: string): void {
    for (const handler of [...this.statusHandlers]) handler(status);
  }
}

/* ---- The Demo world ------------------------------------------------------ */

interface PendingTimer {
  fn: () => void;
}

class DemoLifecycleWorld implements LifecycleWorld {
  private readonly dir: string;
  private readonly demo: DemoConnectedSource;
  private clock = DEMO_CONNECTED_SOURCE_NOW_MS;

  private store: ConnectedSourceStore;
  private plans: FileConnectedAgentProjectionPlanStore;
  private currentRuntime: ConnectedSourceRuntime;
  private currentSourceId = '';

  private readonly timers = new Map<number, PendingTimer>();
  private nextTimerHandle = 1;
  private clients: DemoGatewayClient[] = [];
  private tunnels: FakeTunnelHandle[] = [];
  private sessions = new Map<string, ConnectedGatewaySession>();

  private constructor(dir: string) {
    this.dir = dir;
    this.demo = new DemoConnectedSource({ now: this.clock });
    this.store = this.createStore();
    this.plans = new FileConnectedAgentProjectionPlanStore(dir);
    this.currentRuntime = this.createRuntime();
  }

  static async open(): Promise<DemoLifecycleWorld> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-c3-contract-'));
    const world = new DemoLifecycleWorld(dir);
    await world.attach();
    return world;
  }

  /* ---- Construction ------------------------------------------------------ */

  private createStore(): ConnectedSourceStore {
    return new ConnectedSourceStore({
      userDataDir: this.dir,
      encryption: fakeEncryption(),
      now: () => this.clock,
    });
  }

  private createRuntime(): ConnectedSourceRuntime {
    return new ConnectedSourceRuntime({
      store: this.store,
      plans: this.plans,
      now: () => this.clock,
      createSession: (record, context) => this.createSession(record, context),
    });
  }

  private createSession(
    record: Parameters<
      NonNullable<
        ConstructorParameters<typeof ConnectedSourceRuntime>[0]['createSession']
      >
    >[0],
    context: Parameters<
      NonNullable<
        ConstructorParameters<typeof ConnectedSourceRuntime>[0]['createSession']
      >
    >[1]
  ): ConnectedSourceSession {
    const session = new ConnectedGatewaySession(record, {
      // What the last process saw behind this source, carried by the runtime.
      // Without it a relaunch has nothing to compare against.
      knownIdentity: context.knownIdentity,
      store: this.store,
      openTunnel: async () => {
        const handle = createFakeTunnel(DEMO_LOCAL_PORT + this.tunnels.length);
        this.tunnels.push(handle);
        return { ok: true, tunnel: handle.tunnel };
      },
      resolveCredential: async () => ({
        ok: true,
        facts: {
          version: null,
          gatewayPort: DEMO_REMOTE_PORT,
          // Used once to pair, never persisted. The Demo source models the
          // same custody rule the live one enforces.
          sharedToken: DEMO_SHARED_SECRET,
          tokenSource: 'config-file',
        },
      }),
      remoteExec: async () => {
        throw new Error(
          'The Demo adapter resolves its credential without executing anything.'
        );
      },
      createClient: config => {
        const client = new DemoGatewayClient(config, this.demo);
        this.clients.push(client);
        return client;
      },
      now: () => this.clock,
      setTimer: (fn: () => void) => {
        const handle = this.nextTimerHandle++;
        this.timers.set(handle, { fn });
        return handle;
      },
      clearTimer: (handle: unknown) => {
        this.timers.delete(handle as number);
      },
    });
    this.sessions.set(record.id, session);
    return session;
  }

  /** Connect the source and place its coworkers, as the Connect flow does. */
  private async attach(
    placement: Readonly<Record<string, { id: string; label: string }>> = {}
  ): Promise<void> {
    const added = this.store.add({
      adapterId: DEMO_ADAPTER_ID,
      placement: 'customer-hosted',
      displayName: DEMO_SOURCE_NAME,
      transport: {
        kind: 'ssh-alias',
        alias: DEMO_ALIAS,
        remotePort: DEMO_REMOTE_PORT,
      },
      credentialOwner: 'source-owned-ssh',
    });
    if (!added.ok) throw new Error(added.issues.join('; '));
    this.currentSourceId = added.record.id;

    const connected = await this.currentRuntime.connect(this.currentSourceId);
    if (!connected.ok) throw new Error(connected.message);

    const mapped = this.currentRuntime.mapAgents(
      this.currentSourceId,
      connected.agents
        .filter(agent => agent.discoveryState === 'configured')
        .map(agent => {
          const project =
            placement[agent.nativeAgentId] ??
            DEMO_PROJECT_BY_AGENT[agent.nativeAgentId] ??
            FALLBACK_PROJECT;
          return {
            nativeAgentId: agent.nativeAgentId,
            projectId: project.id,
            projectLabel: project.label,
            displayNameOverride: null,
          };
        })
    );
    if (!mapped.ok) throw new Error(mapped.issues.join('; '));
  }

  /* ---- Reading ----------------------------------------------------------- */

  runtime(): ConnectedSourceRuntime {
    return this.currentRuntime;
  }

  sourceId(): string {
    return this.currentSourceId;
  }

  declaredAdapterId(): AgentSourceAdapterId {
    return DEMO_ADAPTER_ID;
  }

  declaredEvidenceBasis(): AgentSourceEvidenceBasis {
    return this.demo.evidenceBasis;
  }

  recordedEvidenceBasis(): AgentSourceEvidenceBasis | null {
    return (
      this.sessions.get(this.currentSourceId)?.snapshot?.evidenceBasis ?? null
    );
  }

  mappings(): readonly ConnectedAgentMapping[] {
    return this.plans
      .read()
      .mappings.filter(
        mapping => mapping.configuredSourceId === this.currentSourceId
      );
  }

  configuredNativeAgentIds(): readonly string[] {
    return this.demo.configuredAgentIds;
  }

  sourceCalls(): readonly string[] {
    return this.demo.calls.map(call => call.method);
  }

  sourceAgentNames(): Readonly<Record<string, string>> {
    return this.demo.configuredAgentNames;
  }

  hasStoredCredential(): boolean {
    return this.store.readDeviceToken(this.currentSourceId) !== null;
  }

  /* ---- Levers ------------------------------------------------------------ */

  async reobserve(): Promise<void> {
    // The operator's own Reconnect: close the observation, then take one fresh
    // authoritative snapshot.
    await this.currentRuntime.disconnect(this.currentSourceId);
    this.advance(CLOCK_STEP_MS);
    await this.currentRuntime.connect(this.currentSourceId);
    await settle();
  }

  async loseConnection(): Promise<void> {
    this.demo.goAway();
    const client = this.clients[this.clients.length - 1];
    client?.emitStatus('disconnected');
    await settle();
  }

  async restoreConnection(): Promise<void> {
    this.demo.comeBack();
    this.advance(CLOCK_STEP_MS);
    await this.runReconnectLadder();
  }

  async restartSource(): Promise<void> {
    await this.loseConnection();
    this.demo.restart();
    await this.restoreConnection();
  }

  async restartSourceAsAnotherInstallation(): Promise<void> {
    await this.loseConnection();
    this.demo.restartAsAnotherInstallation();
    await this.restoreConnection();
  }

  async retireAgent(nativeAgentId: string): Promise<void> {
    this.demo.retireAgent(nativeAgentId);
  }

  async forgetOneSubordinateContext(nativeAgentId: string): Promise<string> {
    const prefix = `agent:${nativeAgentId}:`;
    const key = this.demo.retainedContextKeys.find(
      candidate => candidate.startsWith(prefix) && candidate !== `${prefix}main`
    );
    if (key === undefined) {
      throw new Error(
        `The Demo source retains no subordinate context for "${nativeAgentId}".`
      );
    }
    this.demo.forgetContext(key);
    return key;
  }

  async startRun(nativeAgentId: string): Promise<void> {
    this.demo.startRun(nativeAgentId);
  }

  async rename(input: LifecycleRenameInput): Promise<void> {
    // Exactly what the Connect flow's Project step writes: this source's whole
    // placement, with one row edited. `mapAgents` replaces a source's entries.
    const next = this.mappings().map(mapping =>
      mapping.nativeAgentId === input.nativeAgentId
        ? {
            nativeAgentId: mapping.nativeAgentId,
            projectId: input.projectId,
            projectLabel: input.projectLabel,
            displayNameOverride: input.displayNameOverride,
          }
        : {
            nativeAgentId: mapping.nativeAgentId,
            projectId: mapping.projectId,
            projectLabel: mapping.projectLabel,
            displayNameOverride: mapping.displayNameOverride,
          }
    );
    const result = this.currentRuntime.mapAgents(this.currentSourceId, next);
    if (!result.ok) throw new Error(result.issues.join('; '));
  }

  async relaunch(): Promise<void> {
    await this.currentRuntime.dispose();
    this.timers.clear();
    this.clients = [];
    this.tunnels = [];
    this.sessions = new Map();
    // The app was closed for a while, and the source kept working.
    this.advance(RELAUNCH_GAP_MS);
    this.store = this.createStore();
    this.plans = new FileConnectedAgentProjectionPlanStore(this.dir);
    this.currentRuntime = this.createRuntime();
    await this.currentRuntime.observeSavedSources();
    await settle();
  }

  async detach(): Promise<void> {
    // The detach IPC handler's own two steps, in its own order: the runtime
    // releases the session, its last snapshot, and this source's projection
    // rows, then the store removes the record and the credential.
    await this.currentRuntime.detach(this.currentSourceId);
    this.store.remove(this.currentSourceId);
  }

  async reattach(): Promise<void> {
    // Keep where the operator had already placed each coworker, so a
    // difference in the roster afterwards cannot be blamed on the Project step.
    const placement: Record<string, { id: string; label: string }> = {};
    for (const mapping of this.plans.read().mappings) {
      placement[mapping.nativeAgentId] = {
        id: mapping.projectId,
        label: mapping.projectLabel,
      };
    }
    this.advance(CLOCK_STEP_MS);
    await this.attach(placement);
    await settle();
  }

  async close(): Promise<void> {
    await this.currentRuntime.dispose();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /* ---- Internals --------------------------------------------------------- */

  private advance(ms: number): void {
    this.clock += ms;
    this.demo.advance(ms);
  }

  /**
   * Fire the reconnect ladder by hand until observation is back.
   *
   * Bounded, and it reports what it was waiting for rather than hanging: a
   * ladder that never reaches `connected` is a defect the test must name, not
   * a timeout somebody has to interpret.
   */
  private async runReconnectLadder(): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const session = this.sessions.get(this.currentSourceId);
      if (session?.phase === 'connected') return;
      const entry = [...this.timers.entries()][0];
      if (!entry) break;
      this.timers.delete(entry[0]);
      entry[1].fn();
      await settle();
    }
    const session = this.sessions.get(this.currentSourceId);
    if (session?.phase === 'connected') return;
    if (session?.identityDrift) return;
    throw new Error(
      `The reconnect ladder did not restore observation; it stopped at "${session?.phase ?? 'no session'}".`
    );
  }
}

/* ---- The adapter --------------------------------------------------------- */

const demoAdapter: ConnectedSourceLifecycleAdapter = {
  name: 'demo',
  supports: [
    'outage',
    'relaunch',
    'restart-same-identity',
    'restart-other-identity',
    'retire-agent',
    'forget-context',
    'run-state',
    'rename',
    'detach',
    'inspect-source',
  ],
  /*
   * What the shipping runtime does not keep yet, one sentence each. These are
   * runtime defects rather than Demo-adapter limitations: a live adapter that
   * ran this contract today would declare the same four, and the fifth is the
   * parity criterion this whole milestone exists for. Removing an entry after
   * the runtime is fixed is how the fix is proved.
   */
  // Every case the contract states is satisfied. The six gaps declared when it
  // was written are fixed rather than tolerated, so this is empty on purpose:
  // a new entry here is a promise the product is not keeping, and should be
  // read as debt rather than as configuration.
  knownGaps: {},
  open: () => DemoLifecycleWorld.open(),
};

/* ---- The run ------------------------------------------------------------- */

/**
 * Run the declared gaps as ordinary cases, so their exact assertion failures
 * are readable:
 *
 *   EXAWATT_CONTRACT_SHOW_GAPS=1 npx vitest run \
 *     electron/main/connected-source-lifecycle.contract.test.ts
 *
 * Off by default, because a suite that reports known gaps as failures is a
 * suite nobody can tell a regression from.
 */
const SHOW_GAPS = process.env.EXAWATT_CONTRACT_SHOW_GAPS === '1';

function runLifecycleContract(adapter: ConnectedSourceLifecycleAdapter): void {
  const supported = new Set(adapter.supports);

  describe(`connected-source lifecycle contract: ${adapter.name}`, () => {
    it('declares gaps against cases the contract actually has', () => {
      const known = new Set(LIFECYCLE_CONTRACT_CASE_IDS);
      for (const id of Object.keys(adapter.knownGaps)) {
        expect(
          known.has(id),
          `"${id}" is declared as a known gap but is not a case in the contract.`
        ).toBe(true);
      }
    });

    for (const contractCase of CONNECTED_SOURCE_LIFECYCLE_CONTRACT) {
      const missing = contractCase.requires.filter(
        lever => !supported.has(lever)
      );
      const gap = adapter.knownGaps[contractCase.id];
      const body = async (): Promise<void> => {
        const world = await adapter.open();
        try {
          await contractCase.run(world);
        } finally {
          await world.close();
        }
      };

      if (missing.length > 0) {
        it.skip(`${contractCase.title} [no ${missing.join(', ')} lever]`, body);
        continue;
      }
      if (gap !== undefined) {
        // Runs, and is expected to fail. When the runtime keeps the promise
        // this turns red, which is the signal to delete the declaration.
        const runner = SHOW_GAPS ? it : it.fails;
        runner(`${contractCase.title} [known gap: ${gap}]`, body);
        continue;
      }
      it(contractCase.title, body);
    }
  });
}

runLifecycleContract(demoAdapter);

/* ---- The contract itself ------------------------------------------------- */

describe('the lifecycle contract', () => {
  it('gives every case a unique id and a criterion it exists for', () => {
    const seen = new Set<string>();
    for (const contractCase of CONNECTED_SOURCE_LIFECYCLE_CONTRACT) {
      expect(seen.has(contractCase.id)).toBe(false);
      seen.add(contractCase.id);
      expect(contractCase.criterion.length).toBeGreaterThan(20);
      expect(contractCase.title.length).toBeGreaterThan(20);
    }
  });

  it('covers every lifecycle situation ENG-010 C3 names', () => {
    const covered = (prefix: string): LifecycleContractCase[] =>
      CONNECTED_SOURCE_LIFECYCLE_CONTRACT.filter(entry =>
        entry.id.startsWith(`${prefix}/`)
      );
    for (const situation of [
      'relaunch',
      'outage',
      'restart',
      'rename',
      'detach',
      'retirement',
      'contexts',
      'honesty',
      'identity',
    ]) {
      expect(
        covered(situation).length,
        `no case covers ${situation}`
      ).toBeGreaterThan(0);
    }
  });

  it('refuses a lever an adapter does not declare', () => {
    expect(() => unsupportedLever('outage')).toThrow(/declares no "outage"/u);
  });
});
