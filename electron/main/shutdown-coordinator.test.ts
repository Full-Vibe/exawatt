import { describe, expect, it, vi } from 'vitest';
import {
  ShutdownCoordinator,
  shutdownCopy,
  type ShutdownDependencies,
} from './shutdown-coordinator';

function dependencies(overrides: Partial<ShutdownDependencies> = {}) {
  const order: string[] = [];
  const deps: ShutdownDependencies = {
    countLive: () => ({ agents: 2, shells: 1 }),
    confirm: async () => (order.push('confirm'), true),
    checkpoint: async (_intent, stage) => (
      order.push(`checkpoint:${stage}`),
      true
    ),
    confirmWithoutCheckpoint: async () => true,
    pauseNewWork: () => undefined,
    resumeNewWork: () => undefined,
    flushHistory: async () => void order.push('flush'),
    stopProcesses: async () => void order.push('stop'),
    markClean: async () => void order.push('clean'),
    cleanup: async () => void order.push('cleanup'),
    finalize: intent => void order.push(`final:${intent}`),
    ...overrides,
  };
  return { deps, order };
}

describe('ShutdownCoordinator', () => {
  it('cancels without checkpointing or stopping', async () => {
    const { deps, order } = dependencies({ confirm: async () => false });
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('quit')).resolves.toBe(false);
    expect(order).toEqual([]);
    expect(coordinator.phase).toBe('idle');
  });

  it('checkpoints, stops, marks clean, and finalizes in order', async () => {
    const { deps, order } = dependencies();
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('update')).resolves.toBe(true);
    expect(order).toEqual([
      'confirm',
      'checkpoint:pre-stop',
      'flush',
      'stop',
      'flush',
      'checkpoint:stopped',
      'clean',
      'cleanup',
      'final:update',
    ]);
    expect(coordinator.allowsFinalExit).toBe(true);
  });

  it('runs an operator restart through the same checkpoint-and-stop path', async () => {
    const { deps, order } = dependencies();
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('restart')).resolves.toBe(true);
    expect(order).toEqual([
      'confirm',
      'checkpoint:pre-stop',
      'flush',
      'stop',
      'flush',
      'checkpoint:stopped',
      'clean',
      'cleanup',
      'final:restart',
    ]);
    expect(coordinator.allowsFinalExit).toBe(true);
  });

  it('deduplicates concurrent quit requests', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const confirm = vi.fn(async () => {
      await waiting;
      return true;
    });
    const { deps } = dependencies({ confirm });
    const coordinator = new ShutdownCoordinator(deps);
    const first = coordinator.request('quit');
    const second = coordinator.request('quit');
    expect(first).toBe(second);
    release();
    await first;
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('requires explicit approval when the workspace checkpoint fails', async () => {
    const fallback = vi.fn(async () => false);
    const stop = vi.fn(async () => undefined);
    const { deps } = dependencies({
      checkpoint: async () => false,
      confirmWithoutCheckpoint: fallback,
      stopProcesses: stop,
    });
    await expect(new ShutdownCoordinator(deps).request('quit')).resolves.toBe(
      false
    );
    expect(fallback).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });

  it('broadcasts idle and reports dependency failures without finalizing', async () => {
    const phases: string[] = [];
    const failure = vi.fn(async () => undefined);
    const finalize = vi.fn();
    const { deps } = dependencies({
      stopProcesses: async () => {
        throw new Error('survivor');
      },
      failure,
      finalize,
      status: phase => void phases.push(phase),
    });
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('quit')).resolves.toBe(false);
    expect(failure).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
    expect(phases.at(-1)).toBe('idle');
  });

  it('never records a clean run when the post-stop checkpoint fails', async () => {
    const clean = vi.fn(async () => undefined);
    const finalize = vi.fn();
    const { deps } = dependencies({
      checkpoint: async (_intent, stage) => stage === 'pre-stop',
      markClean: clean,
      finalize,
    });
    await expect(new ShutdownCoordinator(deps).request('quit')).resolves.toBe(
      true
    );
    expect(clean).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith('quit');
  });
});

describe('shutdownCopy', () => {
  it('names agent and shell impact without implying shell resume', () => {
    expect(shutdownCopy('quit', { agents: 4, shells: 1 })).toEqual({
      title: 'Quit Exawatt and stop 4 agents?',
      detail:
        'Their sessions and terminal history will be saved. You can resume the agents after reopening Exawatt. 1 shell will also stop.',
    });
    expect(shutdownCopy('update', { agents: 0, shells: 2 }).title).toBe(
      'Restart Exawatt and stop 2 shells?'
    );
  });

  it('speaks of restarting, not quitting, for an operator restart', () => {
    expect(shutdownCopy('restart', { agents: 3, shells: 0 }).title).toBe(
      'Restart Exawatt and stop 3 agents?'
    );
  });

  it('uses the resolved distribution name', () => {
    expect(
      shutdownCopy(
        'quit',
        { agents: 1, shells: 0 },
        'Exawatt Community'
      )
    ).toEqual({
      title: 'Quit Exawatt Community and stop 1 agent?',
      detail:
        'Their sessions and terminal history will be saved. You can resume the agents after reopening Exawatt Community.',
    });
  });
});
