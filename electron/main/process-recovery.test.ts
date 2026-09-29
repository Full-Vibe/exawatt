import { describe, expect, it } from 'vitest';
import {
  RECOVERY_BUDGET,
  createRecoveryBudget,
  createRendererRecovery,
  createRendererServerSupervisor,
  recordChildProcessGone,
  sharedRecoveryPrompt,
  type HangChoice,
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

/** The window surface recovery touches: liveness, crash and loading state,
 *  a reload, and ending a renderer that is hung (Electron's
 *  `forcefullyCrashRenderer`). */
class FakeWindow implements RecoverableWindow {
  destroyed = false;
  crashed = false;
  loading = false;
  reloads = 0;
  crashes = 0;
  private stoppedLoading: Array<() => void> = [];
  isDestroyed = () => this.destroyed;
  webContents = {
    reload: () => {
      this.reloads += 1;
      this.crashed = false;
    },
    forcefullyCrashRenderer: () => {
      this.crashes += 1;
    },
    isCrashed: () => this.crashed,
    isLoading: () => this.loading,
    once: (_event: 'did-stop-loading', listener: () => void) => {
      this.stoppedLoading.push(listener);
    },
  };
  /** A navigation in flight ends, landed or not. */
  stopLoading(landed: boolean): void {
    this.loading = false;
    if (landed) this.crashed = false;
    this.stoppedLoading.splice(0).forEach(listener => listener());
  }
}

const killed = { reason: 'killed', exitCode: 9 };

function rendererHarness() {
  let now = 0;
  let quitting = false;
  const log = recorder();
  const asked: number[] = [];
  const answers: Array<(choice: RecoveryChoice) => void> = [];
  const hangQuestions: Array<{
    signal: AbortSignal;
    answer: (choice: HangChoice) => void;
  }> = [];
  let quits = 0;
  const deferred: Array<() => void> = [];
  const recovery = createRendererRecovery({
    record: log.record,
    isQuitting: () => quitting,
    ask: () => {
      asked.push(asked.length + 1);
      return new Promise(resolve => answers.push(resolve));
    },
    askWhileUnresponsive: (_win, signal) =>
      new Promise(resolve => hangQuestions.push({ signal, answer: resolve })),
    quit: () => {
      quits += 1;
    },
    now: () => now,
    defer: run => deferred.push(run),
  });
  return {
    // Chromium reports a renderer gone once its web contents reads crashed.
    recovery: {
      ...recovery,
      rendererGone: (
        win: FakeWindow,
        details: { reason: string; exitCode: number }
      ) => {
        win.crashed = true;
        recovery.rendererGone(win, details);
      },
    },
    events: log.events,
    asked,
    answer: async (choice: RecoveryChoice) => {
      answers.shift()?.(choice);
      await new Promise(resolve => setImmediate(resolve));
    },
    hangQuestions,
    answerHang: async (choice: HangChoice) => {
      hangQuestions.shift()?.answer(choice);
      await new Promise(resolve => setImmediate(resolve));
    },
    quits: () => quits,
    flush: () => deferred.splice(0).forEach(run => run()),
    advance: (ms: number) => {
      now += ms;
    },
    quitting: (value = true) => {
      quitting = value;
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

  it('lets a navigation in flight when the renderer died land instead of reloading over it', () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    win.loading = true;

    h.recovery.rendererGone(win, killed);
    h.flush();
    expect(win.reloads).toBe(0);

    win.stopLoading(true);
    expect(win.reloads).toBe(0);
  });

  it('reloads once that navigation ends without bringing the window back', () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    win.loading = true;

    h.recovery.rendererGone(win, killed);
    h.flush();
    win.stopLoading(false);

    expect(win.reloads).toBe(1);
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
    expect(h.asked).toHaveLength(1);
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

  it('records a prompt that could not be shown instead of dropping it', async () => {
    const log = recorder();
    const recovery = createRendererRecovery({
      record: log.record,
      isQuitting: () => false,
      ask: () => Promise.reject(new Error('no window to parent the dialog')),
      quit: () => {},
      now: () => 0,
      defer: run => run(),
    });
    const win = new FakeWindow();
    win.crashed = true;
    for (let i = 0; i <= RECOVERY_BUDGET.attempts; i += 1) {
      recovery.rendererGone(win, killed);
    }
    await new Promise(resolve => setImmediate(resolve));

    expect(log.events[log.events.length - 1]).toEqual({
      event: 'renderer.recovery-prompt-failed',
      fields: { message: 'no window to parent the dialog' },
    });
  });

  describe('when the operator cancels a quit', () => {
    it('reloads a window whose renderer died while shutdown owned it', () => {
      const h = rendererHarness();
      const died = new FakeWindow();
      const healthy = new FakeWindow();
      h.quitting();
      h.recovery.rendererGone(died, killed);
      h.flush();
      expect(died.reloads).toBe(0);

      h.quitting(false);
      h.recovery.shutdownCancelled([died, healthy]);

      expect(died.reloads).toBe(1);
      expect(healthy.reloads).toBe(0);
      expect(
        h.events.map(e => [e.event, e.fields.action ?? e.fields.after])
      ).toEqual([
        ['renderer.gone', 'none'],
        ['renderer.reloaded', 'cancelled-shutdown'],
      ]);
    });

    it('leaves a destroyed window alone', () => {
      const h = rendererHarness();
      const win = new FakeWindow();
      win.crashed = true;
      win.destroyed = true;

      h.recovery.shutdownCancelled([win]);

      expect(win.reloads).toBe(0);
      expect(h.events).toEqual([]);
    });
  });
});

describe('sharedRecoveryPrompt', () => {
  it('asks once while a prompt is open and gives every caller the same answer', async () => {
    let shown = 0;
    let answer: (choice: RecoveryChoice) => void = () => {};
    const ask = sharedRecoveryPrompt(() => {
      shown += 1;
      return new Promise(resolve => {
        answer = resolve;
      });
    });

    const first = ask();
    const second = ask();
    answer('reload');

    expect(await Promise.all([first, second])).toEqual(['reload', 'reload']);
    expect(shown).toBe(1);
    void ask();
    expect(shown).toBe(2);
  });
});

describe('a hung renderer (BUG-129)', () => {
  it('asks the operator once, and records when the hang began', () => {
    const h = rendererHarness();
    const win = new FakeWindow();

    h.recovery.rendererUnresponsive(win);
    h.recovery.rendererUnresponsive(win);

    expect(h.hangQuestions).toHaveLength(1);
    expect(h.events.map(e => e.event)).toEqual(['renderer.unresponsive']);
  });

  it('withdraws the question when the page recovers on its own', async () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    h.recovery.rendererUnresponsive(win);
    h.advance(4_000);

    h.recovery.rendererResponsive();
    expect(h.hangQuestions[0].signal.aborted).toBe(true);
    // A late answer from a withdrawn question changes nothing.
    await h.answerHang('reload');

    expect(win.crashes).toBe(0);
    expect(h.events[h.events.length - 1]).toEqual({
      event: 'renderer.responsive',
      fields: { afterMs: 4_000 },
    });
  });

  it('ends the stuck renderer on Reload and reloads it without spending the automatic budget', async () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    // The automatic budget is already spent by earlier deaths.
    for (let i = 0; i < RECOVERY_BUDGET.attempts; i += 1) {
      h.recovery.rendererGone(win, killed);
      h.flush();
    }

    h.recovery.rendererUnresponsive(win);
    await h.answerHang('reload');
    expect(win.crashes).toBe(1);

    // Chromium then reports the renderer it just ended.
    h.recovery.rendererGone(win, { reason: 'crashed', exitCode: 0 });
    h.flush();

    expect(win.reloads).toBe(RECOVERY_BUDGET.attempts + 1);
    expect(h.asked).toEqual([]);
    expect(h.events[h.events.length - 1].fields).toMatchObject({
      action: 'reload',
      requested: true,
    });
  });

  it('leaves the window alone on Wait', async () => {
    const h = rendererHarness();
    const win = new FakeWindow();
    h.recovery.rendererUnresponsive(win);

    await h.answerHang('wait');

    expect(win.crashes).toBe(0);
    expect(h.events.map(e => e.event)).toEqual([
      'renderer.unresponsive',
      'renderer.unresponsive-choice',
    ]);
  });

  it('never asks while Exawatt is quitting', () => {
    const h = rendererHarness();
    h.quitting();
    h.recovery.rendererUnresponsive(new FakeWindow());
    expect(h.hangQuestions).toEqual([]);
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
    let down = false;
    let reloads = 0;
    let quits = 0;
    let now = 0;
    const answers: Array<(choice: RecoveryChoice) => void> = [];
    const supervisor = createRendererServerSupervisor({
      record: log.record,
      isQuitting: () => quitting,
      restart,
      isDown: () => down,
      reloadWorkspace: () => {
        reloads += 1;
      },
      ask: () => new Promise(resolve => answers.push(resolve)),
      quit: () => {
        quits += 1;
      },
      now: () => now,
    });
    return {
      supervisor,
      events: log.events,
      reloads: () => reloads,
      quits: () => quits,
      asked: () => answers.length,
      answer: async (choice: RecoveryChoice) => {
        answers.shift()?.(choice);
        await settle();
      },
      quitting: (value = true) => {
        quitting = value;
      },
      down: (value = true) => {
        down = value;
      },
      advance: (ms: number) => {
        now += ms;
      },
    };
  }
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  const sigkill = { code: null, signal: 'SIGKILL' };
  const actions = (events: Recorded[]) =>
    events.map(e => [e.event, e.fields.action]);

  it('restarts a server killed from outside, then reloads the workspace', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
    });

    h.supervisor.exited(sigkill);
    await settle();

    expect(restarts).toBe(1);
    expect(h.reloads()).toBe(1);
    expect(actions(h.events)).toEqual([
      ['renderer-server.exited', 'restart'],
      ['renderer-server.restarted', undefined],
    ]);
  });

  it('retries a restart whose server dies while starting, within the budget', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
      if (restarts === 1) throw new Error('Packaged renderer exited with 1');
    });

    h.supervisor.exited(sigkill);
    await settle();

    expect(restarts).toBe(2);
    expect(h.reloads()).toBe(1);
    expect(actions(h.events)).toEqual([
      ['renderer-server.exited', 'restart'],
      ['renderer-server.restart-failed', 'retry'],
      ['renderer-server.restarted', undefined],
    ]);
    expect(h.events[1].fields.message).toBe('Packaged renderer exited with 1');
  });

  it('asks the operator once restarts keep failing, and never reloads onto a dead origin', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
      throw new Error('Timed out starting the packaged renderer');
    });

    h.supervisor.exited(sigkill);
    await settle();

    expect(restarts).toBe(RECOVERY_BUDGET.attempts);
    expect(h.reloads()).toBe(0);
    expect(h.asked()).toBe(1);
    expect(h.events[h.events.length - 1]?.fields.action).toBe('ask');
  });

  it('restarts with a fresh budget when the operator chooses Reload Window', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
      if (restarts <= RECOVERY_BUDGET.attempts) throw new Error('exited');
    });
    h.supervisor.exited(sigkill);
    await settle();

    await h.answer('reload');

    expect(restarts).toBe(RECOVERY_BUDGET.attempts + 1);
    expect(h.reloads()).toBe(1);
    expect(h.events).toContainEqual({
      event: 'renderer-server.recovery-choice',
      fields: { choice: 'reload' },
    });
  });

  it('quits when the operator chooses Quit', async () => {
    const h = supervisorHarness(async () => {
      throw new Error('exited');
    });
    h.supervisor.exited(sigkill);
    await settle();

    await h.answer('quit');

    expect(h.quits()).toBe(1);
  });

  it('asks instead of restarting a server that keeps dying', async () => {
    let restarts = 0;
    const h = supervisorHarness(async () => {
      restarts += 1;
    });
    for (let i = 0; i <= RECOVERY_BUDGET.attempts; i += 1) {
      h.supervisor.exited(sigkill);
      await settle();
    }

    expect(restarts).toBe(RECOVERY_BUDGET.attempts);
    expect(h.asked()).toBe(1);
    expect(h.events[h.events.length - 1]?.fields.action).toBe('ask');
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

  it('does not retry a failed restart once shutdown has begun', async () => {
    let restarts = 0;
    let fail: (error: Error) => void = () => {};
    const h = supervisorHarness(() => {
      restarts += 1;
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    });
    h.supervisor.exited(sigkill);
    h.quitting();
    fail(new Error('Packaged renderer exited with SIGTERM'));
    await settle();

    expect(restarts).toBe(1);
    expect(h.events[h.events.length - 1]?.fields.action).toBe('none');
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

  describe('when the operator cancels a quit', () => {
    it('serves again if shutdown had stopped the server', async () => {
      let restarts = 0;
      const h = supervisorHarness(async () => {
        restarts += 1;
      });
      h.down();

      h.supervisor.shutdownCancelled();
      await settle();

      expect(restarts).toBe(1);
      expect(h.reloads()).toBe(1);
      expect(actions(h.events)).toEqual([
        ['renderer-server.resumed', 'restart'],
        ['renderer-server.restarted', undefined],
      ]);
    });

    it('leaves a server that is still serving alone', async () => {
      let restarts = 0;
      const h = supervisorHarness(async () => {
        restarts += 1;
      });

      h.supervisor.shutdownCancelled();
      await settle();

      expect(restarts).toBe(0);
      expect(h.events).toEqual([]);
    });
  });
});
