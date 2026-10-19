import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownStatus } from '@exawatt/core/desktop-bridge';
import {
  SHUTDOWN_WAITS,
  ShutdownCoordinator,
  shutdownCopy,
  type ShutdownDependencies,
} from './shutdown-coordinator';

const never = <T>() => new Promise<T>(() => undefined);

function dependencies(overrides: Partial<ShutdownDependencies> = {}) {
  const order: string[] = [];
  const statuses: ShutdownStatus[] = [];
  const deps: ShutdownDependencies = {
    countLive: () => ({ agents: 2, shells: 1 }),
    confirm: async () => (order.push('confirm'), true),
    prepareUpdate: async () => (order.push('prepare'), null),
    updateRefused: reason => void order.push(`refused:${reason}`),
    pauseNewWork: () => void order.push('pause'),
    resumeNewWork: () => void order.push('resume'),
    settleStarts: async () => void order.push('settle'),
    captureHeldState: async intent => void order.push(`held:${intent}`),
    checkpoint: async (_intent, stage) => (
      order.push(`checkpoint:${stage}`),
      true
    ),
    confirmWithoutCheckpoint: async () => true,
    flushHistory: async () => void order.push('flush'),
    stopProcesses: async () => void order.push('stop'),
    markClean: async () => void order.push('clean'),
    closing: [{ name: 'services', run: () => void order.push('close') }],
    handOff: async intent => (order.push(`handoff:${intent}`), null),
    relaunchAfterFailedInstall: async reason =>
      void order.push(`relaunch:${reason}`),
    status: status => void statuses.push(status),
    ...overrides,
  };
  return { deps, order, statuses };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ShutdownCoordinator', () => {
  it('cancels without checkpointing or stopping', async () => {
    const { deps, order } = dependencies({
      confirm: async () => false,
    });
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('quit')).resolves.toBe(false);
    expect(order).toEqual(['resume']);
    expect(coordinator.phase).toBe('idle');
  });

  it('runs the phases in one order and hands off last', async () => {
    const { deps, order } = dependencies();
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('update')).resolves.toBe(true);
    expect(order).toEqual([
      'confirm',
      'prepare',
      'pause',
      'settle',
      'held:update',
      'checkpoint:pre-stop',
      'flush',
      'stop',
      'flush',
      'checkpoint:stopped',
      'clean',
      'close',
      'handoff:update',
    ]);
    expect(coordinator.allowsFinalExit).toBe(true);
  });

  it('saves held state for a restart but not for a quit', async () => {
    for (const intent of ['quit', 'restart'] as const) {
      const { deps, order } = dependencies();
      await new ShutdownCoordinator(deps).request(intent);
      expect(order.includes(`held:${intent}`)).toBe(intent === 'restart');
      expect(order).not.toContain('prepare');
    }
  });

  // BUG-286: the installer used to see the update only after every agent
  // had stopped, so its refusal stranded the app on "Closing…".
  it('stops nothing and returns to idle when the installer refuses the update', async () => {
    const { deps, order, statuses } = dependencies({
      prepareUpdate: async () => (order.push('prepare'), 'bundle mismatch'),
    });
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('update')).resolves.toBe(false);
    expect(order).toEqual([
      'confirm',
      'prepare',
      'refused:bundle mismatch',
      'resume',
    ]);
    expect(
      statuses
        .map(status => status.phase)
        .filter((phase, index, all) => phase !== all[index - 1])
    ).toEqual(['confirming', 'preparing', 'idle']);
    expect(coordinator.allowsFinalExit).toBe(false);
  });

  // BUG-286: every wait is named, bounded, and cancellable while nothing has
  // stopped. A hung installer used to be three silent minutes of "Preparing…".
  it('names the installer wait at once and lets the operator cancel it', async () => {
    const { deps, order, statuses } = dependencies({
      prepareUpdate: () => never(),
    });
    const coordinator = new ShutdownCoordinator(deps);
    const result = coordinator.request('update');
    await vi.waitFor(() =>
      expect(coordinator.status).toMatchObject({
        phase: 'preparing',
        waitingOn: 'update-staging',
        cancellable: true,
      })
    );
    expect(coordinator.cancel()).toBe(true);
    await expect(result).resolves.toBe(false);
    expect(order).not.toContain('stop');
    expect(order).not.toContain('pause');
    expect(statuses.at(-1)).toMatchObject({ phase: 'idle', waitingOn: null });
  });

  it('reports a hung installer at its deadline with every Session still running', async () => {
    vi.useFakeTimers();
    const { deps, order } = dependencies({ prepareUpdate: () => never() });
    const result = new ShutdownCoordinator(deps).request('update');
    await vi.advanceTimersByTimeAsync(
      SHUTDOWN_WAITS['update-staging'].deadlineMs
    );
    await expect(result).resolves.toBe(false);
    expect(order.find(step => step.startsWith('refused:'))).toMatch(
      /did not finish within 180 seconds/
    );
    expect(order).not.toContain('stop');
  });

  it('cannot be cancelled once Sessions are stopping', async () => {
    let release!: () => void;
    const { deps } = dependencies({
      stopProcesses: () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    });
    const coordinator = new ShutdownCoordinator(deps);
    const result = coordinator.request('quit');
    await vi.waitFor(() => expect(coordinator.phase).toBe('stopping'));
    expect(coordinator.cancel()).toBe(false);
    release();
    await expect(result).resolves.toBe(true);
  });

  it('ends the shutdown, naming the cause, when an agent never finishes starting', async () => {
    vi.useFakeTimers();
    const failure = vi.fn();
    const { deps, order, statuses } = dependencies({
      settleStarts: () => never(),
      failure,
    });
    const result = new ShutdownCoordinator(deps).request('quit');
    await vi.advanceTimersByTimeAsync(
      SHUTDOWN_WAITS['agents-starting'].visibleAfterMs
    );
    expect(statuses.at(-1)).toMatchObject({
      waitingOn: 'agents-starting',
      cancellable: true,
    });
    await vi.advanceTimersByTimeAsync(
      SHUTDOWN_WAITS['agents-starting'].deadlineMs
    );
    await expect(result).resolves.toBe(false);
    expect(order).not.toContain('stop');
    expect(String(failure.mock.calls[0]?.[0])).toMatch(/still starting/);
  });

  // BUG-286 class, reproduced on the pre-owner coordinator: a closing step
  // that never settled left the window on "Closing…" for good and the
  // installer was never reached.
  it('skips a closing step that never settles and still hands off', async () => {
    vi.useFakeTimers();
    const record = vi.fn();
    const { deps, order } = dependencies({
      closing: [
        { name: 'stuck', run: () => never() },
        { name: 'after', run: () => void order.push('after') },
      ],
      record,
    });
    const result = new ShutdownCoordinator(deps).request('update');
    await vi.advanceTimersByTimeAsync(
      SHUTDOWN_WAITS['services-closing'].deadlineMs
    );
    await expect(result).resolves.toBe(true);
    expect(order.slice(-2)).toEqual(['after', 'handoff:update']);
    expect(record).toHaveBeenCalledWith('shutdown.step-skipped', {
      step: 'stuck',
    });
  });

  it('records a closing step that fails and continues', async () => {
    const record = vi.fn();
    const { deps, order } = dependencies({
      closing: [
        {
          name: 'renderer-server',
          run: async () => {
            throw new Error('did not stop');
          },
        },
      ],
      record,
    });
    await expect(new ShutdownCoordinator(deps).request('quit')).resolves.toBe(
      true
    );
    expect(order.at(-1)).toBe('handoff:quit');
    expect(record).toHaveBeenCalledWith('shutdown.step-failed', {
      step: 'renderer-server',
      message: 'did not stop',
    });
  });

  it('relaunches the current version when the install fails after everything stopped', async () => {
    const { deps, order } = dependencies({
      handOff: async () => 'Code signature did not pass validation',
    });
    await expect(new ShutdownCoordinator(deps).request('update')).resolves.toBe(
      true
    );
    expect(order.at(-1)).toBe(
      'relaunch:Code signature did not pass validation'
    );
  });

  it('relaunches the current version when the installer never ends the app', async () => {
    vi.useFakeTimers();
    const { deps, order } = dependencies({ handOff: () => never() });
    const result = new ShutdownCoordinator(deps).request('update');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_WAITS.installer.deadlineMs);
    await expect(result).resolves.toBe(true);
    expect(order.at(-1)).toMatch(
      /^relaunch:Installing the update did not finish/
    );
  });

  it('keeps going without held state when capturing it fails', async () => {
    const record = vi.fn();
    const { deps, order } = dependencies({
      captureHeldState: async () => {
        throw new Error('no window');
      },
      record,
    });
    await expect(
      new ShutdownCoordinator(deps).request('restart')
    ).resolves.toBe(true);
    expect(order).toContain('handoff:restart');
    expect(record).toHaveBeenCalledWith('shutdown.held-state-failed', {
      message: 'no window',
    });
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

  it('broadcasts idle and reports dependency failures without handing off', async () => {
    const failure = vi.fn(async () => undefined);
    const handOff = vi.fn(async () => null);
    const { deps, statuses } = dependencies({
      stopProcesses: async () => {
        throw new Error('survivor');
      },
      failure,
      handOff,
    });
    const coordinator = new ShutdownCoordinator(deps);
    await expect(coordinator.request('quit')).resolves.toBe(false);
    expect(failure).toHaveBeenCalledOnce();
    expect(handOff).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.phase).toBe('idle');
  });

  it('never records a clean run when the post-stop checkpoint fails', async () => {
    const clean = vi.fn(async () => undefined);
    const { deps, order } = dependencies({
      checkpoint: async (_intent, stage) => stage === 'pre-stop',
      markClean: clean,
    });
    await expect(new ShutdownCoordinator(deps).request('quit')).resolves.toBe(
      true
    );
    expect(clean).not.toHaveBeenCalled();
    expect(order.at(-1)).toBe('handoff:quit');
  });
});

describe('shutdownCopy', () => {
  it('names agent and shell impact without implying shell resume', () => {
    const counts = { agents: 4, shells: 1 };
    const copy = shutdownCopy('quit', counts);
    expect(copy.title).toContain(`${counts.agents} agents`);
    expect(copy.detail).toContain(`${counts.shells} shell`);
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
    const productName = 'Exawatt Community';
    expect(
      shutdownCopy('quit', { agents: 1, shells: 0 }, productName).title
    ).toContain(productName);
  });
});
