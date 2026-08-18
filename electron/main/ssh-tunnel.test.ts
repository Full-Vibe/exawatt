import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDestinationArgs,
  buildSshArgs,
  classifySshStderr,
  openSshTunnel,
  resolveSshDestination,
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
const FAKE_SSH_PORT = 2202;

/** The two shapes a configured source can be saved with. */
const ALIAS_TARGET: SshTunnelTarget = {
  kind: 'ssh-alias',
  alias: ALIAS,
  remotePort: 8722,
};
const MANUAL_TARGET: SshTunnelTarget = {
  kind: 'ssh-manual',
  host: FAKE_HOST,
  user: FAKE_USER,
  port: FAKE_SSH_PORT,
  identityFile: FAKE_KEY_PATH,
  remotePort: 8722,
};

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
  /** The alias target with fields replaced. */
  open(
    overrides?: Record<string, unknown>,
    probe?: () => Promise<boolean>
  ): Promise<OpenSshTunnelResult>;
  /** The manual target with fields replaced. */
  openManual(
    overrides?: Record<string, unknown>,
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
  const openWith = (
    base: SshTunnelTarget,
    overrides: Record<string, unknown>,
    probe?: () => Promise<boolean>
  ) =>
    openSshTunnel({ ...base, ...overrides } as SshTunnelTarget, {
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      allocatePort: async () => LOCAL_PORT,
      probeLocalPort: probe ?? (async () => options.probeReady !== false),
    });
  return {
    spawn,
    children,
    open: (overrides = {}, probe) => openWith(ALIAS_TARGET, overrides, probe),
    openManual: (overrides = {}, probe) =>
      openWith(MANUAL_TARGET, overrides, probe),
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
    expect(buildSshArgs(ALIAS_TARGET, LOCAL_PORT)).toEqual([
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
      '-o',
      'ControlMaster=no',
      '-o',
      'ControlPath=none',
      '-L',
      `127.0.0.1:${LOCAL_PORT}:127.0.0.1:8722`,
      '--',
      ALIAS,
    ]);
  });

  it('refuses connection multiplexing so close() owns the forward', () => {
    // With a shared control master the forward outlives this child, so a
    // detach would leave a port open to the operator's server.
    const args = buildSshArgs(ALIAS_TARGET, LOCAL_PORT);
    expect(args).toContain('ControlMaster=no');
    expect(args).toContain('ControlPath=none');
  });

  it('puts the alias last and behind the end-of-options marker', () => {
    const args = buildSshArgs(ALIAS_TARGET, LOCAL_PORT);
    expect(args[args.length - 1]).toBe(ALIAS);
    expect(args[args.length - 2]).toBe('--');
  });

  it('carries the explicit remote host and connect timeout', () => {
    const args = buildSshArgs(
      {
        ...ALIAS_TARGET,
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

describe('buildSshArgs for a manually entered server', () => {
  it('produces the exact hardened argument vector', () => {
    expect(buildSshArgs(MANUAL_TARGET, LOCAL_PORT)).toEqual([
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
      '-o',
      'ControlMaster=no',
      '-o',
      'ControlPath=none',
      '-L',
      `127.0.0.1:${LOCAL_PORT}:127.0.0.1:8722`,
      '-p',
      String(FAKE_SSH_PORT),
      '-o',
      'IdentitiesOnly=yes',
      '-i',
      FAKE_KEY_PATH,
      '--',
      `${FAKE_USER}@${FAKE_HOST}`,
    ]);
  });

  it('refuses connection multiplexing on this path too', () => {
    // The same live finding applies: a shared control master would own the
    // forward, so a detach would leave a port open on the operator's server.
    const args = buildSshArgs(MANUAL_TARGET, LOCAL_PORT);
    expect(args).toContain('ControlMaster=no');
    expect(args).toContain('ControlPath=none');
  });

  it('puts the destination last, behind the end-of-options marker', () => {
    const args = buildSshArgs(MANUAL_TARGET, LOCAL_PORT);
    expect(args[args.length - 1]).toBe(`${FAKE_USER}@${FAKE_HOST}`);
    expect(args[args.length - 2]).toBe('--');
    // The key is an option, so it must be ahead of the marker.
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('--'));
    expect(args[args.indexOf('-i') + 1]).toBe(FAKE_KEY_PATH);
  });

  it('omits -i entirely when the source names no key file', () => {
    const args = buildSshArgs(
      { ...MANUAL_TARGET, identityFile: null },
      LOCAL_PORT
    );
    expect(args).not.toContain('-i');
    expect(args).not.toContain('IdentitiesOnly=yes');
    expect(args[args.length - 1]).toBe(`${FAKE_USER}@${FAKE_HOST}`);
  });

  it('builds a destination tail with no shell interpolation anywhere', () => {
    // Every element is a separate argv entry; nothing is joined into a string.
    expect(buildDestinationArgs(MANUAL_TARGET)).toEqual([
      '-p',
      String(FAKE_SSH_PORT),
      '-o',
      'IdentitiesOnly=yes',
      '-i',
      FAKE_KEY_PATH,
      '--',
      `${FAKE_USER}@${FAKE_HOST}`,
    ]);
    expect(buildDestinationArgs(ALIAS_TARGET)).toEqual(['--', ALIAS]);
  });

  it('throws rather than building anything for an unusable destination', () => {
    expect(() =>
      buildDestinationArgs({
        kind: 'ssh-manual',
        host: '-oProxyCommand=id',
        user: FAKE_USER,
        port: FAKE_SSH_PORT,
        identityFile: null,
      })
    ).toThrow();
  });

  it('drops unknown fields instead of carrying them toward ssh', () => {
    const resolved = resolveSshDestination({
      ...MANUAL_TARGET,
      proxyCommand: 'id',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(Object.keys(resolved.destination).sort()).toEqual([
      'host',
      'identityFile',
      'kind',
      'port',
      'user',
    ]);
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

/**
 * The manual path takes four operator-typed values instead of one, so it has
 * four ways to become command execution on this machine. Each case below
 * asserts the same thing the alias cases do: the refusal happens BEFORE a
 * process exists, not after ssh has already been handed the argument.
 */
describe('manual target validation', () => {
  const hostileHosts: ReadonlyArray<[string, string]> = [
    ['a proxy-command option', '-oProxyCommand=id'],
    ['a leading dash', '-build-box'],
    ['a command separator', 'build-box.invalid;id'],
    ['a substitution', 'build-box$(id).invalid'],
    ['whitespace', 'build box'],
    ['an empty label', 'a..b'],
    ['a mistyped address', '999.1.1.1'],
    ['a port suffix', 'build-box.invalid:22'],
    ['empty', ''],
  ];
  for (const [label, host] of hostileHosts) {
    it(`rejects ${label} as a host before spawning anything`, async () => {
      const fixture = harness();
      const failure = expectFailure(await fixture.openManual({ host }));
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  const hostileUsers: ReadonlyArray<[string, string]> = [
    ['a proxy-command option', '-oProxyCommand=id'],
    ['a second destination', 'buildbot@build-box.invalid'],
    ['whitespace', 'build bot'],
    ['a command separator', 'buildbot;id'],
    ['a pipe', 'buildbot|id'],
    ['a path separator', 'build/bot'],
    ['empty', ''],
    ['over length', 'b'.repeat(65)],
  ];
  for (const [label, user] of hostileUsers) {
    it(`rejects ${label} as a login before spawning anything`, async () => {
      const fixture = harness();
      const failure = expectFailure(await fixture.openManual({ user }));
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  const hostilePorts: ReadonlyArray<[string, unknown]> = [
    ['zero', 0],
    ['negative', -1],
    ['above the range', 65_536],
    ['fractional', 1.5],
    ['not a number', Number.NaN],
    ['a string', '2202'],
    ['absent', undefined],
  ];
  for (const [label, port] of hostilePorts) {
    it(`rejects ${label} as an SSH port before spawning anything`, async () => {
      const fixture = harness();
      const failure = expectFailure(await fixture.openManual({ port }));
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  const hostileIdentityFiles: ReadonlyArray<[string, string]> = [
    ['a proxy-command option', '-oProxyCommand=id'],
    ['a bare option', '-i'],
    ['a relative path', 'keys/id_fixture'],
    ['an unexpanded home path', '~/keys/id_fixture'],
    ['a second argument smuggled in', '/tmp/id_fixture -oProxyCommand=id'],
    ['a newline', '/tmp/id_fixture\nProxyCommand id'],
    ['empty', ''],
    ['over length', `/${'k'.repeat(600)}`],
  ];
  for (const [label, identityFile] of hostileIdentityFiles) {
    it(`rejects ${label} as a key file before spawning anything`, async () => {
      const fixture = harness();
      const failure = expectFailure(await fixture.openManual({ identityFile }));
      expect(failure.class).toBe('invalid-target');
      expect(fixture.spawn).not.toHaveBeenCalled();
    });
  }

  it('accepts a whole, ordinary manual target and spawns exactly once', async () => {
    const fixture = harness();
    const tunnel = expectTunnel(await fixture.openManual());

    expect(fixture.spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = fixture.spawn.mock.calls[0] as [
      string,
      string[],
      { shell?: boolean },
    ];
    expect(command).toBe('ssh');
    expect(args).toEqual(buildSshArgs(MANUAL_TARGET, LOCAL_PORT));
    expect(options.shell).toBe(false);

    await tunnel.close();
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

  // Only a manually entered server names a key file, so only it can fail this
  // way. Without these the operator is told to open diagnostics when the real
  // answer is the key path they just typed.
  it('classifies the key-file failures only the manual path can produce', () => {
    expect(
      classifySshStderr(
        `Warning: Identity file ${FAKE_KEY_PATH} not accessible: No such file or directory.`
      )
    ).toBe('auth-rejected');
    expect(classifySshStderr(`no such identity: ${FAKE_KEY_PATH}`)).toBe(
      'auth-rejected'
    );
    expect(
      classifySshStderr(`Load key "${FAKE_KEY_PATH}": bad permissions`)
    ).toBe('auth-rejected');
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
    expect(args).toEqual(buildSshArgs(ALIAS_TARGET, LOCAL_PORT));
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
      await openSshTunnel(ALIAS_TARGET, {
        spawn: (() => {
          throw new Error('spawn rejected');
        }) as unknown as typeof import('node:child_process').spawn,
        allocatePort: async () => LOCAL_PORT,
        probeLocalPort: async () => true,
      })
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
      await openSshTunnel(ALIAS_TARGET, {
        spawn: spawn as unknown as typeof import('node:child_process').spawn,
        allocatePort: async () => {
          throw new Error('no port');
        },
        probeLocalPort: async () => true,
      })
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

    // The manual path has four ways to be refused, and each one is handed the
    // operator's own infrastructure identity as the rejected value.
    const manualRejections: Record<string, unknown>[] = [
      { host: `-oProxyCommand=${FAKE_HOST}` },
      { user: `${FAKE_USER}@${FAKE_HOST}` },
      { port: '22' },
      { identityFile: FAKE_KEY_PATH.slice(1) },
    ];
    for (const overrides of manualRejections) {
      const rejected = harness();
      messages.push(
        expectFailure(await rejected.openManual(overrides)).message
      );
      expect(rejected.spawn).not.toHaveBeenCalled();
    }

    // And an ssh death on the manual path, with a key path in its stderr.
    const manual = harness({ probeReady: false });
    const manualPending = manual.openManual();
    await vi.waitUntil(() => manual.children.length === 1);
    manual.children[0].writeStderr(
      `Warning: Identity file ${FAKE_KEY_PATH} not accessible: No such file or directory.\n${AUTH_STDERR}`
    );
    manual.children[0].exit(255);
    messages.push(expectFailure(await manualPending).message);

    // An unexpected death after readiness is the other message-producing path.
    const live = harness();
    const tunnel = expectTunnel(await live.open());
    const outcomes: Array<SshTunnelFailure | null> = [];
    tunnel.onClosed(outcome => outcomes.push(outcome));
    live.children[0].writeStderr(`${AUTH_STDERR} using ${FAKE_KEY_PATH}`);
    live.children[0].exit(255);
    messages.push(outcomes[0]?.message ?? '');

    expect(messages).toHaveLength(12);
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
