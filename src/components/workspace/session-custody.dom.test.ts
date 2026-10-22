/**
 * BUG-305: a window learns which Sessions are live from main's events, never
 * only from the list it read at mount.
 *
 * The renderer runs against main as the IPC boundary presents it, and no
 * more capably than `ipcRenderer`: every answer and every push crosses as a
 * structured clone on a later task, in the order main sent them, and a window
 * that reloaded receives nothing addressed to the page it replaced. Main's
 * side answers `pty:create` the way `ensureRunning` does (the live record, the
 * start already under way, or a new start) and pushes each start before its
 * answer; `session-ensure-running.test.ts` holds the real owner to that
 * contract in Node. No main-process module loads here: this is a DOM bundle.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopBridgePush,
  DesktopBridgePushChannel,
  PtyCreateOptions,
  PtyCreateResult,
  PtySessionInfo,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  ptySessionRecord,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import type { PersistedV7 } from './workspace-state/persisted-layout';

vi.mock('@/lib/projects/registry', () => ({
  openRepositoryProject: vi.fn(() => Promise.reject(new Error('offline'))),
  listProjects: vi.fn(() => Promise.resolve([])),
  renameProject: vi.fn(() => Promise.resolve()),
  reorderProjects: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
}));

const { useWorkspaceState } = await import('./use-workspace-state');

const project = '/workspace/project';
afterEach(() => {
  removeBridgeDouble();
});

/** The layout a reload reads back: one paused Claude Code Agent. */
function savedLayout(): PersistedV7 {
  return {
    v: 7,
    lastUsedDir: project,
    activeDir: project,
    projects: [
      {
        dir: project,
        name: 'project',
        color: '#111111',
        activeTabId: 'tab-1',
        tabs: [
          {
            kind: 'session',
            id: 'tab-1',
            durableSessionId: 'durable-1',
            harness: 'claude',
            title: 'Claude Code',
            titleKind: 'default',
            cwd: project,
            sessionId: null,
            harnessSessionId: 'conversation-1',
            roadmapItemId: null,
            lifecycle: 'stopped-clean',
            exitCode: null,
          },
        ],
      },
    ],
  };
}

/**
 * Main's Session owner as `pty:create` answers for it: one process per
 * durable Session, a start registered before its first await so a second
 * ask joins it, a start pushed to every window before its answer, and an
 * exit pushed when the process ends.
 */
function sessionOwner(broadcast: {
  start(session: PtySessionRecord): void;
  exit(session: PtySessionRecord): void;
}) {
  const records = new Map<string, PtySessionRecord>();
  const starts = new Map<string, Promise<PtySessionRecord>>();
  const created = new Set<() => void>();
  let next = 1;
  const live = (durableSessionId: string) =>
    [...records.values()].find(
      record => record.durableSessionId === durableSessionId && !record.exited
    );
  return {
    list: () => [...records.values()],
    ensureRunning(
      options: PtyCreateOptions,
      prepare: () => Promise<void> = async () => {}
    ): Promise<PtySessionRecord> {
      const durableSessionId =
        options.durableSessionId ?? `session-${next}-fresh`;
      const running = live(durableSessionId);
      if (running) return Promise.resolve({ ...running });
      const starting = starts.get(durableSessionId);
      if (starting) return starting;
      const started = (async () => {
        await prepare();
        for (const [id, record] of records)
          if (record.durableSessionId === durableSessionId) records.delete(id);
        const id = `pty-${next++}`;
        const record = ptySessionRecord({
          id,
          durableSessionId,
          harness: options.harness,
          title: options.title ?? options.harness,
          cwd: options.cwd ?? project,
          projectDir: options.cwd ?? project,
          projectName: 'project',
          harnessSessionId:
            options.harness === 'shell'
              ? null
              : (options.resumeSessionId ?? `conversation-${id}`),
          startedAt: Date.now(),
        });
        records.set(id, record);
        broadcast.start({ ...record });
        for (const resolve of [...created]) resolve();
        created.clear();
        return { ...record };
      })().finally(() => starts.delete(durableSessionId));
      starts.set(durableSessionId, started);
      return started;
    },
    /** The process ends by itself. */
    exit(id: string) {
      const record = records.get(id);
      if (!record || record.exited) return;
      Object.assign(record, { exited: true, exitCode: 0, exitSignal: null });
      broadcast.exit({ ...record });
    },
    /** Stop, await the exit, forget the record (`closeSession`). */
    close(durableSessionId: string) {
      const running = live(durableSessionId);
      if (running) this.exit(running.id);
      for (const [id, record] of records)
        if (record.durableSessionId === durableSessionId) records.delete(id);
    },
    nextStart: () => new Promise<void>(resolve => created.add(resolve)),
  };
}

/**
 * Main: the Session owner above, and `pty-ipc`'s door to it. `hold` stands in
 * for a slow readiness probe, which `ensureRunning` runs inside the start.
 */
function fakeMain() {
  let layout: unknown = savedLayout();
  let hold: { asked(): void; until: Promise<void> } | null = null;
  const windows = new Set<{
    alive: boolean;
    handlers: Map<string, Set<(payload: never) => void>>;
    send(deliver: () => void): void;
  }>();
  const broadcast = <C extends DesktopBridgePushChannel>(
    channel: C,
    payload: DesktopBridgePush<C>
  ) => {
    for (const win of windows)
      win.send(() => {
        for (const handler of win.handlers.get(channel) ?? [])
          (handler as (value: DesktopBridgePush<C>) => void)(
            structuredClone(payload)
          );
      });
  };
  const manager = sessionOwner({
    start: session => broadcast('pty:start', session),
    exit: ({ id, durableSessionId, exitCode, exitSignal }) =>
      broadcast('pty:exit', {
        id,
        durableSessionId,
        exitCode: exitCode ?? 0,
        exitSignal,
      }),
  });

  const listed = (): PtySessionInfo[] =>
    manager.list().map(record => ({
      ...record,
      contextSummary: null,
      goalVisual: null,
      attention: null,
      engaged: false,
      working: false,
      delegation: null,
    }));

  /** A window's preload: one ordered pipe; nothing reaches a reloaded page. */
  function openWindow() {
    const win = {
      alive: true,
      handlers: new Map<string, Set<(payload: never) => void>>(),
      send(deliver: () => void) {
        setTimeout(() => {
          if (win.alive) deliver();
        }, 0);
      },
    };
    windows.add(win);
    const invoke = <T>(answer: () => T | Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        void Promise.resolve()
          .then(answer)
          .then(
            value => win.send(() => resolve(structuredClone(value))),
            (error: Error) =>
              win.send(() =>
                reject(new Error(`Error invoking remote method: ${error}`))
              )
          );
      });
    const subscribe =
      <C extends DesktopBridgePushChannel>(channel: C) =>
      (handler: (payload: DesktopBridgePush<C>) => void) => {
        const set = win.handlers.get(channel) ?? new Set();
        set.add(handler as (payload: never) => void);
        win.handlers.set(channel, set);
        return () => set.delete(handler as (payload: never) => void);
      };
    installBridgeDouble({
      pty: {
        create: (options: PtyCreateOptions) =>
          invoke(async (): Promise<PtyCreateResult> => {
            try {
              const session = await manager.ensureRunning(
                structuredClone(options),
                async () => {
                  hold?.asked();
                  await hold?.until;
                }
              );
              return { ok: true, session };
            } catch (error) {
              return { ok: false, error: (error as Error).message };
            }
          }),
        list: () => invoke(listed),
        closeSession: (durableSessionId: string, discard = false) =>
          invoke(() => {
            void discard;
            manager.close(durableSessionId);
            return true;
          }),
        closedSessions: () => invoke(() => []),
        focus: () => invoke(() => undefined),
        onStart: subscribe('pty:start'),
        onExit: subscribe('pty:exit'),
        onIdentity: subscribe('pty:identity'),
      },
      workspace: {
        load: () => invoke(() => layout),
        save: (state: unknown) =>
          invoke(() => {
            layout = state;
          }),
        recovery: () => invoke(() => ({ previousRunInterrupted: false })),
      },
      settings: { get: () => invoke(() => ({}) as never) },
    });
    return {
      /** A reload: the page goes, and with it every answer still owed it. */
      reload() {
        win.alive = false;
        windows.delete(win);
      },
    };
  }

  return {
    manager,
    openWindow,
    /** Resolves once main has started the next process. */
    nextStart: manager.nextStart,
    /** Hold the next start where the readiness probe runs: `asked` once
     *  main has the ask, and nothing starts until `release`. */
    holdStarts() {
      let release!: () => void;
      let asked!: () => void;
      const reached = new Promise<void>(resolve => (asked = resolve));
      const until = new Promise<void>(resolve => (release = resolve));
      hold = { asked, until };
      return {
        asked: reached,
        release: () => {
          hold = null;
          release();
        },
      };
    },
  };
}

async function mountWindow(main: ReturnType<typeof fakeMain>) {
  const page = main.openWindow();
  const view = renderHook(() => useWorkspaceState());
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return { page, view };
}

function agentTab(view: Awaited<ReturnType<typeof mountWindow>>['view']) {
  const tab = view.result.current.projects[0]?.tabs[0];
  if (tab?.kind !== 'session') throw new Error('no Agent tab');
  return tab;
}

describe('Session custody (BUG-305)', () => {
  it('a reload during a resume attaches the tab to the process that started', async () => {
    const main = fakeMain();
    const first = await mountWindow(main);
    const { asked, release } = main.holdStarts();
    await act(async () => {
      void first.view.result.current.resumeTab('tab-1');
      await asked;
    });
    // The page reloads while main is still starting the Session.
    first.page.reload();
    first.view.unmount();

    const reloaded = await mountWindow(main);
    expect(main.manager.list()).toHaveLength(0);
    expect(agentTab(reloaded.view)).toMatchObject({ sessionId: null });

    const started = main.nextStart();
    await act(async () => {
      release();
      await started;
    });
    const [live] = main.manager.list();
    await waitFor(() =>
      expect(agentTab(reloaded.view)).toMatchObject({
        sessionId: live.id,
        lifecycle: 'running',
      })
    );
    expect(main.manager.list()).toHaveLength(1);
  });

  it('a Resume asked again during that start joins it', async () => {
    const main = fakeMain();
    const first = await mountWindow(main);
    const { asked, release } = main.holdStarts();
    await act(async () => {
      void first.view.result.current.resumeTab('tab-1');
      await asked;
    });
    first.page.reload();
    first.view.unmount();

    const reloaded = await mountWindow(main);
    let again!: Promise<boolean>;
    act(() => {
      again = reloaded.view.result.current.resumeTab('tab-1');
    });
    await act(async () => {
      release();
      expect(await again).toBe(true);
    });
    expect(reloaded.view.result.current.error).toBeNull();
    expect(main.manager.list()).toHaveLength(1);
    expect(agentTab(reloaded.view)).toMatchObject({
      sessionId: main.manager.list()[0].id,
      lifecycle: 'running',
    });
  });

  it('a second window sees a start and an exit without a reload', async () => {
    const main = fakeMain();
    const watching = await mountWindow(main);
    const acting = await mountWindow(main);
    await act(async () => {
      expect(await acting.view.result.current.resumeTab('tab-1')).toBe(true);
    });
    const [live] = main.manager.list();
    for (const window of [watching, acting])
      await waitFor(() =>
        expect(agentTab(window.view)).toMatchObject({
          sessionId: live.id,
          lifecycle: 'running',
        })
      );

    await act(async () => main.manager.exit(live.id));
    for (const window of [watching, acting])
      await waitFor(() =>
        expect(agentTab(window.view)).toMatchObject({
          sessionId: null,
          lifecycle: 'exited',
          resumeState: 'ended-resumable',
        })
      );
  });

  it('a Session started by another window becomes a tab here, once', async () => {
    const main = fakeMain();
    const watching = await mountWindow(main);
    await act(async () => {
      // Another window's ask, as it reaches main.
      await main.manager.ensureRunning({
        harness: 'shell',
        cwd: project,
        durableSessionId: 'started-elsewhere',
      });
    });
    await waitFor(() =>
      expect(
        watching.view.result.current.projects
          .flatMap(group => group.tabs)
          .filter(
            tab =>
              tab.kind === 'session' &&
              tab.durableSessionId === 'started-elsewhere'
          )
      ).toHaveLength(1)
    );
  });

  it('a launch from this window places one tab, not one per push', async () => {
    const main = fakeMain();
    const { view } = await mountWindow(main);
    await act(async () => {
      expect(
        await view.result.current.launch({ harness: 'shell', dir: project })
      ).toBe(true);
    });
    const [started] = main.manager.list();
    await waitFor(() =>
      expect(
        view.result.current.projects
          .flatMap(group => group.tabs)
          .filter(
            tab =>
              tab.kind === 'session' &&
              tab.durableSessionId === started.durableSessionId
          )
      ).toHaveLength(1)
    );
  });
});
