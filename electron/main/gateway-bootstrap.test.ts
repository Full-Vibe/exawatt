import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapGatewayCredential,
  buildRemoteExecArgs,
  createSshRemoteExec,
  FALLBACK_GATEWAY_PORT,
  parseConfigToken,
  parseGatewayPort,
  parseOpenClawVersion,
  type RemoteExec,
  type RemoteExecResult,
} from './gateway-bootstrap';

vi.mock('electron', () => ({}));

/**
 * Invented fixtures only. Nothing in this file may carry a real hostname, IP,
 * username, key path, or token: this module's whole job is to keep those out of
 * anything Exawatt returns, and a test fixture is as public as the source.
 */
const ALIAS = 'build-box';
const FAKE_HOST = 'build-box.invalid';
const FAKE_USER = 'fixture-operator';
const CLI_TOKEN = 'cli-fixture-token-0001';
const FILE_TOKEN = 'file-fixture-token-0002';

const VERSION_PRINT = 'OpenClaw 2026.7.1-2 (abc1234)\n';

const PLAIN_CONFIG = JSON.stringify({
  gateway: { port: 4242, auth: { mode: 'token', token: FILE_TOKEN } },
});

/**
 * The install shape where the config names WHERE the secret lives rather than
 * holding it. The literal token is genuinely absent from the file.
 */
const INDIRECTION_CONFIG = JSON.stringify({
  gateway: {
    port: 4242,
    auth: {
      token: { source: 'file', provider: 'gateway_auth_token', id: 'value' },
    },
  },
});

interface ExecCall {
  alias: string;
  argv: readonly string[];
}

type Responder = (
  argv: readonly string[]
) => Partial<RemoteExecResult> | undefined;

/**
 * A recording stand-in for the SSH leg. No test in this file may spawn a real
 * `ssh`: that would reach a real network from a unit test.
 */
function fakeExec(responder: Responder): {
  exec: RemoteExec;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec: RemoteExec = async (alias, argv) => {
    calls.push({ alias, argv });
    const answer = responder(argv) ?? {};
    return {
      // Explicit null means "killed at the deadline" and must survive here.
      code: answer.code === undefined ? 0 : answer.code,
      stdout: answer.stdout ?? '',
      stderr: answer.stderr ?? '',
    };
  };
  return { exec, calls };
}

/** The happy path every failure test perturbs one step of. */
function healthyResponder(overrides: Responder = () => undefined): Responder {
  return argv => {
    const explicit = overrides(argv);
    if (explicit) return explicit;
    const command = argv.join(' ');
    if (command === 'openclaw --version') return { stdout: VERSION_PRINT };
    if (command === 'openclaw config get gateway.auth.token') {
      return { stdout: `${CLI_TOKEN}\n` };
    }
    if (command === 'cat .openclaw/openclaw.json')
      return { stdout: PLAIN_CONFIG };
    return { code: 127, stderr: 'command not found' };
  };
}

describe('buildRemoteExecArgs', () => {
  it('places -- before the alias and the remote command after it', () => {
    const args = buildRemoteExecArgs(ALIAS, ['openclaw', '--version']);
    expect(args).toEqual([
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '--',
      ALIAS,
      'openclaw',
      '--version',
    ]);
    expect(args.indexOf('--')).toBeLessThan(args.indexOf(ALIAS));
  });

  it('never prompts and never allocates a TTY', () => {
    const args = buildRemoteExecArgs(ALIAS, ['openclaw', '--version']);
    expect(args).toContain('-T');
    expect(args).toContain('BatchMode=yes');
    expect(args.some(arg => arg.startsWith('ConnectTimeout='))).toBe(true);
  });

  it.each([
    '-oProxyCommand=id',
    '-J other',
    'a b',
    'a;b',
    'a|b',
    'a$b',
    '',
    'x'.repeat(256),
  ])('refuses to build a command for alias %j', alias => {
    expect(() => buildRemoteExecArgs(alias, ['openclaw'])).toThrow();
  });

  it.each([
    ';id',
    'a;b',
    'a|b',
    'a&b',
    '$(id)',
    '`id`',
    'a\nb',
    "a'b",
    'a"b',
    'a>b',
    'a<b',
    'a b',
    'a*b',
    'a\\b',
    '~/x',
    '#x',
  ])('refuses a remote argument containing %j', argument => {
    expect(() => buildRemoteExecArgs(ALIAS, ['cat', argument])).toThrow();
  });

  it('refuses an empty or oversized remote command', () => {
    expect(() => buildRemoteExecArgs(ALIAS, [])).toThrow();
    expect(() =>
      buildRemoteExecArgs(ALIAS, new Array(64).fill('openclaw'))
    ).toThrow();
  });

  it('accepts the punctuation the bootstrap commands actually need', () => {
    expect(() =>
      buildRemoteExecArgs(ALIAS, [
        'openclaw',
        'config',
        'get',
        'gateway.auth.token',
      ])
    ).not.toThrow();
    expect(() =>
      buildRemoteExecArgs(ALIAS, ['cat', '.openclaw/openclaw.json'])
    ).not.toThrow();
  });
});

describe('parseConfigToken', () => {
  it('reads a plain string token', () => {
    expect(parseConfigToken(PLAIN_CONFIG)).toBe(FILE_TOKEN);
  });

  it('trims surrounding whitespace', () => {
    const text = JSON.stringify({
      gateway: { auth: { token: `  ${FILE_TOKEN} ` } },
    });
    expect(parseConfigToken(text)).toBe(FILE_TOKEN);
  });

  it('returns null for the indirection object, since the secret is not there', () => {
    expect(parseConfigToken(INDIRECTION_CONFIG)).toBeNull();
  });

  it('reads the older shape where auth names the mode and the token sits beside it', () => {
    const text = JSON.stringify({
      gateway: { auth: 'token', token: FILE_TOKEN },
    });
    expect(parseConfigToken(text)).toBe(FILE_TOKEN);
  });

  it('rejects an empty, non-string, or oversized token', () => {
    expect(
      parseConfigToken(JSON.stringify({ gateway: { auth: { token: '' } } }))
    ).toBeNull();
    expect(
      parseConfigToken(JSON.stringify({ gateway: { auth: { token: '   ' } } }))
    ).toBeNull();
    expect(
      parseConfigToken(JSON.stringify({ gateway: { auth: { token: 42 } } }))
    ).toBeNull();
    expect(
      parseConfigToken(
        JSON.stringify({ gateway: { auth: { token: 'x'.repeat(16_385) } } })
      )
    ).toBeNull();
  });

  it.each([
    '',
    'not json at all',
    '[]',
    'null',
    '{',
    '{"gateway":null}',
    '{"gateway":[]}',
    '{"gateway":{}}',
    '{"gateway":{"auth":null}}',
    '{"gateway":{"auth":"password"}}',
  ])('is total on %j', text => {
    expect(() => parseConfigToken(text)).not.toThrow();
    expect(parseConfigToken(text)).toBeNull();
  });
});

describe('parseGatewayPort', () => {
  it('reads a declared port', () => {
    expect(parseGatewayPort(PLAIN_CONFIG)).toBe(4242);
  });

  it.each([
    ['absent', '{"gateway":{}}'],
    ['zero', '{"gateway":{"port":0}}'],
    ['out of range', '{"gateway":{"port":70000}}'],
    ['negative', '{"gateway":{"port":-1}}'],
    ['fractional', '{"gateway":{"port":1337.5}}'],
    ['string', '{"gateway":{"port":"1337"}}'],
    ['null', '{"gateway":{"port":null}}'],
    ['garbage', 'not json'],
    ['empty', ''],
  ])('falls back to 1337 when the port is %s', (_label, text) => {
    expect(() => parseGatewayPort(text)).not.toThrow();
    expect(parseGatewayPort(text)).toBe(FALLBACK_GATEWAY_PORT);
    expect(FALLBACK_GATEWAY_PORT).toBe(1337);
  });
});

describe('parseOpenClawVersion', () => {
  it('reads the version and not the commit hash', () => {
    expect(parseOpenClawVersion(VERSION_PRINT)).toBe('2026.7.1-2');
  });

  it.each([
    ['OpenClaw 2026.7.1\n', '2026.7.1'],
    ['openclaw v1.2.3', '1.2.3'],
    ['2026.7.1-2', '2026.7.1-2'],
    ['OpenClaw 1.2.3+build.4 (abcdef0)', '1.2.3+build.4'],
    ['OpenClaw 2026.7.1-2 (abc1234)\nextra line 9.9.9', '2026.7.1-2'],
  ])('parses %j', (raw, expected) => {
    expect(parseOpenClawVersion(raw)).toBe(expected);
  });

  it.each([
    '',
    'OpenClaw',
    'command not found',
    'abc1234',
    '(abc1234)',
    'no version here',
    '\n\n',
  ])('is total and returns null on %j', raw => {
    expect(() => parseOpenClawVersion(raw)).not.toThrow();
    expect(parseOpenClawVersion(raw)).toBeNull();
  });
});

describe('bootstrapGatewayCredential alias validation', () => {
  it.each([
    ['a proxy-command option', '-oProxyCommand=id'],
    ['a bare option', '-J'],
    ['an argument split', 'a b'],
    ['a command separator', 'a;b'],
    ['a pipe', 'a|b'],
    ['a substitution', 'a$(id)'],
    ['empty', ''],
    ['over length', 'a'.repeat(256)],
    ['a leading dash', '-build-box'],
  ])('rejects %s before running anything', async (_label, alias) => {
    const { exec, calls } = fakeExec(healthyResponder());
    const result = await bootstrapGatewayCredential(alias, exec);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure).toBe('invalid-target');
    // The point of the packet: nothing reached ssh at all.
    expect(calls).toHaveLength(0);
  });

  it('accepts an ordinary alias', async () => {
    const { exec, calls } = fakeExec(healthyResponder());
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok).toBe(true);
    expect(calls.every(call => call.alias === ALIAS)).toBe(true);
  });
});

describe('bootstrapGatewayCredential token acquisition', () => {
  it('prefers the config file, which is where the real token lives', async () => {
    // Against a live Gateway, `config get gateway.auth.token` answered with a
    // short masked value rather than the credential, and pairing failed while
    // a working token sat in the file. Secret-reading CLIs mask by default.
    const { exec, calls } = fakeExec(healthyResponder());
    const result = await bootstrapGatewayCredential(ALIAS, exec);

    expect(result).toEqual({
      ok: true,
      facts: {
        version: '2026.7.1-2',
        gatewayPort: 4242,
        sharedToken: FILE_TOKEN,
        tokenSource: 'config-file',
      },
    });
    expect(calls.map(call => call.argv.join(' '))).toEqual([
      'openclaw --version',
      'openclaw config get gateway.auth.token',
      'cat .openclaw/openclaw.json',
    ]);
  });

  it('runs only remote arguments that survive the allowlist', async () => {
    const { exec, calls } = fakeExec(healthyResponder());
    await bootstrapGatewayCredential(ALIAS, exec);
    for (const call of calls) {
      for (const argument of call.argv) {
        expect(argument).toMatch(/^[A-Za-z0-9._:@+,=/-]+$/);
      }
      // Every command this module runs must also be buildable, which is the
      // guard the default exec relies on.
      expect(() => buildRemoteExecArgs(call.alias, call.argv)).not.toThrow();
    }
  });

  it('falls through to the config file when the CLI prints a JSON blob', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('get')
          ? {
              stdout:
                '{"source":"file","provider":"gateway_auth_token","id":"value"}\n',
            }
          : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.sharedToken).toBe(FILE_TOKEN);
    expect(result.ok && result.facts.tokenSource).toBe('config-file');
  });

  it('falls through when the CLI prints an error sentence on a zero exit', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('get')
          ? { stdout: 'error: unknown config key gateway.auth.token\n' }
          : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.tokenSource).toBe('config-file');
  });

  it.each(['undefined\n', 'null\n', '  \n', '(null)'])(
    'falls through when the CLI prints the placeholder %j',
    async stdout => {
      const { exec } = fakeExec(
        healthyResponder(argv =>
          argv.includes('get') ? { stdout } : undefined
        )
      );
      const result = await bootstrapGatewayCredential(ALIAS, exec);
      expect(result.ok && result.facts.tokenSource).toBe('config-file');
    }
  );

  it('falls through when the CLI exits non-zero without a transport reason', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('get') ? { code: 1, stderr: 'unknown key' } : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.sharedToken).toBe(FILE_TOKEN);
  });

  it('unwraps a JSON-quoted single-line token from the CLI', async () => {
    // The CLI is the fallback now, so the config must offer nothing literal
    // for its answer to be reached.
    const { exec } = fakeExec(
      healthyResponder(argv => {
        if (argv.includes('get')) return { stdout: `"${CLI_TOKEN}"\n` };
        if (argv[0] === 'cat') return { stdout: INDIRECTION_CONFIG };
        return undefined;
      })
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.sharedToken).toBe(CLI_TOKEN);
    expect(result.ok && result.facts.tokenSource).toBe('cli');
  });

  it('reports token-unavailable when the config only holds the indirection', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv => {
        if (argv.includes('get')) return { code: 1, stderr: 'unresolved' };
        if (argv[0] === 'cat') return { stdout: INDIRECTION_CONFIG };
        return undefined;
      })
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure).toBe('token-unavailable');
    expect(result.ok === false && result.message).toMatch(/paste the token/i);
  });

  it('does not read a remote file-permission error as a refused SSH login', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv => {
        if (argv.includes('get')) return { code: 1, stderr: 'unresolved' };
        if (argv[0] === 'cat') {
          return {
            // The remote command's own status, not ssh's 255. The stderr
            // contains "Permission denied", which is also SSH auth vocabulary.
            code: 1,
            stderr: `cat: /home/${FAKE_USER}/.openclaw/openclaw.json: Permission denied`,
          };
        }
        return undefined;
      })
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok === false && result.failure).toBe('unreadable-config');
  });

  it('reports unreadable-config on an unclassifiable config read failure', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv => {
        if (argv.includes('get')) return { code: 1, stderr: 'unresolved' };
        if (argv[0] === 'cat') return { code: 2, stderr: 'is a directory' };
        return undefined;
      })
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok === false && result.failure).toBe('unreadable-config');
  });

  it('still succeeds on the CLI token when the config read fails', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv[0] === 'cat' ? { code: 2, stderr: 'is a directory' } : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.sharedToken).toBe(CLI_TOKEN);
    // The port is the only thing the failed read cost us.
    expect(result.ok && result.facts.gatewayPort).toBe(FALLBACK_GATEWAY_PORT);
  });

  it('falls back to 1337 when the config declares no port', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv[0] === 'cat'
          ? {
              stdout: JSON.stringify({
                gateway: { auth: { token: FILE_TOKEN } },
              }),
            }
          : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.gatewayPort).toBe(FALLBACK_GATEWAY_PORT);
  });

  it('succeeds with a null version when the version print is unrecognizable', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('--version')
          ? { stdout: 'OpenClaw (dev build)\n' }
          : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok && result.facts.version).toBeNull();
    expect(result.ok && result.facts.sharedToken).toBe(FILE_TOKEN);
  });
});

describe('bootstrapGatewayCredential failure classification', () => {
  /** [label, remote exit code, stderr, expected failure] */
  const cases: ReadonlyArray<[string, number, string, string]> = [
    // A missing binary is the REMOTE shell's status, never ssh's own 255.
    [
      'command not found',
      127,
      `bash: openclaw: command not found`,
      'openclaw-missing',
    ],
    ['not found', 127, `sh: 1: openclaw: not found`, 'openclaw-missing'],
    ['no such file', 127, `no such file or directory`, 'openclaw-missing'],

    // ssh's own failures all arrive as status 255.
    [
      'permission denied',
      255,
      `${FAKE_USER}@${FAKE_HOST}: Permission denied (publickey).`,
      'auth-rejected',
    ],
    [
      'publickey',
      255,
      `Permission denied (publickey,password).`,
      'auth-rejected',
    ],
    [
      'host key verification',
      255,
      `Host key verification failed for ${FAKE_HOST}.`,
      'auth-rejected',
    ],
    [
      'too many auth failures',
      255,
      `Received disconnect: Too many authentication failures`,
      'auth-rejected',
    ],
    [
      'unresolvable host',
      255,
      `ssh: Could not resolve hostname ${FAKE_HOST}: nodename nor servname provided`,
      'unreachable',
    ],
    [
      'unknown service',
      255,
      `ssh: Could not resolve hostname: Name or service not known`,
      'unreachable',
    ],
    [
      'no route',
      255,
      `ssh: connect to host ${FAKE_HOST} port 22: No route to host`,
      'unreachable',
    ],
    [
      'network unreachable',
      255,
      `ssh: connect to host ${FAKE_HOST} port 22: Network is unreachable`,
      'unreachable',
    ],
    [
      'connect timeout',
      255,
      `ssh: connect to host ${FAKE_HOST} port 22: Connection timed out`,
      'unreachable',
    ],
    [
      'operation timed out',
      255,
      `ssh: connect to host ${FAKE_HOST} port 22: Operation timed out`,
      'unreachable',
    ],
    [
      'refused',
      255,
      `ssh: connect to host ${FAKE_HOST} port 22: Connection refused`,
      'unreachable',
    ],
    [
      'closed by remote',
      255,
      `ssh_exchange_identification: Connection closed by remote host`,
      'unreachable',
    ],
  ];

  it.each(cases)('classifies %s', async (_label, code, stderr, expected) => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('--version') ? { code, stderr } : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure).toBe(expected);
  });

  it('classifies a transport failure raised at the token step', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('get')
          ? { code: 255, stderr: `Permission denied (publickey).` }
          : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok === false && result.failure).toBe('auth-rejected');
  });

  it('classifies a transport failure raised at the config step', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv => {
        if (argv.includes('get')) return { code: 1, stderr: 'unresolved' };
        if (argv[0] === 'cat') {
          return {
            code: 255,
            stderr: `ssh: connect to host ${FAKE_HOST} port 22: Connection refused`,
          };
        }
        return undefined;
      })
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok === false && result.failure).toBe('unreachable');
  });

  it('classifies a killed command as unreachable', async () => {
    const { exec } = fakeExec(
      healthyResponder(argv =>
        argv.includes('--version') ? { code: null, stderr: '' } : undefined
      )
    );
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok === false && result.failure).toBe('unreachable');
  });

  it('returns unknown when the injected exec rejects', async () => {
    const exec: RemoteExec = async () => {
      throw new Error(`ssh to ${FAKE_HOST} blew up`);
    };
    const result = await bootstrapGatewayCredential(ALIAS, exec);
    expect(result.ok === false && result.failure).toBe('unknown');
    expect(result.ok === false && result.message).not.toContain(FAKE_HOST);
  });

  it('returns unknown rather than throwing when no exec is supplied', async () => {
    const result = await bootstrapGatewayCredential(
      ALIAS,
      undefined as unknown as RemoteExec
    );
    expect(result.ok === false && result.failure).toBe('unknown');
  });
});

describe('bootstrapGatewayCredential redaction', () => {
  it('never echoes infrastructure identity or a token into a message', async () => {
    const noisy = [
      `${FAKE_USER}@${FAKE_HOST}: Permission denied (publickey).`,
      `debug1: identity file /home/${FAKE_USER}/.ssh/id_ed25519`,
      `token was ${FILE_TOKEN}`,
    ].join('\n');

    const failures = [
      // Every step that can fail, perturbed one at a time.
      (argv: readonly string[]) =>
        argv.includes('--version') ? { code: 255, stderr: noisy } : undefined,
      (argv: readonly string[]) =>
        argv.includes('get') ? { code: 255, stderr: noisy } : undefined,
      (argv: readonly string[]) =>
        argv[0] === 'cat' ? { code: 1, stderr: noisy } : undefined,
    ];

    for (const perturb of failures) {
      const { exec } = fakeExec(
        healthyResponder(argv => {
          const forced = perturb(argv);
          if (forced) return forced;
          if (argv.includes('get')) return { code: 1, stderr: 'unresolved' };
          return undefined;
        })
      );
      const result = await bootstrapGatewayCredential(ALIAS, exec);
      expect(result.ok).toBe(false);
      const message = result.ok === false ? result.message : '';
      expect(message).not.toContain(FAKE_HOST);
      expect(message).not.toContain(FAKE_USER);
      expect(message).not.toContain(FILE_TOKEN);
      expect(message).not.toContain(CLI_TOKEN);
      expect(message).not.toContain('.ssh');
      expect(message.length).toBeLessThanOrEqual(200);
      // Repo copy rule: no em dashes in operator-facing strings.
      expect(message).not.toContain('—');
    }
  });

  it('gives every failure class a distinct fixed sentence', async () => {
    const seen = new Map<string, string>();
    const stderrs: ReadonlyArray<[number, string]> = [
      [127, 'command not found'],
      [255, 'Permission denied (publickey).'],
      [255, 'Could not resolve hostname'],
    ];
    for (const [code, stderr] of stderrs) {
      const { exec } = fakeExec(
        healthyResponder(argv =>
          argv.includes('--version') ? { code, stderr } : undefined
        )
      );
      const result = await bootstrapGatewayCredential(ALIAS, exec);
      if (result.ok === false) seen.set(result.failure, result.message);
    }
    expect(seen.size).toBe(3);
    expect(new Set(seen.values()).size).toBe(3);
  });
});

describe('createSshRemoteExec', () => {
  it('returns a callable exec without spawning anything', () => {
    expect(typeof createSshRemoteExec()).toBe('function');
    expect(typeof createSshRemoteExec({ timeoutMs: 5_000 })).toBe('function');
  });

  it('refuses an unusable alias without spawning ssh', async () => {
    const exec = createSshRemoteExec();
    const result = await exec('-oProxyCommand=id', ['openclaw', '--version']);
    expect(result.code).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('exawatt:ssh-launch-failed');
  });

  it('refuses an unsafe remote argument without spawning ssh', async () => {
    const exec = createSshRemoteExec();
    const result = await exec(ALIAS, ['cat', '/etc/passwd; id']);
    expect(result.code).toBeNull();
    expect(result.stderr).toContain('exawatt:ssh-launch-failed');
  });

  it('classifies its own launch failure as unknown, not as a server problem', async () => {
    const exec = createSshRemoteExec();
    // The launch sentinel is what bootstrapGatewayCredential sees; route it
    // through the classifier by injecting the same shape.
    const injected: RemoteExec = async () => await exec('-bad', ['openclaw']);
    const result = await bootstrapGatewayCredential(ALIAS, injected);
    expect(result.ok === false && result.failure).toBe('unknown');
  });
});
