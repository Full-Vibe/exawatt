import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopChildProcess } from './child-process-lifecycle';

function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: ReturnType<typeof vi.fn>;
  };
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.kill = vi.fn(() => true);
  return emitter as unknown as ChildProcess;
}

afterEach(() => vi.useRealTimers());

describe('stopChildProcess', () => {
  it('waits for the child close event after SIGTERM', async () => {
    const child = fakeChild();
    const stopping = stopChildProcess(child, {
      forceAfterMs: 50,
      failAfterMs: 100,
      failureMessage: 'did not stop',
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 0, 'SIGTERM');
    await expect(stopping).resolves.toBeUndefined();
  });

  it('escalates, then rejects without pretending the child stopped', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const stopping = stopChildProcess(child, {
      forceAfterMs: 50,
      failAfterMs: 100,
      failureMessage: 'did not stop',
    });
    const rejection = expect(stopping).rejects.toThrow('did not stop');
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });

  it('rejects when forced termination itself fails', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    vi.mocked(child.kill)
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => {
        throw new Error('kill failed');
      });
    const stopping = stopChildProcess(child, {
      forceAfterMs: 50,
      failAfterMs: 100,
      failureMessage: 'did not stop',
    });
    const rejection = expect(stopping).rejects.toThrow('kill failed');
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });
});
