/**
 * BUG-305: main owns each durable Session's process, so asking for it again
 * is answered, never refused. A window that missed a start (a reload during a
 * long resume, a second window) asks for the Session it believes is paused;
 * main answers with the process it already runs, or with the start already
 * under way.
 */
import { describe, expect, it, vi } from 'vitest';

const processes = vi.hoisted(
  () => [] as Array<{ pid: number; exit: () => void }>
);
vi.mock('node-pty', () => ({
  spawn: () => {
    let onExit: (event: { exitCode: number }) => void = () => {};
    const process = {
      pid: 5000 + processes.length,
      onData: () => ({ dispose() {} }),
      onExit: (fn: typeof onExit) => {
        onExit = fn;
        return { dispose() {} };
      },
      write() {},
      resize() {},
      kill() {},
      exit: () => onExit({ exitCode: 0 }),
    };
    processes.push(process);
    return process;
  },
}));
vi.mock('./process-groups', () => ({
  stopProcessGroups: vi.fn(async () => {}),
}));
const { PtySessionManager } = await import('./session-manager');

const resume = (durableSessionId: string) => ({
  harness: 'claude' as const,
  cwd: process.cwd(),
  durableSessionId,
  resumeSessionId: `conversation-${durableSessionId}`,
});

describe('ensure-running (BUG-305)', () => {
  it('answers a Session that already runs with its live process', async () => {
    const manager = new PtySessionManager();
    const first = await manager.ensureRunning(resume('custody-live'));
    const spawned = processes.length;
    const again = await manager.ensureRunning(resume('custody-live'));
    expect(first.answer).toBe('started');
    expect(again).toEqual({ session: first.session, answer: 'running' });
    expect(processes.length).toBe(spawned);
    expect(manager.list()).toHaveLength(1);
    processes.at(-1)!.exit();
  });

  it('answers a second ask during a start with that same start', async () => {
    const manager = new PtySessionManager();
    let release!: () => void;
    const prepared = vi.fn(
      () => new Promise<void>(resolve => (release = resolve))
    );
    const first = manager.ensureRunning(resume('custody-starting'), prepared);
    // The second ask arrives while the first is still preparing (a slow
    // readiness probe): it must not prepare or spawn a second time.
    const second = manager.ensureRunning(resume('custody-starting'), prepared);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(manager.list()).toHaveLength(0);
    const spawned = processes.length;
    release();
    const [started, joined] = await Promise.all([first, second]);
    expect(started.answer).toBe('started');
    expect(joined).toEqual({ session: started.session, answer: 'joined' });
    expect(processes.length).toBe(spawned + 1);
    expect(manager.list()).toHaveLength(1);
    processes.at(-1)!.exit();
  });

  it('a start that fails fails for every ask that joined it', async () => {
    const manager = new PtySessionManager();
    const options = { ...resume('custody-failed'), cwd: '/no/such/dir' };
    const results = await Promise.allSettled([
      manager.ensureRunning(options),
      manager.ensureRunning(options),
    ]);
    expect(results.map(result => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    // Nothing is left half-started: the next ask starts afresh.
    const retried = await manager.ensureRunning(resume('custody-failed'));
    expect(retried.answer).toBe('started');
    processes.at(-1)!.exit();
  });

  it('an ended process is replaced, not answered', async () => {
    const manager = new PtySessionManager();
    const first = await manager.ensureRunning(resume('custody-ended'));
    processes.at(-1)!.exit();
    const next = await manager.ensureRunning(resume('custody-ended'));
    expect(next.answer).toBe('started');
    expect(next.session.id).not.toBe(first.session.id);
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: next.session.id, exited: false }),
    ]);
    processes.at(-1)!.exit();
  });

  it('a close admitted during a start waits for nothing it cannot own', async () => {
    const manager = new PtySessionManager();
    let release!: () => void;
    const start = manager.ensureRunning(
      resume('custody-closing'),
      () => new Promise<void>(resolve => (release = resolve))
    );
    await expect(manager.closeSession('custody-closing')).rejects.toThrow(
      'operation in progress'
    );
    release();
    await start;
    processes.at(-1)!.exit();
  });
});
