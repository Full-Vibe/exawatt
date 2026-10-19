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

const { harnessEnvironment, resetHarnessEnvironment } =
  await import('./harness-homes');
const { CodexConversationAdapter } = await import('./conversation-catalog');

const roots: string[] = [];
function temporary(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** A stand-in login shell: answers the variable query as an rc file would,
 *  and counts how often it is asked. */
function loginShell(variables: Record<string, string>): {
  calls: () => number;
} {
  const directory = temporary('exawatt-login-shell-');
  const counter = path.join(directory, 'calls');
  const lines = Object.entries(variables)
    .map(([key, value]) => `printf '%s\\n' '${key}=${value}'`)
    .join('\n');
  shell.path = path.join(directory, 'sh');
  fs.writeFileSync(
    shell.path,
    `#!/bin/sh\nprintf x >> '${counter}'\n${lines}\n`,
    { mode: 0o755 }
  );
  return {
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

    await harnessEnvironment(start + 61_000);
    expect(asked.calls()).toBe(2);
  });

  it('a variable the login shell leaves unset is unset, whatever Exawatt inherited', async () => {
    vi.stubEnv('CODEX_HOME', '/inherited/codex');
    loginShell({ CODEX_HOME: '' });
    expect((await harnessEnvironment()).CODEX_HOME).toBeUndefined();
  });
});
