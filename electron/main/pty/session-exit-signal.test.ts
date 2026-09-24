import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-186 — a signalled death is recorded as one, on the REAL manager.
 *
 * node-pty's exit event carries TWO numbers. `pty.cc` sets `exit_code` from
 * `WEXITSTATUS` only when `WIFEXITED`, and `signal_code` from `WTERMSIG` only
 * when `WIFSIGNALED`, so a SIGKILLed Agent (an OOM kill, a `kill -9`) arrives
 * as `{ exitCode: 0, signal: 9 }`. The manager kept the code and dropped the
 * signal, and the lifecycle owner then read that Agent as "Paused · Stopped
 * cleanly". The earlier fakes in this directory emit `{ exitCode }` alone,
 * which is the shape that let the defect pass; this fake reports what the
 * native binding reports.
 */
interface NodePtyExit {
  exitCode: number;
  signal?: number;
}

const spawned: FakePty[] = [];

class FakePty {
  pid = 4343;
  private exitHandlers: Array<(event: NodePtyExit) => void> = [];
  onData(): { dispose(): void } {
    return { dispose() {} };
  }
  onExit(handler: (event: NodePtyExit) => void): { dispose(): void } {
    this.exitHandlers.push(handler);
    return { dispose() {} };
  }
  exit(event: NodePtyExit): void {
    for (const handler of this.exitHandlers) handler(event);
  }
  write(): void {}
  resize(): void {}
  kill(): void {}
}

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc = new FakePty();
    spawned.push(proc);
    return proc;
  },
}));

vi.mock('./process-groups', () => ({
  stopProcessGroups: async () => {},
}));

const { PtySessionManager } = await import('./session-manager');

let cwd: string;

beforeEach(() => {
  spawned.length = 0;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-exit-signal-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

async function endWith(event: NodePtyExit) {
  const manager = new PtySessionManager();
  const exits: unknown[][] = [];
  manager.on('exit', (...args: unknown[]) => exits.push(args));
  const session = await manager.create({
    harness: 'shell',
    cwd,
    durableSessionId: 'session-ended',
  });
  spawned.at(-1)!.exit(event);
  const info = manager.list().find(item => item.id === session.id)!;
  return { info, exits, buffer: manager.buffer(session.id) };
}

describe('the exit record keeps how the process ended', () => {
  it('names the signal a killed process died by', async () => {
    const { info, exits, buffer } = await endWith({ exitCode: 0, signal: 9 });
    expect(info).toMatchObject({
      exited: true,
      exitCode: 0,
      exitSignal: 'SIGKILL',
    });
    expect(exits).toEqual([[info.id, 0, 'session-ended', 'SIGKILL']]);
    // The terminal's own marker no longer says a code nobody exited with.
    expect(buffer).toContain('ended by SIGKILL');
  });

  it('records no signal for a process that exited on its own', async () => {
    const { info, exits, buffer } = await endWith({ exitCode: 3, signal: 0 });
    expect(info).toMatchObject({ exitCode: 3, exitSignal: null });
    expect(exits[0]?.[3]).toBeNull();
    expect(buffer).toContain('exited 3');
  });
});
