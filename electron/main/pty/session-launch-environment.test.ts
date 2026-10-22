import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtySessionManager } from './session-manager';

/**
 * ENG-029 C4: a capability adds to a launch's environment through one seam
 * (the bus's port, token, address and `exawatt` on PATH), and a failing
 * provider never fails the launch.
 */
const spawned: { env: Record<string, string>; exit(): void }[] = [];

vi.mock('node-pty', () => ({
  spawn: (
    _file: string,
    _args: string[],
    options: { env: Record<string, string> }
  ) => {
    const exits: Array<(event: { exitCode: number }) => void> = [];
    const proc = {
      pid: 5151,
      env: options.env,
      onData: () => ({ dispose() {} }),
      onExit: (handler: (event: { exitCode: number }) => void) => {
        exits.push(handler);
        return { dispose() {} };
      },
      write() {},
      resize() {},
      kill() {},
      exit: () => exits.forEach(handler => handler({ exitCode: 0 })),
    };
    spawned.push(proc);
    return proc;
  },
}));

let cwd: string;
beforeEach(() => {
  spawned.length = 0;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-launch-env-'));
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('the launch environment seam', () => {
  it('adds the provider’s variables and PATH entries, and releases them when the process ends', async () => {
    const manager = new PtySessionManager();
    const launches: unknown[] = [];
    const released: string[] = [];
    manager.setLaunchEnvironmentProvider(async launch => {
      launches.push(launch);
      return {
        env: {
          EXAWATT_BUS_PORT: '4321',
          EXAWATT_SESSION_ID: launch.durableSessionId,
        },
        pathPrepend: ['/state/bus/bin'],
        release: () => released.push(launch.id),
      };
    });
    const session = await manager.create({
      harness: 'claude',
      cwd,
      durableSessionId: 'session-env',
    });
    expect(launches).toEqual([
      {
        id: session.id,
        durableSessionId: 'session-env',
        harness: 'claude',
        // The default every launch applies.
        permissionMode: 'unrestricted',
      },
    ]);
    const env = spawned[0].env;
    expect(env.EXAWATT_BUS_PORT).toBe('4321');
    expect(env.EXAWATT_SESSION_ID).toBe('session-env');
    expect(env.PATH.split(path.delimiter)[0]).toBe('/state/bus/bin');
    expect(env.PATH).toContain(process.env.PATH ?? '');
    expect(released).toEqual([]);
    spawned[0].exit();
    expect(released).toEqual([session.id]);
  });

  it('tells the provider whether its MCP server reached the launch, not whether one was offered', async () => {
    const manager = new PtySessionManager();
    const declared: [string, boolean][] = [];
    manager.setLaunchEnvironmentProvider(async launch => ({
      env: {},
      pathPrepend: [],
      mcpServer: {
        name: 'exawatt',
        command: '/bin/node',
        args: ['/state/bus/bin/exawatt-mcp.cjs'],
        env: {},
        inherited: [],
      },
      declared: outcome => declared.push([launch.harness, outcome.mcpServer]),
      release: () => {},
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Codex takes the server on its argv: handed over.
    await manager.create({
      harness: 'codex',
      cwd,
      durableSessionId: 'session-codex',
      permissionMode: 'auto',
    });
    // Claude Code takes it as a file this manager has nowhere to write:
    // offered, never handed over.
    await manager.create({
      harness: 'claude',
      cwd,
      durableSessionId: 'session-claude',
    });
    warn.mockRestore();
    expect(declared).toEqual([
      ['codex', true],
      ['claude', false],
    ]);
  });

  it('launches without the extension when the provider fails', async () => {
    const manager = new PtySessionManager();
    manager.setLaunchEnvironmentProvider(async () => {
      throw new Error('channel down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await manager.create({
      harness: 'claude',
      cwd,
      durableSessionId: 'session-x',
    });
    warn.mockRestore();
    // Nothing beyond what this process inherited: an agent session running
    // these tests inside Exawatt carries its own bus port, and that is not
    // the extension.
    expect(spawned[0].env.EXAWATT_BUS_PORT).toBe(process.env.EXAWATT_BUS_PORT);
    expect(spawned[0].env.PATH).toBe(process.env.PATH);
  });
});
