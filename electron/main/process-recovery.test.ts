import { describe, expect, it } from 'vitest';
import {
  RECOVERY_BUDGET,
  createRecoveryBudget,
  createRendererRecovery,
  createRendererServerSupervisor,
  recordChildProcessGone,
  type RecoverableWindow,
  type RecoveryChoice,
} from './process-recovery';

interface Recorded {
  event: string;
  fields: Record<string, unknown>;
}

function recorder() {
  const events: Recorded[] = [];
  return {
    events,
    record: (event: string, fields: Record<string, unknown> = {}) => {
      events.push({ event, fields });
    },
  };
}

/** The window surface recovery touches: liveness and one reload. */
class FakeWindow implements RecoverableWindow {
  destroyed = false;
  reloads = 0;
  isDestroyed = () => this.destroyed;
  webContents = {
    reload: () => {
      this.reloads += 1;
    },
  };
}

const killed = { reason: 'killed', exitCode: 9 };

function rendererHarness() {
  let now = 0;
  let quitting = false;
  const log = recorder();
  const asked: RecoverableWindow[] = [];
  const answers: Array<(choice: RecoveryChoice) => void> = [];
  let quits = 0;
  const deferred: Array<() => void> = [];
  const recovery = createRendererRecovery({
    record: log.record,
    isQuitting: () => quitting,
    askToReload: win => {
      asked.push(win);
      return new Promise(resolve => answers.push(resolve));
    },
    quit: () => {
      quits += 1;
    },
    now: () => now,
    defer: run => deferred.push(run),
  });
  return {
    recovery,
    events: log.events,
    asked,
    answer: async (choice: RecoveryChoice) => {
      answers.shift()?.(choice);
      await new Promise(resolve => setImmediate(resolve));
    },
    quits: () => quits,
    flush: () => deferred.splice(0).forEach(run => run()),
    advance: (ms: number) => {
      now += ms;
    },
    quitting: () => {
      quitting = true;
    },
  };
}

describe('createRecoveryBudget', () => {
  it('allows a fixed number of attempts per window and renews as they age out', () => {
    let now = 0;
    const budget = createRecoveryBudget(
      { attempts: 2, windowMs: 1_000 },
      () => now
    );
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(false);
    now = 1_000;
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(false);
    budget.reset();
    expect(budget.spend()).toBe(true);
  });
});

describe('createRendererRecovery', () => {
  it('reloads a window whose renderer was killed, and records why', () => {
    const h = rendererHarness();
    const win = new FakeWindow();

    h.recovery.rendererGone(win, killed);
    // Deferred out of Chromium's own notification.
    expect(win.reloads).toBe(0);
    h.flush();

    expect(win.reloads).toBe(1);
    expect(h.events).toEqual([
      {
        event: 'renderer.gone',
        fields: { reason: 'killed', exitCode: 9, action: 'reload' },
      },
    ]);
  });

  it('never restarts a renderer once shutdown owns the processes', () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    h.quitting();

    h.recovery.rendererGone(win, killed);
    h.flush();

    expect(win.reloads).toBe(0);
    expect(h.events[0].fields.action).toBe('none');
  });

  it('does not reload a window destroyed before the deferred reload runs', () => {
    const h = rendererHarness();
    const win = new FakeWindow();

    h.recovery.rendererGone(win, killed);
    win.destroyed = true;
    h.flush();

    expect(win.reloads).toBe(0);
  });

  it('stops reloading a renderer that keeps dying and asks instead, once', async () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    for (let i = 0; i < RECOVERY_BUDGET.attempts; i += 1) {
      h.recovery.rendererGone(win, killed);
      h.flush();
    }
    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts);

    h.recovery.rendererGone(win, { reason: 'crashed', exitCode: 11 });
    h.recovery.rendererGone(win, { reason: 'crashed', exitCode: 11 });
    h.flush();

    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts);
    expect(h.asked).toEqual([win]);
    expect(h.events[h.events.length - 1]?.fields.action).toBe('ask');
  });

  it('reloads on the operator’s answer and gives automatic recovery its budget back', async () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    for (let i = 0; i <= RECOVERY_BUDGET.attempts; i += 1) {
      h.recovery.rendererGone(win, killed);
      h.flush();
    }

    await h.answer('reload');
    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts + 1);

    h.recovery.rendererGone(win, killed);
    h.flush();
    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts + 2);
    expect(h.asked).toHaveLength(1);
  });

  it('quits on the operator’s answer', async () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    for (let i = 0; i <= RECOVERY_BUDGET.attempts; i += 1) {
      h.recovery.rendererGone(win, killed);
      h.flush();
    }

    await h.answer('quit');

    expect(h.quits()).toBe(1);
    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts);
  });

  it('recovers automatically again once earlier deaths age out of the window', () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    for (let i = 0; i < RECOVERY_BUDGET.attempts; i += 1) {
      h.recovery.rendererGone(win, killed);
      h.flush();
    }
    h.advance(RECOVERY_BUDGET.windowMs);

    h.recovery.rendererGone(win, killed);
    h.flush();

    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts + 1);
    expect(h.asked).toEqual([]);
  });
});

describe('recordChildProcessGone', () => {
  it('records a helper that died, with Chromium’s reason and identity', () => {
    const log = recorder();
    recordChildProcessGone(log.record, {
      type: 'GPU',
      reason: 'killed',
      exitCode: 9,
      serviceName: 'GPU',
    });
    expect(log.events).toEqual([
      {
        event: 'child.gone',
        fields: {
          type: 'GPU',
          reason: 'killed',
          exitCode: 9,
          serviceName: 'GPU',
          name: null,
        },
      },
    ]);
  });

  it('does not treat an idle service ending on purpose as a death', () => {
    const log = recorder();
    recordChildProcessGone(log.record, {
      type: 'Utility',
      reason: 'clean-exit',
      exitCode: 0,
    });
    expect(log.events).toEqual([]);
  });
});

describe('createRendererServerSupervisor', () => {
  function supervisorHarness(restart: () => Promise<unknown>) {
    const log = recorder();
    let quitting = false;
    let reloads = 0;
    let now = 0;
    const supervisor = createRendererServerSupervisor({
      record: log.record,
      isQuitting: () => quitting,
      restart,
      reloadWorkspace: () => {
        reloads += 1;
      },
      now: () => now,
    });
    return {
      supervisor,
      events: log.events,
      reloads: () => reloads,
      quitting: () => {
        quitting = true;
      },
      advance: (ms: number) => {
        now += ms;
      },
    };
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const sigkill = { code: null, signal: 'SIGKILL' };

  it('restarts a server killed from outside, then reloads the workspace', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
    });

    h.supervisor.exited(sigkill);
    await settle();

    expect(restarts).toBe(1);
    expect(h.reloads()).toBe(1);
    expect(h.events.map(e => [e.event, e.fields.action])).toEqual([
      ['renderer-server.exited', 'restart'],
      ['renderer-server.restarted', undefined],
    ]);
  });

  it('records a restart that fails and does not reload onto a dead origin', async () => {
    const h = supervisorHarness(async () => {
      throw new Error('Packaged renderer exited with 1');
    });

    h.supervisor.exited(sigkill);
    await settle();

    expect(h.reloads()).toBe(0);
    expect(h.events[h.events.length - 1]).toEqual({
      event: 'renderer-server.restart-failed',
      fields: { message: 'Packaged renderer exited with 1' },
    });
  });

  it('leaves a server that keeps dying down instead of restarting it forever', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
    });
    for (let i = 0; i <= RECOVERY_BUDGET.attempts; i += 1) {
      h.supervisor.exited(sigkill);
      await settle();
    }

    expect(restarts).toBe(RECOVERY_BUDGET.attempts);
    expect(h.events[h.events.length - 1]?.fields.action).toBe('give-up');
  });

  it('never restarts during shutdown', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
    });
    h.quitting();

    h.supervisor.exited({ code: 0, signal: null });
    await settle();

    expect(restarts).toBe(0);
    expect(h.events[0].fields.action).toBe('none');
  });

  it('runs one restart at a time', async () => {
    let restarts = 0;
    let finish: () => void = () => {};
    const h = supervisorHarness(() => {
      restarts += 1;
      return new Promise<void>(resolve => {
        finish = resolve;
      });
    });

    h.supervisor.exited(sigkill);
    h.supervisor.exited(sigkill);
    finish();
    await settle();

    expect(restarts).toBe(1);
    expect(h.reloads()).toBe(1);
  });
});
