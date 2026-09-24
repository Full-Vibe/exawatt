import type { IpcMainInvokeEvent, MessageBoxOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShutdownCoordinator, shutdownCopy } from './shutdown-coordinator';
import {
  createBeforeQuitHandler,
  createCheckpointBroker,
  createShutdownSequence,
  type ShutdownSequenceDependencies,
} from './shutdown-sequence';

afterEach(() => {
  vi.useRealTimers();
});

interface FakeSession {
  exited: boolean;
  harness: string;
  durableSessionId: string;
  harnessSessionId?: string | null;
}

function fakeWindow(id = 11) {
  const sent: unknown[][] = [];
  return {
    sent,
    window: {
      isDestroyed: () => false,
      webContents: {
        id,
        send: (...args: unknown[]) => sent.push(args),
      },
    },
  };
}

const ownerEvent = (id: number) =>
  ({ sender: { id } }) as unknown as IpcMainInvokeEvent;

function call(
  channels: Record<string, unknown>,
  channel: string,
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) {
  return (channels[channel] as (...a: unknown[]) => unknown)(event, ...args);
}

/**
 * A whole shutdown against fakes at every boundary: the Session manager, the
 * workspace store, the renderer, native dialogs, and cleanup. `log` records
 * each step in the order it happens.
 */
function world(
  options: {
    sessions?: FakeSession[];
    env?: NodeJS.ProcessEnv;
    responses?: string[];
    dialogResponse?: number;
    /** Per-dialog answers, in order; `dialogResponse` answers the rest. */
    dialogResponses?: number[];
    renderer?: 'owner' | 'none';
    storedLayout?: unknown;
  } = {}
) {
  const log: string[] = [];
  const dialogs: MessageBoxOptions[] = [];
  const sessions = options.sessions ?? [];
  const broker = createCheckpointBroker({ randomUUID: () => 'req-1' });
  const { window, sent } = fakeWindow();
  if (options.renderer === 'owner') {
    void call(
      broker.channels,
      'app:set-workspace-checkpoint-owner',
      ownerEvent(window.webContents.id),
      true
    );
  }
  let stored = options.storedLayout ?? { tabs: [] };
  const deps: ShutdownSequenceDependencies = {
    productName: 'Exawatt',
    env: {
      ...(options.env ?? { EXAWATT_TEST: '1' }),
      ...(options.responses
        ? { EXAWATT_TEST_QUIT_RESPONSES: options.responses.join(', ') }
        : {}),
    },
    showMessageBox: async dialogOptions => {
      dialogs.push(dialogOptions);
      log.push(`dialog:${dialogOptions.title}`);
      return {
        response:
          options.dialogResponses?.shift() ?? options.dialogResponse ?? 1,
      };
    },
    window: () => window,
    allWindows: () => [window],
    checkpoints: broker,
    workspace: {
      load: async () => {
        log.push('workspace:load');
        return stored;
      },
      mergeHarnessIdentities: (state, ids) => {
        const tabs = (state as { tabs: FakeSession[] }).tabs;
        let changed = false;
        for (const tab of tabs) {
          const id = ids.get(tab.durableSessionId);
          if (id && tab.harnessSessionId !== id) {
            tab.harnessSessionId = id;
            changed = true;
          }
        }
        return changed;
      },
      save: async state => {
        log.push('workspace:save');
        stored = state;
      },
    },
    cleanup: [
      () => void log.push('cleanup:roadmap-watchers'),
      async () => {
        await new Promise(resolve => setImmediate(resolve));
        log.push('cleanup:pty');
      },
      () => void log.push('cleanup:renderer-server'),
    ],
    finalize: {
      installUpdate: () => void log.push('finalize:install-update'),
      relaunch: () => void log.push('finalize:relaunch'),
      quit: () => void log.push('finalize:quit'),
    },
    coordinator: () => coordinator,
    log: message => log.push(message),
    logError: message => log.push(`error:${message}`),
  };
  const sequence = createShutdownSequence(deps);
  const dependencies = sequence.coordinatorDependencies({
    sessions: {
      list: () => sessions as never,
      settleProviderIdentities: async () => void log.push('settle'),
      pauseCreates: () => void log.push('pause'),
      resumeCreates: () => void log.push('resume'),
      flushHistory: async () => void log.push('flush'),
      stopAll: async () => {
        log.push('stop-all');
        for (const session of sessions) session.exited = true;
      },
    },
    shutdownCopy,
    markClean: async () => void log.push('mark-clean'),
  });
  const coordinator = new ShutdownCoordinator(dependencies);
  return {
    log,
    dialogs,
    sent,
    broker,
    sequence,
    dependencies,
    coordinator,
    window,
  };
}

const agent = (id: string): FakeSession => ({
  exited: false,
  harness: 'claude',
  durableSessionId: id,
  harnessSessionId: `claude-${id}`,
});

describe('the shutdown sequence', () => {
  it('runs a confirmed quit in one order: pause, checkpoint, stop, checkpoint, mark clean, clean up, finalize', async () => {
    // The stored layout predates the harness identity the Session settled on,
    // so the pre-stop refresh lands it and the stopped refresh has nothing to
    // write.
    const { log, coordinator } = world({
      sessions: [agent('a')],
      storedLayout: { tabs: [{ ...agent('a'), harnessSessionId: null }] },
    });

    expect(await coordinator.request('quit')).toBe(true);

    expect(log).toEqual([
      'pause',
      'settle',
      'workspace:load',
      'workspace:save',
      'flush',
      'stop-all',
      'flush',
      'workspace:load',
      'mark-clean',
      'cleanup:roadmap-watchers',
      'cleanup:pty',
      'cleanup:renderer-server',
      'finalize:quit',
    ]);
    expect(coordinator.allowsFinalExit).toBe(true);
  });

  it('BUG-050: quits from a non-workspace surface with only stopped Sessions and opens no native dialog', async () => {
    const stopped = { ...agent('a'), exited: true };
    const { log, dialogs, coordinator } = world({
      sessions: [stopped],
      env: {},
      renderer: 'none',
      storedLayout: { tabs: [{ ...stopped }] },
    });

    expect(await coordinator.request('quit')).toBe(true);

    expect(dialogs).toEqual([]);
    expect(
      log.some(entry => entry.startsWith('[shutdown] native dialog'))
    ).toBe(false);
    expect(log[log.length - 1]).toBe('finalize:quit');
  });

  it('asks the owning renderer to checkpoint instead of writing the layout itself', async () => {
    const { log, sent, broker, coordinator, window } = world({
      renderer: 'owner',
    });
    const quitting = coordinator.request('quit');
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual([
      'app:checkpoint-request',
      { requestId: 'req-1', reason: 'quit', stage: 'pre-stop' },
    ]);

    await call(
      broker.channels,
      'app:complete-checkpoint',
      ownerEvent(window.webContents.id),
      'req-1',
      true
    );
    await vi.waitFor(() =>
      expect(
        sent.filter(([channel]) => channel === 'app:checkpoint-request')
      ).toHaveLength(2)
    );
    await call(
      broker.channels,
      'app:complete-checkpoint',
      ownerEvent(window.webContents.id),
      'req-1',
      true
    );

    expect(await quitting).toBe(true);
    expect(log).not.toContain('workspace:load');
    expect(log).toContain('mark-clean');
  });

  it('leaves the run unclean when the stopped checkpoint fails, and still finishes the quit', async () => {
    vi.useFakeTimers();
    const { log, coordinator } = world({
      renderer: 'owner',
      env: { EXAWATT_TEST: '1', EXAWATT_TEST_CHECKPOINT_FAILURE: 'confirm' },
    });
    const quitting = coordinator.request('quit');
    await vi.runAllTimersAsync();

    expect(await quitting).toBe(true);
    expect(log).not.toContain('mark-clean');
    expect(log[log.length - 1]).toBe('finalize:quit');
  });

  it('confirms live work with a native dialog outside automation, and names it first', async () => {
    const { log, dialogs, coordinator } = world({
      sessions: [agent('a')],
      env: {},
      dialogResponse: 0,
    });

    expect(await coordinator.request('quit')).toBe(false);

    expect(dialogs.map(dialog => dialog.buttons)).toEqual([
      ['Cancel', 'Quit and Stop'],
    ]);
    expect(log.slice(0, 2)).toEqual([
      '[shutdown] native dialog: confirm-quit',
      `dialog:${dialogs[0].title}`,
    ]);
    expect(log).toContain('resume');
    expect(log).not.toContain('stop-all');
  });

  it('answers the quit confirmation from automation in order, then from the standing answer', async () => {
    const first = world({
      sessions: [agent('a')],
      responses: ['cancel', 'confirm'],
    });
    expect(await first.coordinator.request('quit')).toBe(false);
    expect(await first.coordinator.request('quit')).toBe(true);
    expect(first.dialogs).toEqual([]);

    const standing = world({
      sessions: [agent('a')],
      env: { EXAWATT_TEST: '1', EXAWATT_TEST_QUIT_RESPONSE: 'cancel' },
    });
    expect(await standing.coordinator.request('quit')).toBe(false);
  });

  it('asks before quitting without a checkpoint, and stays open when refused', async () => {
    const { log, coordinator } = world({
      sessions: [agent('a')],
      env: {},
      // Confirm the live-work prompt, then refuse the checkpoint warning.
      dialogResponses: [1, 0],
      storedLayout: 'unreadable',
    });

    expect(await coordinator.request('quit')).toBe(false);

    expect(log).toContain('error:[shutdown] harness identity refresh failed');
    expect(log).toContain('[shutdown] native dialog: checkpoint-failed');
    expect(log).not.toContain('stop-all');
  });

  it('reports a Session it could not stop and stays open', async () => {
    const { log, dialogs, dependencies } = world({ env: {} });
    const failing = new ShutdownCoordinator({
      ...dependencies,
      stopProcesses: async () => {
        throw new Error('pid 42 ignored SIGKILL');
      },
    });

    expect(await failing.request('quit')).toBe(false);

    expect(log).toContain('[shutdown] native dialog: stop-failed');
    expect(dialogs[0].detail).toMatch(/^pid 42 ignored SIGKILL/);
    expect(log).not.toContain('finalize:quit');
  });

  it('hands an update restart to the installer instead of quitting', async () => {
    const { log, coordinator } = world();

    expect(await coordinator.request('update')).toBe(true);

    expect(log[log.length - 1]).toBe('finalize:install-update');
    expect(log).not.toContain('finalize:quit');
  });

  it('broadcasts each phase to open windows', async () => {
    const { sent, coordinator } = world({ sessions: [agent('a')] });
    await coordinator.request('quit');

    expect(
      sent
        .filter(([channel]) => channel === 'app:shutdown-status')
        .map(([, status]) => (status as { phase: string }).phase)
    ).toEqual(['confirming', 'checkpointing', 'stopping', 'finalizing']);
  });

  it('restarts through the coordinator only when the operator chooses Restart', async () => {
    const declined = world({ env: {}, dialogResponse: 0 });
    await declined.sequence.promptWindowManagementRestart();
    expect(declined.log).not.toContain('finalize:relaunch');

    const accepted = world({ env: {}, dialogResponse: 1 });
    await accepted.sequence.promptWindowManagementRestart();
    expect(accepted.log[0]).toBe(
      '[shutdown] native dialog: window-management-restart'
    );
    expect(accepted.log.slice(-2)).toEqual([
      'finalize:relaunch',
      'finalize:quit',
    ]);
  });
});

describe('createCheckpointBroker', () => {
  it('answers false when the renderer never completes the checkpoint', async () => {
    vi.useFakeTimers();
    const broker = createCheckpointBroker({ randomUUID: () => 'r' });
    const { window } = fakeWindow();
    const answer = broker.request(window, 'quit', 'pre-stop');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await answer).toBe(false);
  });

  it('ignores completions for requests it did not make, and malformed ones', async () => {
    vi.useFakeTimers();
    const broker = createCheckpointBroker({ randomUUID: () => 'r' });
    const { window } = fakeWindow();
    const answer = broker.request(window, 'quit', 'pre-stop');
    await call(
      broker.channels,
      'app:complete-checkpoint',
      ownerEvent(1),
      'other',
      true
    );
    await call(
      broker.channels,
      'app:complete-checkpoint',
      ownerEvent(1),
      'r',
      'yes'
    );
    await call(
      broker.channels,
      'app:complete-checkpoint',
      ownerEvent(1),
      'r',
      true
    );
    expect(await answer).toBe(true);
  });

  it('tracks ownership per web contents, set by the renderer and released by main', async () => {
    const broker = createCheckpointBroker({ randomUUID: () => 'r' });
    await call(
      broker.channels,
      'app:set-workspace-checkpoint-owner',
      ownerEvent(4),
      true
    );
    await call(
      broker.channels,
      'app:set-workspace-checkpoint-owner',
      ownerEvent(5),
      'yes'
    );
    expect(broker.owns(4)).toBe(true);
    expect(broker.owns(5)).toBe(false);

    broker.release(4);
    expect(broker.owns(4)).toBe(false);

    await call(
      broker.channels,
      'app:set-workspace-checkpoint-owner',
      ownerEvent(4),
      true
    );
    await call(
      broker.channels,
      'app:set-workspace-checkpoint-owner',
      ownerEvent(4),
      false
    );
    expect(broker.owns(4)).toBe(false);
  });
});

describe('createBeforeQuitHandler', () => {
  function harness(
    coordinator: {
      allowsFinalExit: boolean;
      request: (intent: string) => Promise<boolean>;
    } | null
  ) {
    const log: string[] = [];
    let stopResult: Promise<void> = Promise.resolve();
    const handler = createBeforeQuitHandler({
      disposeServices: () => log.push('dispose'),
      coordinator: () => coordinator as never,
      stopRendererServer: () => {
        log.push('stop-renderer');
        return stopResult;
      },
      quit: () => log.push('quit'),
      logError: message => log.push(`error:${message}`),
    });
    const quitEvent = () => {
      let prevented = false;
      handler({ preventDefault: () => (prevented = true) });
      return prevented;
    };
    return {
      log,
      quitEvent,
      failStop: () => {
        stopResult = Promise.reject(new Error('stuck'));
      },
    };
  }

  it('before the command runtime exists, stops the renderer server and then quits, once', async () => {
    const { log, quitEvent } = harness(null);

    expect(quitEvent()).toBe(true);
    await vi.waitFor(() => expect(log).toContain('quit'));
    // The app.quit() that follows lands here again and must pass through.
    expect(quitEvent()).toBe(false);

    expect(log).toEqual(['dispose', 'stop-renderer', 'quit', 'dispose']);
  });

  it('still quits when the renderer server will not stop', async () => {
    const { log, quitEvent, failStop } = harness(null);
    failStop();
    quitEvent();
    await vi.waitFor(() => expect(log).toContain('quit'));
    expect(log).toContain('error:[shutdown] renderer stop failed');
  });

  it('routes every quit through the coordinator, and lets its final exit through', () => {
    const requests: string[] = [];
    const coordinator = {
      allowsFinalExit: false,
      request: async (intent: string) => {
        requests.push(intent);
        return true;
      },
    };
    const { quitEvent } = harness(coordinator);

    expect(quitEvent()).toBe(true);
    expect(requests).toEqual(['quit']);

    coordinator.allowsFinalExit = true;
    expect(quitEvent()).toBe(false);
    expect(requests).toEqual(['quit']);
  });
});
