import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-297: a Finder-launched app inherits no shell startup variables, so a
 * harness home the operator sets in his rc file must come from his login
 * shell, read when a store is read, never from Exawatt's own environment
 * when a module loads.
 */
const shell = vi.hoisted(() => ({ path: '' }));
vi.mock('./login-shell', async importOriginal => ({
  ...(await importOriginal<typeof import('./login-shell')>()),
  defaultShell: async () => shell.path,
}));

const {
  LoginEnvironmentResolver,
  harnessEnvironment,
  harnessEnvironmentSettled,
  loginModelEnvironment,
  resetHarnessEnvironment,
  warmHarnessEnvironment,
} = await import('./harness-homes');
const { CodexConversationAdapter } = await import('./conversation-catalog');
const { shellQuote } = await import('./login-shell');

const roots: string[] = [];
function temporary(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** A stand-in login shell: a real `/bin/sh` that runs whatever it is asked,
 *  with the variables an rc file would have set ('' unsets one). It counts
 *  how often it is started, and with `waitFor` it does not start the shell
 *  until that file exists. */
function loginShell(
  variables: Record<string, string>,
  options: { waitFor?: string; at?: string } = {}
): { path: string; calls: () => number } {
  const directory = options.at
    ? path.dirname(options.at)
    : temporary('exawatt-login-shell-');
  const counter = path.join(directory, 'calls');
  const file = options.at ?? path.join(directory, 'sh');
  const lines = Object.entries(variables).map(([key, value]) =>
    value ? `export ${key}=${shellQuote(value)}` : `unset ${key}`
  );
  const wait = options.waitFor
    ? `while [ ! -e ${shellQuote(options.waitFor)} ]; do sleep 0.02; done`
    : '';
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      `printf x >> ${shellQuote(counter)}`,
      wait,
      ...lines,
      'exec /bin/sh "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  shell.path = file;
  return {
    path: file,
    calls: () =>
      fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0,
  };
}

function writeRollout(codexHome: string, id: string, cwd: string): void {
  const sessions = path.join(codexHome, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(
    path.join(sessions, `${id}.jsonl`),
    [
      JSON.stringify({
        type: 'session_meta',
        payload: { session_id: id, cwd },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: `Task in ${id}` },
      }),
    ].join('\n')
  );
}

beforeEach(() => {
  resetHarnessEnvironment();
  vi.stubEnv('EXAWATT_CODEX_SESSIONS_ROOT', undefined);
  vi.stubEnv('EXAWATT_CODEX_STATE_DB', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('harness homes', () => {
  it("reads Codex conversations from the login shell's CODEX_HOME, not Exawatt's", async () => {
    const project = temporary('exawatt-codex-project-');
    const loginHome = temporary('exawatt-codex-login-home-');
    const ownHome = temporary('exawatt-codex-own-home-');
    writeRollout(loginHome, 'from-login-shell', project);
    writeRollout(ownHome, 'from-exawatt-env', project);
    vi.stubEnv('CODEX_HOME', ownHome);
    loginShell({ CODEX_HOME: loginHome });

    const rows = await new CodexConversationAdapter(
      undefined,
      undefined,
      async () => []
    ).list(project);

    expect(rows.map(row => row.id)).toEqual(['from-login-shell']);
  });

  it('follows a home set after launch, without a relaunch', async () => {
    const project = temporary('exawatt-codex-project-');
    const before = temporary('exawatt-codex-before-');
    const after = temporary('exawatt-codex-after-');
    writeRollout(before, 'before', project);
    writeRollout(after, 'after', project);
    const adapter = new CodexConversationAdapter(
      undefined,
      undefined,
      async () => []
    );
    loginShell({ CODEX_HOME: before });
    expect((await adapter.list(project)).map(row => row.id)).toEqual([
      'before',
    ]);

    loginShell({ CODEX_HOME: after });
    resetHarnessEnvironment();
    expect((await adapter.list(project)).map(row => row.id)).toEqual(['after']);
  });

  it('asks the login shell once per minute and reads its own environment each time', async () => {
    const asked = loginShell({ CLAUDE_CONFIG_DIR: '/login/claude' });
    const start = Date.now();
    vi.stubEnv('EXAWATT_CLAUDE_PROJECTS_ROOT', '/sandbox/one');
    const first = await harnessEnvironment(start);
    vi.stubEnv('EXAWATT_CLAUDE_PROJECTS_ROOT', '/sandbox/two');
    const second = await harnessEnvironment(start + 1_000);

    expect(asked.calls()).toBe(1);
    expect(first.CLAUDE_CONFIG_DIR).toBe('/login/claude');
    expect(second.EXAWATT_CLAUDE_PROJECTS_ROOT).toBe('/sandbox/two');

    // A minute on, the old answer is served and a refresh asks again.
    expect((await harnessEnvironment(start + 61_000)).CLAUDE_CONFIG_DIR).toBe(
      '/login/claude'
    );
    await harnessEnvironmentSettled();
    expect(asked.calls()).toBe(2);
  });

  it('a variable the login shell leaves unset is unset, whatever Exawatt inherited', async () => {
    vi.stubEnv('CODEX_HOME', '/inherited/codex');
    loginShell({ CODEX_HOME: '' });
    expect((await harnessEnvironment()).CODEX_HOME).toBeUndefined();
  });

  it('a warmed environment answers the next read without starting a shell', async () => {
    const asked = loginShell({ CODEX_HOME: '/login/warm' });
    await warmHarnessEnvironment();
    expect(asked.calls()).toBe(1);

    expect((await harnessEnvironment()).CODEX_HOME).toBe('/login/warm');
    expect(asked.calls()).toBe(1);
  });
});

/**
 * The operator's login shell is fish, and fish, csh and PowerShell reject
 * POSIX parameter expansion at parse time. The resolver must read
 * variables without asking the shell to expand anything, and a value with
 * a newline in it must survive.
 */
describe('the login environment under every shell family', () => {
  const MULTILINE = 'line one\nline two';
  const families: Array<{
    name: string;
    executable: string;
    startup: string;
    script: (codexHome: string) => string;
  }> = [
    {
      name: 'fish',
      executable: '/opt/homebrew/bin/fish',
      startup: '.config/fish/config.fish',
      script: codexHome =>
        [
          'echo welcome from config.fish',
          `set -gx CODEX_HOME ${shellQuote(codexHome)}`,
          `set -gx ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION '${MULTILINE}'`,
          'set -e CLAUDE_CONFIG_DIR',
        ].join('\n'),
    },
    {
      name: 'zsh',
      executable: '/bin/zsh',
      startup: '.zprofile',
      script: codexHome => posixStartup(codexHome),
    },
    {
      name: 'bash',
      executable: '/bin/bash',
      startup: '.bash_profile',
      script: codexHome => posixStartup(codexHome),
    },
    {
      name: 'tcsh',
      executable: '/bin/tcsh',
      startup: '.tcshrc',
      script: codexHome =>
        [
          'echo welcome from tcshrc',
          `setenv CODEX_HOME ${shellQuote(codexHome)}`,
          `setenv ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION "line one\\`,
          'line two"',
          'unsetenv CLAUDE_CONFIG_DIR',
        ].join('\n'),
    },
  ];

  function posixStartup(codexHome: string): string {
    return [
      'echo welcome from the profile',
      `export CODEX_HOME=${shellQuote(codexHome)}`,
      `export ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION='${MULTILINE}'`,
      'unset CLAUDE_CONFIG_DIR',
    ].join('\n');
  }

  for (const family of families) {
    const executable = [
      family.executable,
      `/usr/local/bin/${family.name}`,
      `/bin/${family.name}`,
      `/usr/bin/${family.name}`,
    ].find(candidate => fs.existsSync(candidate));
    const title = executable
      ? `${family.name}: reads what its startup sets and unsets`
      : `${family.name}: skipped, ${family.name} is not installed on this host`;
    it.skipIf(!executable)(title, async () => {
      const home = temporary(`exawatt-login-${family.name}-home-`);
      const startup = path.join(home, family.startup);
      fs.mkdirSync(path.dirname(startup), { recursive: true });
      fs.writeFileSync(startup, `${family.script(`/login/${family.name}`)}\n`);
      const project = temporary(`exawatt-login-${family.name}-project-`);
      vi.stubEnv('HOME', home);
      vi.stubEnv('CODEX_HOME', '/inherited/codex');
      vi.stubEnv('CLAUDE_CONFIG_DIR', '/inherited/claude');

      const environment = await loginModelEnvironment(executable!, project);

      expect(environment.CODEX_HOME).toBe(`/login/${family.name}`);
      expect(environment.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION).toBe(
        MULTILINE
      );
      expect(environment.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(environment.HOME).toBe(home);
    });
  }
});

/** Absence is not an answer: a probe that failed must never read as a
 *  shell that set nothing. */
describe('a login shell that cannot answer', () => {
  function recorder() {
    const events: Array<{ event: string; fields: unknown }> = [];
    return {
      events,
      record: (event: string, fields?: unknown) =>
        void events.push({ event, fields }),
    };
  }

  it('keeps the previous answer when a probe misses its deadline, and says so once', async () => {
    const log = recorder();
    const deadline = { ms: 20_000 };
    const resolver = new LoginEnvironmentResolver({
      deadlineMs: () => deadline.ms,
      record: log.record,
    });
    const cwd = temporary('exawatt-login-cwd-');
    const good = loginShell({ CODEX_HOME: '/login/good' });
    expect((await resolver.fresh(good.path, cwd)).CODEX_HOME).toBe(
      '/login/good'
    );

    // This shell never gets to answer: it waits for a file nobody writes.
    loginShell(
      { CODEX_HOME: '/login/late' },
      { at: good.path, waitFor: path.join(cwd, 'never') }
    );
    deadline.ms = 100;
    expect((await resolver.fresh(good.path, cwd)).CODEX_HOME).toBe(
      '/login/good'
    );
    expect((await resolver.fresh(good.path, cwd)).CODEX_HOME).toBe(
      '/login/good'
    );

    expect(log.events).toEqual([
      {
        event: 'login-environment.unavailable',
        fields: expect.objectContaining({
          reason: 'timed-out',
          fallback: 'previous-answer',
        }),
      },
    ]);
  });

  it("falls back to Exawatt's own environment only with no answer at all, records it, and asks again", async () => {
    const log = recorder();
    const resolver = new LoginEnvironmentResolver({ record: log.record });
    const cwd = temporary('exawatt-login-cwd-');
    const broken = temporary('exawatt-login-broken-');
    const file = path.join(broken, 'sh');
    // What fish did with the POSIX probe: a parse error, exit 127, nothing
    // on stdout.
    fs.writeFileSync(file, '#!/bin/sh\nexit 127\n', {
      mode: 0o755,
    });
    vi.stubEnv('CODEX_HOME', '/inherited/codex');
    const start = Date.now();

    expect((await resolver.current(file, cwd, start)).CODEX_HOME).toBe(
      '/inherited/codex'
    );
    expect(log.events).toEqual([
      {
        event: 'login-environment.unavailable',
        fields: expect.objectContaining({
          reason: 'no-answer',
          fallback: 'process-environment',
        }),
      },
    ]);

    const fixed = loginShell({ CODEX_HOME: '/login/fixed' }, { at: file });
    expect((await resolver.current(file, cwd, start + 1_000)).CODEX_HOME).toBe(
      '/inherited/codex'
    );
    expect(fixed.calls()).toBe(0);

    expect((await resolver.current(file, cwd, start + 11_000)).CODEX_HOME).toBe(
      '/login/fixed'
    );
    expect(fixed.calls()).toBe(1);
    expect(log.events.map(entry => entry.event)).toEqual([
      'login-environment.unavailable',
      'login-environment.recovered',
    ]);
  });

  it('a stale answer is served at once and refreshed off the read path', async () => {
    const resolver = new LoginEnvironmentResolver({
      deadlineMs: () => 20_000,
    });
    const cwd = temporary('exawatt-login-cwd-');
    const first = loginShell({ CODEX_HOME: '/login/first' });
    const start = Date.now();
    expect((await resolver.current(first.path, cwd, start)).CODEX_HOME).toBe(
      '/login/first'
    );

    const release = path.join(cwd, 'release');
    loginShell(
      { CODEX_HOME: '/login/second' },
      { at: first.path, waitFor: release }
    );
    // The refresh's shell is still waiting; this read must not wait on it.
    expect(
      (await resolver.current(first.path, cwd, start + 61_000)).CODEX_HOME
    ).toBe('/login/first');

    fs.writeFileSync(release, '');
    await resolver.settled();
    expect(
      (await resolver.current(first.path, cwd, start + 62_000)).CODEX_HOME
    ).toBe('/login/second');
    expect(first.calls()).toBe(2);
  });
});
