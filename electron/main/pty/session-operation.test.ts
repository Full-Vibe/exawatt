import { describe, expect, it, vi } from 'vitest';

const processes = vi.hoisted(() => [] as Array<{ exit: () => void }>);
vi.mock('node-pty', () => ({
  spawn: () => {
    let onExit: (event: { exitCode: number }) => void = () => {};
    const process = {
      pid: 4242,
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

describe('Session operation ordering', () => {
  it('waits for the exit event and blocks resume/model changes while pausing', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'claude',
      cwd: process.cwd(),
      durableSessionId: 'operation-session',
    });
    let complete = false;
    const pause = manager.pauseSession(session.id).then(() => {
      complete = true;
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(complete).toBe(false);
    await expect(
      manager.create({
        harness: 'claude',
        cwd: process.cwd(),
        durableSessionId: session.durableSessionId,
        resumeSessionId: session.harnessSessionId!,
      })
    ).rejects.toThrow('operation in progress');
    await expect(
      manager.changeModel(session.id, { model: 'sonnet' })
    ).rejects.toThrow('operation in progress');
    await expect(
      manager.closeSession(session.durableSessionId)
    ).rejects.toThrow('operation in progress');
    expect(manager.list()).toHaveLength(1);
    processes.at(-1)!.exit();
    await pause;
    expect(manager.list()).toEqual([
      expect.objectContaining({
        durableSessionId: session.durableSessionId,
        harnessSessionId: session.harnessSessionId,
        exited: true,
      }),
    ]);
    expect(manager.listenerCount('exit')).toBe(0);
  });
  it('refuses an unsafe stop and releases its operation ownership', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'claude',
      cwd: process.cwd(),
    });
    await expect(manager.pauseSession(session.id, () => false)).rejects.toThrow(
      'started working'
    );
    expect(manager.list()[0].exited).toBe(false);
    const pause = manager.pauseSession(session.id);
    await new Promise<void>(resolve => setImmediate(resolve));
    processes.at(-1)!.exit();
    await pause;
  });
  it('refuses shells rather than calling their next process a resumed conversation', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'shell',
      cwd: process.cwd(),
    });
    await expect(manager.pauseSession(session.id)).rejects.toThrow(
      'saved Agent conversation'
    );
    expect(manager.list()[0].exited).toBe(false);
    processes.at(-1)!.exit();
  });
  it('close owns the durable identity through exit and forget', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'claude',
      cwd: process.cwd(),
    });
    const close = manager.closeSession(session.durableSessionId);
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(
      manager.changeModel(session.id, { model: 'sonnet' })
    ).rejects.toThrow('operation in progress');
    await expect(
      manager.create({
        harness: 'claude',
        cwd: process.cwd(),
        durableSessionId: session.durableSessionId,
      })
    ).rejects.toThrow('operation in progress');
    processes.at(-1)!.exit();
    await close;
    expect(manager.list()).toHaveLength(0);
  });
});
