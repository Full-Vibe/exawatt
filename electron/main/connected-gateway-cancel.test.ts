import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OCClient, type OCClientConfig } from '@exawatt/core';
import { ConnectedGatewaySession } from './connected-gateway';
import { FileConnectedAgentProjectionPlanStore } from './connected-agent-projection-plan';
import { ConnectedSourceRuntime } from './connected-source-runtime';
import { ConnectedSourceStore } from './connected-source-store';
import {
  createSshRemoteExec,
  resolveGatewayCredential,
} from './gateway-bootstrap';
import { openSshTunnel, type SshTunnelTarget } from './ssh-tunnel';

/**
 * Cancelling a Connect at every point it can be cancelled (pre-0.1.14 review).
 *
 * Nothing here is a double of the thing under test. The session opens a real
 * tunnel through the real tunnel owner, reads the source's configuration
 * through the real remote exec, and pairs with the real protocol client
 * against a real WebSocket peer. The two stand-ins are the ones the Connect
 * eval already uses: `connect-eval-ssh.mjs` answers exactly as `ssh` does for
 * the tunnel and the configuration read, and `ConnectedGatewayFixture` is the
 * Gateway on the far side of it. So a child process and a socket are real
 * objects here, and "nothing survives" is asserted on them directly: the
 * `ssh` child has exited, and the Gateway has watched every socket close.
 *
 * Each case cancels from inside the step it names, the way an operator's
 * Cancel lands while a Connect is waiting on the network.
 */

const REPO = path.resolve(__dirname, '..', '..');
const STAND_IN_SSH = path.join(REPO, 'scripts/lib/connect-eval-ssh.mjs');
const FIXTURE_MODULE = path.join(
  REPO,
  'scripts/lib/connected-gateway-fixture.mjs'
);
const ALIAS = 'voltaic-cancel-demo';
const DEFAULT_GATEWAY_PORT = 18_789;

/** The part of the fixture this file drives. It is plain JavaScript. */
interface GatewayFixture {
  port: number | null;
  sharedToken: string;
  devices: Map<string, unknown>;
  start(): Promise<number>;
  close(): Promise<void>;
  accept(socket: FixtureSocket): void;
  connect(socket: FixtureSocket, request: unknown): void;
  read(method: string, params?: unknown): unknown;
}
interface FixtureSocket {
  once(event: 'close', listener: () => void): void;
}
type FixtureConstructor = new (options: {
  label: string;
  agents: { id: string; name: string; hasPrimaryConversation: boolean }[];
}) => GatewayFixture;

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

type CancelPoint =
  | 'configuration read'
  | 'tunnel open'
  | 'handshake'
  | 'discovery'
  | 'conversation follow';

const CANCEL_POINTS: readonly CancelPoint[] = [
  'configuration read',
  'tunnel open',
  'handshake',
  'discovery',
  'conversation follow',
];

interface World {
  dir: string;
  fixture: GatewayFixture;
  store: ConnectedSourceStore;
  plans: FileConnectedAgentProjectionPlanStore;
  sourceId: string;
  children: ChildProcess[];
  sockets: Promise<void>[];
  /** Runs once, at the named point. */
  arm(point: CancelPoint, cancel: () => void): void;
  sessionDeps(): ConstructorParameters<typeof ConnectedGatewaySession>[1];
}

let world: World;

beforeEach(async () => {
  const { ConnectedGatewayFixture } = (await import(
    pathToFileURL(FIXTURE_MODULE).href
  )) as { ConnectedGatewayFixture: FixtureConstructor };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-cancel-'));
  const fixture = new ConnectedGatewayFixture({
    label: 'Cancel fixture',
    agents: [{ id: 'marcus', name: 'Marcus', hasPrimaryConversation: true }],
  });
  const port = await fixture.start();

  const configPath = path.join(dir, 'ssh.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      hosts: { [ALIAS]: { port, token: fixture.sharedToken } },
      logPath: path.join(dir, 'ssh.jsonl'),
      controlUrl: 'http://127.0.0.1:9',
    })
  );

  const children: ChildProcess[] = [];
  const spawn = ((
    _command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => {
    const child = nodeSpawn(process.execPath, [STAND_IN_SSH, ...args], {
      ...options,
      env: { ...process.env, CONNECT_EVAL_SSH_CONFIG: configPath },
    });
    children.push(child);
    return child;
  }) as typeof nodeSpawn;

  const sockets: Promise<void>[] = [];
  const accept = fixture.accept.bind(fixture);
  fixture.accept = socket => {
    sockets.push(new Promise(resolve => socket.once('close', resolve)));
    accept(socket);
  };

  const armed = new Map<CancelPoint, () => void>();
  const fire = (point: CancelPoint) => {
    const cancel = armed.get(point);
    armed.delete(point);
    cancel?.();
  };
  const connect = fixture.connect.bind(fixture);
  fixture.connect = (socket, request) => {
    fire('handshake');
    connect(socket, request);
  };
  const read = fixture.read.bind(fixture);
  fixture.read = (method, params) => {
    if (method === 'agents.list') fire('discovery');
    if (method === 'sessions.messages.subscribe') fire('conversation follow');
    return read(method, params);
  };

  const store = new ConnectedSourceStore({
    userDataDir: dir,
    encryption: fakeEncryption(),
  });
  const added = store.add({
    adapterId: 'openclaw',
    placement: 'customer-hosted',
    displayName: 'Cancel demo',
    transport: {
      kind: 'ssh-alias',
      alias: ALIAS,
      remotePort: DEFAULT_GATEWAY_PORT,
    },
    credentialOwner: 'source-owned-ssh',
  });
  if (!added.ok) throw new Error(added.issues.join(', '));

  const remoteExec = createSshRemoteExec({ spawn });
  world = {
    dir,
    fixture,
    store,
    plans: new FileConnectedAgentProjectionPlanStore(dir),
    sourceId: added.record.id,
    children,
    sockets,
    arm(point, cancel) {
      armed.set(point, cancel);
    },
    sessionDeps: () => ({
      store,
      openTunnel: async (target: SshTunnelTarget) => {
        const opening = openSshTunnel(target, { spawn });
        // The child is running and the forward is not up yet.
        fire('tunnel open');
        return opening;
      },
      resolveCredential: async (transport, dependencies) => {
        const reading = resolveGatewayCredential(transport, dependencies);
        fire('configuration read');
        return reading;
      },
      remoteExec,
      createClient: (config: OCClientConfig) => new OCClient(config),
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: handle => clearTimeout(handle as NodeJS.Timeout),
      maxReconnectAttempts: 0,
    }),
  };
});

afterEach(async () => {
  for (const child of world.children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await world.fixture.close();
  fs.rmSync(world.dir, { recursive: true, force: true });
});

function tunnelChildren(): ChildProcess[] {
  return world.children.filter(child => child.spawnargs.includes('-N'));
}

/** Nothing the attempt opened is still open. */
async function expectNothingSurvives(): Promise<void> {
  for (const child of world.children) {
    expect(
      child.exitCode !== null || child.signalCode !== null,
      `ssh ${child.spawnargs.slice(2).join(' ')} is still running`
    ).toBe(true);
  }
  // The Gateway's own view: every socket anyone opened to it has closed. A
  // leaked socket never resolves here, and the case fails on its timeout.
  await Promise.all(world.sockets);
}

describe('a Connect cancelled mid-flight', () => {
  it('reaches every cancel point on an uncancelled Connect', async () => {
    // The premise of every case below: each point is on the path. A point
    // the flow stopped passing would make its case pass without cancelling.
    const session = new ConnectedGatewaySession(
      world.store.get(world.sourceId)!,
      world.sessionDeps()
    );
    const reached = new Set<CancelPoint>();
    for (const point of CANCEL_POINTS) {
      world.arm(point, () => reached.add(point));
    }
    const result = await session.connect();
    expect(result.outcome).toBe('connected');
    expect([...reached].sort()).toEqual([...CANCEL_POINTS].sort());
    await session.disconnect();
    await expectNothingSurvives();
  });

  for (const point of CANCEL_POINTS) {
    it(`closes everything when Disconnect lands during the ${point}`, async () => {
      const session = new ConnectedGatewaySession(
        world.store.get(world.sourceId)!,
        world.sessionDeps()
      );
      let disconnecting: Promise<void> | null = null;
      world.arm(point, () => {
        disconnecting = session.disconnect();
      });

      const result = await session.connect();
      await disconnecting;

      await expectNothingSurvives();
      expect(result.outcome).toBe('cancelled');
      expect(session.phase).toBe('idle');
      expect(session.status().state).not.toBe('live');
      if (point !== 'configuration read') {
        expect(tunnelChildren()).toHaveLength(1);
      } else {
        // Overtaken before the forward: none was ever started.
        expect(tunnelChildren()).toHaveLength(0);
      }
    });
  }

  it('stays closed when a newer Connect overtakes it, and the newer one lives', async () => {
    const session = new ConnectedGatewaySession(
      world.store.get(world.sourceId)!,
      world.sessionDeps()
    );
    let reconnecting: ReturnType<typeof session.connect> | null = null;
    world.arm('tunnel open', () => {
      reconnecting = session.connect();
    });

    const first = await session.connect();
    const second = await reconnecting!;

    expect(first.outcome).toBe('cancelled');
    expect(second.outcome).toBe('connected');
    expect(session.phase).toBe('connected');
    // Two forwards were started; only the newer one may still be running.
    const running = tunnelChildren().filter(
      child => child.exitCode === null && child.signalCode === null
    );
    expect(tunnelChildren()).toHaveLength(2);
    expect(running).toHaveLength(1);
    expect(running[0]).toBe(tunnelChildren()[1]);

    await session.disconnect();
    await expectNothingSurvives();
  });

  for (const point of ['handshake', 'discovery'] as const) {
    it(`leaves no credential or binding behind when Detach lands during the ${point}`, async () => {
      const runtime = new ConnectedSourceRuntime({
        store: world.store,
        plans: world.plans,
        createSession: (record, context) =>
          new ConnectedGatewaySession(record, {
            ...world.sessionDeps(),
            knownIdentity: context.knownIdentity,
          }),
        now: Date.now,
      });
      let detaching: Promise<void> | null = null;
      world.arm(point, () => {
        // The order the IPC handler uses: the runtime lets go, then the
        // store removes the record and its credential.
        detaching = runtime.detach(world.sourceId).then(() => {
          world.store.remove(world.sourceId);
        });
      });

      const result = await runtime.connect(world.sourceId);
      await detaching;

      expect(result.ok).toBe(false);
      expect(!result.ok && result.outcome).toBe('cancelled');
      expect(world.store.get(world.sourceId)).toBeNull();
      expect(world.store.readDeviceToken(world.sourceId)).toBeNull();
      expect(world.store.readDeviceKeypair(world.sourceId)).toBeNull();
      expect(world.plans.read().boundIdentities).not.toHaveProperty(
        world.sourceId
      );
      await expectNothingSurvives();
      await runtime.dispose();
    });
  }
});
