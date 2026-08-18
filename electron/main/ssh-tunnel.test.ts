import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSshArgs,
  classifySshStderr,
  openSshTunnel,
  type OpenSshTunnelResult,
  type SshTunnelFailure,
  type SshTunnelTarget,
  type SshTunnel,
} from './ssh-tunnel';

/**
 * Every identifier below is invented. Nothing in this file may name a real
 * host, address, user, or key path: this module is public and is scanned for
 * leaked infrastructure identifiers, and the redaction test at the bottom
 * depends on these fixtures being the only "infrastructure" words in scope.
 */
const ALIAS = 'build-box';
const FAKE_HOST = 'build-box.invalid';
const FAKE_USER = 'buildbot';
const FAKE_ADDRESS = '203.0.113.7';
const FAKE_KEY_PATH = '/home/buildbot/.ssh/id_fixture';

const AUTH_STDERR = `${FAKE_USER}@${FAKE_HOST}: Permission denied (publickey).`;
const RESOLVE_STDERR = `ssh: Could not resolve hostname ${FAKE_HOST}: Name or service not known`;
const FORWARD_STDERR =
  'channel 2: open failed: connect failed: Connection refused';
const BARE_REFUSED_STDERR = `ssh: connect to host ${FAKE_HOST} port 22: Connection refused`;

/**
 * A stand-in for the ssh child. No test in this file may spawn a real `ssh`:
 * that would reach the operator's network from a unit test. `openSshTunnel`
 * takes its spawn by injection precisely so this stays impossible here.
 */
class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stderr = Object.assign(new EventEmitter(), {
    setEncoding: () => undefined,
  });

  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    this.killed = true;
    // A real signal is asynchronous: the process ends on a later tick, and the
    // 'close' that shutdown waits on follows the 'exit'.
    queueMicrotask(() => this.exit(null, signal));
    return true;
  }

  writeStderr(text: string): void {
    this.stderr.emit('data', text);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

interface Harness {
  spawn: ReturnType<typeof vi.fn>;
  children: FakeChild[];
  open(
    overrides?: Partial<SshTunnelTarget>,
    probe?: () => Promise<boolean>
  ): Promise<OpenSshTunnelResult>;
}

const LOCAL_PORT = 52345;

function harness(options: { probeReady?: boolean } = {}): Harness {
  const children: FakeChild[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  return {
    spawn,
    children,
    open(overrides = {}, probe) {
      return openSshTunnel(
        { alias: ALIAS, remotePort: 8722, ...overrides },
        {
          spawn: spawn as unknown as typeof import('node:child_process').spawn,
          allocatePort: async () => LOCAL_PORT,
          probeLocalPort: probe ?? (async () => options.probeReady !== false),
        }
      );
    },
  };
}

function expectFailure(result: OpenSshTunnelResult): SshTunnelFailure {
  if (result.ok) throw new Error('Expected the tunnel open to fail');
  return result.failure;
}

function expectTunnel(result: OpenSshTunnelResult): SshTunnel {
  if (!result.ok) {
    throw new Error(`Expected an open tunnel, got ${result.failure.class}`);
  }
  return result.tunnel;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildSshArgs', () => {
  it('produces the exact hardened argument vector', () => {
    expect(
      buildSshArgs({ alias: ALIAS, remotePort: 8722 }, LOCAL_PORT)
    ).toEqual([
      '-N',
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-L',
      `127.0.0.1:${LOCAL_PORT}:127.0.0.1:8722`,
      '--',
      ALIAS,
    ]);
  });

  it('puts the alias last and behind the end-of-options marker', () => {
    const args = buildSshArgs({ alias: ALIAS, remotePort: 8722 }, LOCAL_PORT);
    expect(args[args.length - 1]).toBe(ALIAS);
    expect(args[args.length - 2]).toBe('--');
  });

  it('carries the explicit remote host and connect timeout', () => {
    const args = buildSshArgs(
      {
        alias: ALIAS,
        remotePort: 9001,
        remoteHost: '127.0.0.2',
        connectTimeoutSeconds: 25,
      },
      LOCAL_PORT
    );
    expect(args).toContain('ConnectTimeout=25');
    expect(args).toContain(`127.0.0.1:${LOCAL_PORT}:127.0.0.2:9001`);
  });
});

describe('target validation', () => {
  // A leading dash is the whole reason this validation exists: ssh reads
  // `-oProxyCommand=...` as an option, so an unvalidated alias is arbitrary
  // command execution on the operator's machine.
  const hostileAliases = [
    '-oProxyCommand=id',
    '-build-box',
    'a b',
    'a;b',
    'a$(id)',
    'a`id`',
    'a|b',
    'a/b',
    'a\nb',
    '',
    'a'.repeat(256),
  ];

  for (const alias of hostileAliases) {
    it(`rejects ${JSON.stringify(alias)} before spawning anything`, async () => {
      const fixture = harness();
      const failure = expectFailure(await fixture.open({ alias }));
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  const badPorts = [0, -1, 65_536, 1.5, Number.NaN, '8722'];
  for (const remotePort of badPorts) {
    it(`rejects remote port ${String(remotePort)} before spawning`, async () => {
      const fixture = harness();
      const failure = expectFailure(
        await fixture.open({ remotePort: remotePort as number })
      );
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  const badHosts = ['-oProxyCommand=id', 'not a host', 'a..b', '999.1.1.1', ''];
  for (const remoteHost of badHosts) {
    it(`rejects remote host ${JSON.stringify(remoteHost)} before spawning`, async () => {
      const fixture = harness();
      const failure = expectFailure(await fixture.open({ remoteHost }));
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  it('rejects an out-of-range connect timeout before spawning', async () => {
    const fixture = harness();
    const failure = expectFailure(
      await fixture.open({ connectTimeoutSeconds: 0 })
    );
    expect(failure.class).toBe('invalid-target');
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
});

describe('classifySshStderr', () => {
  it('classifies authentication refusals', () => {
    expect(classifySshStderr(AUTH_STDERR)).toBe('auth-rejected');
    expect(
      classifySshStderr('Received disconnect: Too many authentication failures')
    ).toBe('auth-rejected');
    expect(classifySshStderr('Host key verification failed.')).toBe(
      'auth-rejected'
    );
  });

  it('classifies transport failures', () => {
    expect(classifySshStderr(RESOLVE_STDERR)).toBe('host-unreachable');
    expect(classifySshStderr('ssh: connect: No route to host')).toBe(
      'host-unreachable'
    );
    expect(classifySshStderr('ssh: connect: Network is unreachable')).toBe(
      'host-unreachable'
    );
    expect(classifySshStderr('ssh: connect: Operation timed out')).toBe(
      'host-unreachable'
    );
    expect(classifySshStderr('ssh: connect: Connection timed out')).toBe(
      'host-unreachable'
    );
  });

  it('classifies forward failures', () => {
    expect(classifySshStderr(FORWARD_STDERR)).toBe('gateway-down');
    expect(
      classifySshStderr('channel 0: open failed: administratively prohibited')
    ).toBe('gateway-down');
    expect(classifySshStderr('bind: Address already in use')).toBe(
      'gateway-down'
    );
    expect(classifySshStderr('cannot listen to port: 52345')).toBe(
      'gateway-down'
    );
  });

  // The ordering trap. Both lines say "Connection refused", but one is the
  // forward failing on the far side and the other is the server itself being
  // unreachable, and they lead the operator to opposite remedies.
  it('separates a refused forward from a refused SSH connection', () => {
    expect(classifySshStderr(FORWARD_STDERR)).toBe('gateway-down');
    expect(classifySshStderr(BARE_REFUSED_STDERR)).toBe('host-unreachable');
  });

  it('falls through to unknown rather than guessing', () => {
    expect(classifySshStderr('')).toBe('unknown');
    expect(classifySshStderr('ssh exited for reasons of its own')).toBe(
      'unknown'
    );
  });
});

describe('openSshTunnel', () => {
  it('resolves with the allocated local port once the probe succeeds', async () => {
    const fixture = harness();
    const tunnel = expectTunnel(await fixture.open());

    expect(tunnel.localPort).toBe(LOCAL_PORT);
    expect(tunnel.closed).toBe(false);
    expect(fixture.spawn).toHaveBeenCalledTimes(1);

    const [command, args, options] = fixture.spawn.mock.calls[0] as [
      string,
      string[],
      { shell?: boolean },
    ];
    expect(command).toBe('ssh');
    expect(args).toEqual(
      buildSshArgs({ alias: ALIAS, remotePort: 8722 }, LOCAL_PORT)
    );
    // An argument array with shell: false. A command string would reintroduce
    // every injection this module exists to prevent.
    expect(options.shell).toBe(false);

    await tunnel.close();
  });

  it('retries the probe until the forward accepts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = harness();
    let answers = 0;
    const pending = fixture.open({}, async () => {
      answers += 1;
      return answers >= 3;
    });

    // Wait for the effect of each scheduled retry, not for a duration.
    await vi.advanceTimersByTimeAsync(1_000);
    const tunnel = expectTunnel(await pending);
    expect(answers).toBe(3);
    expect(tunnel.localPort).toBe(LOCAL_PORT);

    await tunnel.close();
  });

  it('classifies an authentication failure that exits before readiness', async () => {
    const fixture = harness({ probeReady: false });
    const pending = fixture.open();
    await vi.waitUntil(() => fixture.children.length === 1);
    const child = fixture.children[0];
    child.writeStderr(AUTH_STDERR);
    child.exit(255);

    expect(expectFailure(await pending).class).toBe('auth-rejected');
  });

  it('classifies a name-resolution failure as host-unreachable', async () => {
    const fixture = harness({ probeReady: false });
    const pending = fixture.open();
    await vi.waitUntil(() => fixture.children.length === 1);
    fixture.children[0].writeStderr(RESOLVE_STDERR);
    fixture.children[0].exit(255);

    expect(expectFailure(await pending).class).toBe('host-unreachable');
  });

  it('classifies a failed forward as gateway-down', async () => {
    const fixture = harness({ probeReady: false });
    const pending = fixture.open();
    await vi.waitUntil(() => fixture.children.length === 1);
    fixture.children[0].writeStderr(FORWARD_STDERR);
    fixture.children[0].exit(1);

    expect(expectFailure(await pending).class).toBe('gateway-down');
  });

  it('reads a bare refused connection as the server, not the Gateway', async () => {
    const fixture = harness({ probeReady: false });
    const pending = fixture.open();
    await vi.waitUntil(() => fixture.children.length === 1);
    fixture.children[0].writeStderr(BARE_REFUSED_STDERR);
    fixture.children[0].exit(255);

    expect(expectFailure(await pending).class).toBe('host-unreachable');
  });

  it('kills the child and reports host-unreachable when readiness times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = harness({ probeReady: false });
    const pending = fixture.open({ connectTimeoutSeconds: 5 });

    await vi.advanceTimersByTimeAsync(5_000 + 2_000 + 1);
    expect(expectFailure(await pending).class).toBe('host-unreachable');
    // No orphan: an ssh left alive would hold a loopback port and keep an
    // authenticated connection to the operator's server open unattended.
    expect(fixture.children[0].killed).toBe(true);
    expect(fixture.children[0].signals[0]).toBe('SIGTERM');
  });

  it('fails closed when the launch itself throws', async () => {
    const failure = expectFailure(
      await openSshTunnel(
        { alias: ALIAS, remotePort: 8722 },
        {
          spawn: (() => {
            throw new Error('spawn rejected');
          }) as unknown as typeof import('node:child_process').spawn,
          allocatePort: async () => LOCAL_PORT,
          probeLocalPort: async () => true,
        }
      )
    );
    expect(failure.class).toBe('invalid-target');
  });

  it('reports unknown when the child errors instead of exiting', async () => {
    const fixture = harness({ probeReady: false });
    const pending = fixture.open();
    await vi.waitUntil(() => fixture.children.length === 1);
    // A missing ssh binary arrives as an 'error' event, not stderr plus exit.
    fixture.children[0].emit('error', new Error('spawn ssh ENOENT'));

    expect(expectFailure(await pending).class).toBe('unknown');
  });

  it('fails closed when no local port can be reserved', async () => {
    const spawn = vi.fn();
    const failure = expectFailure(
      await openSshTunnel(
        { alias: ALIAS, remotePort: 8722 },
        {
          spawn: spawn as unknown as typeof import('node:child_process').spawn,
          allocatePort: async () => {
            throw new Error('no port');
          },
          probeLocalPort: async () => true,
        }
      )
    );
    expect(failure.class).toBe('invalid-target');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('tunnel lifecycle', () => {
  it('closes idempotently and reports a deliberate close as no failure', async () => {
    const fixture = harness();
    const tunnel = expectTunnel(await fixture.open());
    const seen: Array<SshTunnelFailure | null> = [];
    tunnel.onClosed(outcome => seen.push(outcome));

    await tunnel.close();
    await tunnel.close();

    expect(seen).toEqual([null]);
    expect(tunnel.closed).toBe(true);
    expect(fixture.children[0].signals).toEqual(['SIGTERM']);
  });

  it('reports an unexpected death with its classified failure', async () => {
    const fixture = harness();
    const tunnel = expectTunnel(await fixture.open());
    const seen: Array<SshTunnelFailure | null> = [];
    tunnel.onClosed(outcome => seen.push(outcome));

    fixture.children[0].writeStderr(FORWARD_STDERR);
    fixture.children[0].exit(1);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.class).toBe('gateway-down');
    expect(tunnel.closed).toBe(true);

    // Closing an already dead tunnel neither rewrites the outcome nor hangs.
    await tunnel.close();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.class).toBe('gateway-down');
  });

  it('stops notifying an unsubscribed listener and answers late subscribers', async () => {
    const fixture = harness();
    const tunnel = expectTunnel(await fixture.open());
    const seen: Array<SshTunnelFailure | null> = [];
    const unsubscribe = tunnel.onClosed(outcome => seen.push(outcome));
    unsubscribe();

    await tunnel.close();
    expect(seen).toEqual([]);

    const late: Array<SshTunnelFailure | null> = [];
    tunnel.onClosed(outcome => late.push(outcome));
    expect(late).toEqual([null]);
  });
});

describe('redaction invariant', () => {
  it('never echoes infrastructure identity into an operator-facing message', async () => {
    const secrets = [
      ALIAS,
      FAKE_HOST,
      FAKE_USER,
      FAKE_ADDRESS,
      FAKE_KEY_PATH,
      'id_fixture',
      '.ssh',
      'publickey',
      'port 22',
    ];

    const messages: string[] = [];

    // Every reachable failure path, each fed stderr full of identity.
    const stderrCases = [
      `${AUTH_STDERR}\ndebug1: identity file ${FAKE_KEY_PATH}`,
      `${RESOLVE_STDERR}\ndebug1: ${FAKE_ADDRESS}`,
      `${FORWARD_STDERR}\ndebug1: connecting to ${FAKE_HOST}`,
      `${BARE_REFUSED_STDERR}`,
      `ssh: something unclassifiable about ${FAKE_USER}@${FAKE_ADDRESS}`,
    ];

    for (const stderr of stderrCases) {
      const fixture = harness({ probeReady: false });
      const pending = fixture.open();
      await vi.waitUntil(() => fixture.children.length === 1);
      fixture.children[0].writeStderr(stderr);
      fixture.children[0].exit(255);
      messages.push(expectFailure(await pending).message);
    }

    const invalid = harness();
    messages.push(
      expectFailure(
        await invalid.open({ alias: `-oProxyCommand=${FAKE_HOST}` })
      ).message
    );

    // An unexpected death after readiness is the other message-producing path.
    const live = harness();
    const tunnel = expectTunnel(await live.open());
    const outcomes: Array<SshTunnelFailure | null> = [];
    tunnel.onClosed(outcome => outcomes.push(outcome));
    live.children[0].writeStderr(`${AUTH_STDERR} using ${FAKE_KEY_PATH}`);
    live.children[0].exit(255);
    messages.push(outcomes[0]?.message ?? '');

    expect(messages).toHaveLength(7);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(200);
      // No em dashes in operator-facing copy.
      expect(message).not.toContain('—');
      for (const secret of secrets) {
        expect(message.toLowerCase()).not.toContain(secret.toLowerCase());
      }
    }
  });
});
