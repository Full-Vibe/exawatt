import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PERMISSION_MODE } from '@exawatt/core';
import { PtySessionManager } from './session-manager';

/**
 * BUG-331: the mode an Agent was started in is Session state, resolved once
 * in main, so the pane can say it (and that it is Exawatt's default) beside
 * the harness's own words for it.
 */
const spawned: { args: string[] }[] = [];

vi.mock('node-pty', () => ({
  spawn: (_file: string, args: string[]) => {
    spawned.push({ args });
    return {
      pid: 5252,
      onData: () => ({ dispose() {} }),
      onExit: () => ({ dispose() {} }),
      write() {},
      resize() {},
      kill() {},
    };
  },
}));

let cwd: string;
beforeEach(() => {
  spawned.length = 0;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-launch-mode-'));
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('the mode a Session was launched in', () => {
  it('records the default when the request names none', async () => {
    const manager = new PtySessionManager();
    const { session } = await manager.ensureRunning({
      harness: 'claude',
      cwd,
      durableSessionId: 'session-default-mode',
    });
    expect(session.launchPermissionMode).toBe(DEFAULT_AGENT_PERMISSION_MODE);
  });

  it('records the requested mode, and none for a shell', async () => {
    const manager = new PtySessionManager();
    const { session: agent } = await manager.ensureRunning({
      harness: 'codex',
      cwd,
      durableSessionId: 'session-ask-first',
      permissionMode: 'prompt',
    });
    const { session: shell } = await manager.ensureRunning({
      harness: 'shell',
      cwd,
      durableSessionId: 'session-shell',
    });
    expect(agent.launchPermissionMode).toBe('prompt');
    expect(shell.launchPermissionMode).toBeUndefined();
  });
});
