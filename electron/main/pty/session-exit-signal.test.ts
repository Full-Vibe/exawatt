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
  /** How this process answers a signal. By default it dies by it, the way
   *  zsh and fish die by SIGHUP: node-pty reports code 0 plus the signal. */
  onSignal: (signal: number) => NodePtyExit = signal => ({
    exitCode: 0,
    signal,
  });
  kill(signal = 'SIGHUP'): void {
    this.exit(
      this.onSignal(os.constants.signals[signal as keyof typeof os.constants.signals])
    );
  }
}

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc = new FakePty();
    spawned.push(proc);
    return proc;
  },
}));

// The real `stopProcessGroups` signals a process group it finds in `ps`;
// a fake pid is in no group, so the real module would take its fallback and
// signal the process through node-pty. This double does exactly that, and
// never touches a real pid.
vi.mock('./process-groups', () => ({
  stopProcessGroups: async (
    pids: number[],
    fallback: (pid: number, signal: string) => void
  ) => {
    for (const pid of pids) fallback(pid, 'SIGHUP');
  },
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

async function started() {
  const manager = new PtySessionManager();
  const exits: unknown[][] = [];
  manager.on('exit', (...args: unknown[]) => exits.push(args));
  const session = await manager.create({
    harness: 'shell',
    cwd,
    durableSessionId: 'session-ended',
  });
  return { manager, exits, session, proc: spawned.at(-1)! };
}

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

/**
 * Exawatt's own stop is not a fault. `stopProcessGroups` ends a Session with
 * SIGHUP (escalating to SIGKILL), and zsh and fish report that death as
 * `{ exitCode: 0, signal: 1 }`. Recording it as a signal death painted every
 * Pause, model change and quit as a crash in ⌘K, Fleet and the terminal.
 */
describe('a stop Exawatt asked for ends cleanly', () => {
  it('records a paused process that died by our SIGHUP as a clean stop', async () => {
    const { manager, exits, session } = await started();
    await manager.stop(session.id);
    const info = manager.list().find(item => item.id === session.id)!;
    expect(info).toMatchObject({ exited: true, exitCode: 0, exitSignal: null });
    expect(exits).toEqual([[session.id, 0, 'session-ended', null]]);
    expect(manager.buffer(session.id)).toContain('[session stopped]');
    expect(manager.buffer(session.id)).not.toContain('ended by');
  });

  it('records a shell that traps SIGHUP and exits 129 as a clean stop', async () => {
    const { manager, exits, session, proc } = await started();
    proc.onSignal = () => ({ exitCode: 129, signal: 0 });
    await manager.stopAndConfirmExit(session.id);
    expect(exits).toEqual([[session.id, 0, 'session-ended', null]]);
  });

  it('records the processes stopped at quit as clean stops', async () => {
    const { manager, exits, session } = await started();
    await manager.stopAll();
    expect(exits).toEqual([[session.id, 0, 'session-ended', null]]);
  });

  it('still names a SIGHUP that Exawatt did not send', async () => {
    const { exits, info } = await endWith({ exitCode: 0, signal: 1 });
    expect(info).toMatchObject({ exitSignal: 'SIGHUP' });
    expect(exits[0]?.[3]).toBe('SIGHUP');
  });
});
