import { EventEmitter } from 'events';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { NativeAppearanceResolution } from './appearance';
import {
  createMainWindowController,
  createStartupScreen,
  createWorkspaceTarget,
  LAUNCH_SCREEN_COMMIT_MS,
  testWindowPosition,
  type MainWindowDependencies,
} from './window';
import { AX_TILEABLE_WINDOW_SHAPE } from './window-shape';

const WORKSPACE = 'http://127.0.0.1:23456/workspace';

/** The BrowserWindow surface the controller touches, and nothing more. */
class FakeWebContents extends EventEmitter {
  id = 7;
  url = '';
  permissionHandler:
    | ((
        wc: unknown,
        permission: string,
        callback: (ok: boolean) => void
      ) => void)
    | null = null;
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null =
    null;
  devTools: unknown[] = [];
  executed: string[] = [];
  reloads: string[] = [];
  getURL = () => this.url;
  reload = () => this.reloads.push('reload');
  reloadIgnoringCache = () => this.reloads.push('ignoring-cache');
  executeJavaScript = async (code: string) => {
    this.executed.push(code);
  };
  openDevTools = (options: unknown) => this.devTools.push(options);
  setWindowOpenHandler = (
    handler: (details: { url: string }) => { action: string }
  ) => {
    this.windowOpenHandler = handler;
  };
  session = {
    setPermissionRequestHandler: (
      handler: FakeWebContents['permissionHandler']
    ) => {
      this.permissionHandler = handler;
    },
  };
}

class FakeWindow extends EventEmitter {
  webContents = new FakeWebContents();
  destroyed = false;
  shownInactive = 0;
  minimized = false;
  calls: string[] = [];
  loaded: string[] = [];
  constructor(readonly options: BrowserWindowConstructorOptions) {
    super();
  }
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  restore = () => {
    this.minimized = false;
    this.calls.push('restore');
  };
  show = () => this.calls.push('show');
  focus = () => this.calls.push('focus');
  showInactive = () => {
    this.shownInactive += 1;
    this.calls.push('show-inactive');
  };
  loadURL = async (url: string) => {
    this.loaded.push(url);
    this.webContents.url = url;
  };
}

const appearance = {
  bootstrap: { background: '#101010' },
} as unknown as NativeAppearanceResolution;

function harness(overrides: Partial<MainWindowDependencies> = {}) {
  const windows: FakeWindow[] = [];
  const log: string[] = [];
  const external: string[] = [];
  const records: Array<Record<string, unknown>> = [];
  const deps: MainWindowDependencies = {
    createBrowserWindow: options => {
      const win = new FakeWindow(options);
      windows.push(win);
      return win as unknown as BrowserWindow;
    },
    preloadPath: '/app/dist-electron/main/preload.js',
    launchMode: 'foreground',
    productUpdatesEnabled: false,
    openDevTools: false,
    position: () => undefined,
    isWorkspaceTarget: target => target.startsWith('http://127.0.0.1:23456/'),
    openExternal: url => external.push(url),
    promoteToRegularApp: () => log.push('promote'),
    activateApp: () => log.push('activate'),
    onNavigationReset: () => log.push('menu-reset'),
    onCheckpointOwnerLost: id => log.push(`owner-lost:${id}`),
    onLaunchScreenLoaded: () => log.push('launch-screen'),
    onWorkspaceLoaded: url => log.push(`workspace:${url}`),
    onRenderProcessGone: (_win, details) =>
      log.push(`renderer-gone:${details.reason}`),
    onRenderUnresponsive: () => log.push('renderer-unresponsive'),
    onRenderResponsive: () => log.push('renderer-responsive'),
    record: (event, fields) => records.push({ event, ...fields }),
    ...overrides,
  };
  const controller = createMainWindowController(deps);
  return { controller, windows, log, external, records };
}

describe('createMainWindowController', () => {
  it('builds the window from the AX-tileable shape with a sandboxed, isolated preload', () => {
    const { controller, windows } = harness({ productUpdatesEnabled: true });
    controller.open('data:text/html,launch', appearance);

    const [{ options, loaded }] = windows;
    expect(options).toMatchObject(AX_TILEABLE_WINDOW_SHAPE);
    expect(options).toMatchObject({
      show: true,
      backgroundColor: '#101010',
      webPreferences: {
        preload: '/app/dist-electron/main/preload.js',
        additionalArguments: ['--exawatt-capability-updates'],
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: true,
      },
    });
    expect(loaded).toEqual(['data:text/html,launch']);
    expect(controller.current()).toBe(windows[0]);
  });

  it('keeps a hidden automated window unthrottled and offers no update capability without a feed', () => {
    const { controller, windows } = harness({ launchMode: 'hidden' });
    controller.open(WORKSPACE, appearance);

    expect(windows[0].options.show).toBe(false);
    expect(windows[0].options.webPreferences).toMatchObject({
      additionalArguments: [],
      backgroundThrottling: false,
    });
  });

  it('shows an inactive launch without focus, and promotes it once the operator clicks it', () => {
    const { controller, windows, log } = harness({ launchMode: 'inactive' });
    controller.open(WORKSPACE, appearance);
    const [first] = windows;

    first.emit('ready-to-show');
    expect(first.shownInactive).toBe(1);
    first.emit('focus');
    expect(log).toContain('promote');

    first.emit('closed');
    controller.open(WORKSPACE, appearance);
    expect(windows[1].options.show).toBe(true);
  });

  it('brings the window forward only as far as the launch mode allows', () => {
    const foreground = harness();
    foreground.controller.open(WORKSPACE, appearance);
    foreground.windows[0].minimized = true;
    expect(foreground.controller.present()).toBe('focused');
    expect(foreground.windows[0].calls).toEqual(['restore', 'show', 'focus']);
    expect(foreground.log).toContain('activate');

    const inactive = harness({ launchMode: 'inactive' });
    inactive.controller.open(WORKSPACE, appearance);
    expect(inactive.controller.present()).toBe('shown');
    expect(inactive.windows[0].calls).toEqual(['show-inactive']);
    expect(inactive.log).not.toContain('activate');
    // Once the operator has clicked it, it is his foreground app.
    inactive.windows[0].emit('focus');
    expect(inactive.controller.present()).toBe('focused');

    const hidden = harness({ launchMode: 'hidden' });
    hidden.controller.open(WORKSPACE, appearance);
    expect(hidden.controller.present()).toBe('hidden');
    expect(hidden.windows[0].calls).toEqual([]);
    expect(hidden.log).not.toContain('activate');
  });

  it('keeps navigation on the workspace origin and sends https elsewhere to the browser', () => {
    const { controller, windows, external } = harness();
    controller.open(WORKSPACE, appearance);
    const contents = windows[0].webContents;

    const navigate = (target: string) => {
      let prevented = false;
      contents.emit(
        'will-navigate',
        { preventDefault: () => (prevented = true) },
        target
      );
      return prevented;
    };
    expect(navigate('http://127.0.0.1:23456/settings')).toBe(false);
    expect(navigate('https://exawatt.ai/privacy')).toBe(true);
    expect(navigate('file:///etc/passwd')).toBe(true);
    expect(external).toEqual(['https://exawatt.ai/privacy']);

    expect(contents.windowOpenHandler!({ url: 'https://github.com' })).toEqual({
      action: 'deny',
    });
    expect(contents.windowOpenHandler!({ url: 'javascript:alert(1)' })).toEqual(
      { action: 'deny' }
    );
    expect(external).toEqual([
      'https://exawatt.ai/privacy',
      'https://github.com',
    ]);

    let attachPrevented = false;
    contents.emit('will-attach-webview', {
      preventDefault: () => (attachPrevented = true),
    });
    expect(attachPrevented).toBe(true);
    let granted: boolean | null = null;
    contents.permissionHandler!(contents, 'media', ok => (granted = ok));
    expect(granted).toBe(false);
  });

  it('drops checkpoint ownership and menu truth at every document boundary', () => {
    const { controller, windows, log } = harness();
    controller.open(WORKSPACE, appearance);
    const contents = windows[0].webContents;
    log.length = 0;

    contents.emit('did-start-navigation', {}, WORKSPACE, false, true);
    expect(log).toEqual(['owner-lost:7', 'menu-reset']);

    log.length = 0;
    contents.emit('did-start-navigation', {}, WORKSPACE, true, true);
    contents.emit('did-start-navigation', {}, WORKSPACE, false, false);
    contents.emit('did-navigate-in-page', {}, `${WORKSPACE}?tab=2`, true);
    expect(log).toEqual([]);

    contents.emit(
      'did-navigate-in-page',
      {},
      'http://127.0.0.1:23456/fleet',
      true
    );
    contents.emit('did-start-loading');
    contents.emit('destroyed');
    expect(log).toEqual(['owner-lost:7', 'menu-reset', 'owner-lost:7']);
  });

  it('hands a dead renderer to recovery only after it stops owning workspace state', () => {
    // BUG-223: a quit must never wait on a renderer that is gone to
    // checkpoint, and recovery must never reload a renderer still counted as
    // the owner.
    const { controller, windows, log } = harness();
    controller.open(WORKSPACE, appearance);
    log.length = 0;

    windows[0].webContents.emit(
      'render-process-gone',
      {},
      { reason: 'killed', exitCode: 9 }
    );

    expect(log).toEqual(['menu-reset', 'owner-lost:7', 'renderer-gone:killed']);
  });

  it('hands a hung renderer, and its recovery, to recovery (BUG-129)', () => {
    const { controller, windows, log } = harness();
    controller.open(WORKSPACE, appearance);
    log.length = 0;

    windows[0].webContents.emit('unresponsive');
    windows[0].webContents.emit('responsive');

    expect(log).toEqual(['renderer-unresponsive', 'renderer-responsive']);
  });

  it('reloads without needing a live renderer to hold focus', () => {
    // Electron's `reload` role targets the focused web contents, which a
    // crashed renderer can never be (BUG-223). The menu passes the focused
    // window instead, and nothing at all when no window is focused.
    const { controller, windows } = harness();
    controller.open(WORKSPACE, appearance);
    const contents = windows[0].webContents;

    controller.reload(undefined, { ignoringCache: false });
    controller.reload({ id: 3 }, { ignoringCache: true });
    expect(contents.reloads).toEqual(['reload', 'ignoring-cache']);

    const other = new FakeWindow({});
    controller.reload(other, { ignoringCache: false });
    expect(other.webContents.reloads).toEqual(['reload']);
    expect(contents.reloads).toHaveLength(2);

    windows[0].destroyed = true;
    controller.reload(undefined, { ignoringCache: false });
    expect(contents.reloads).toHaveLength(2);
  });

  it('repaints the launch screen, or delivers held work, when a document finishes loading', () => {
    const { controller, windows, log } = harness();
    controller.open('data:text/html,launch', appearance);
    const contents = windows[0].webContents;
    log.length = 0;

    contents.emit('did-finish-load');
    contents.url = WORKSPACE;
    contents.emit('did-finish-load');

    expect(log).toEqual(['launch-screen', `workspace:${WORKSPACE}`]);
  });

  /** A window whose launch screen load stays pending until the test ends
   *  it, with navigate(WORKSPACE) already waiting on it. */
  function launching() {
    const win = new FakeWindow({});
    const loads: Array<{ resolve: () => void; reject: (e: Error) => void }> =
      [];
    win.loadURL = (url: string) =>
      new Promise<void>((resolve, reject) => {
        win.loaded.push(url);
        loads.push({ resolve, reject });
      });
    const { controller, records } = harness({
      createBrowserWindow: () => win as unknown as BrowserWindow,
    });
    controller.open(LAUNCH, appearance);
    let entered = false;
    const entering = controller.navigate(WORKSPACE).then(() => {
      entered = true;
    });
    return { win, loads, records, entering, entered: () => entered };
  }
  const LAUNCH = 'data:text/html,launch';
  const turn = () => new Promise(resolve => setImmediate(resolve));

  it('enters the workspace once the launch screen commits, fails, loses its renderer or runs out of time, recording any end but the commit (BUG-308)', async () => {
    // Two navigations in flight at a new window's first frames is the one
    // moment an attaching debugger can miss both commits. The wait ends at
    // the launch screen's commit, not its load: a launch screen whose
    // renderer hangs after committing must never keep a window out of the
    // workspace, and neither may one that never commits at all.
    const ends = {
      committed: {
        // Committed, and its renderer then hangs: the load never settles.
        end: (win: FakeWindow) =>
          win.webContents.emit('did-navigate', {}, LAUNCH, -1, ''),
        recorded: [],
      },
      failed: {
        end: (_win: FakeWindow, loads: ReturnType<typeof launching>['loads']) =>
          loads[0]!.reject(
            Object.assign(new Error(`ERR_FAILED (-2) loading '${LAUNCH}'`), {
              errno: -2,
              code: 'ERR_FAILED',
              url: LAUNCH,
            })
          ),
        recorded: [
          {
            event: 'launch-screen.not-committed',
            reason: 'failed',
            error: 'ERR_FAILED',
          },
        ],
      },
      'renderer-gone': {
        end: (win: FakeWindow) =>
          win.webContents.emit(
            'render-process-gone',
            {},
            { reason: 'crashed', exitCode: 11 }
          ),
        recorded: [
          {
            event: 'launch-screen.not-committed',
            reason: 'renderer-gone',
            cause: 'crashed',
          },
        ],
      },
      'timed-out': {
        end: () => vi.advanceTimersByTime(1),
        recorded: [
          {
            event: 'launch-screen.not-committed',
            reason: 'timed-out',
            waitedMs: LAUNCH_SCREEN_COMMIT_MS,
          },
        ],
      },
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (const [name, { end, recorded }] of Object.entries(ends)) {
        const { win, loads, records, entering, entered } = launching();
        await turn();
        vi.advanceTimersByTime(LAUNCH_SCREEN_COMMIT_MS - 1);
        await turn();
        expect(win.loaded, name).toEqual([LAUNCH]);
        end(win, loads);
        await turn();
        expect(win.loaded, name).toEqual([LAUNCH, WORKSPACE]);
        loads[1]!.resolve();
        await entering;
        expect(entered(), name).toBe(true);
        // One end, one record: a later deadline or event adds nothing.
        vi.advanceTimersByTime(LAUNCH_SCREEN_COMMIT_MS);
        win.webContents.emit('did-navigate', {}, WORKSPACE, 200, 'OK');
        expect(records, name).toEqual(recorded);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a window closed during its launch screen alone, and records why', async () => {
    const { win, records, entering, entered } = launching();
    await turn();
    win.destroyed = true;
    win.emit('closed');
    await entering;
    expect(entered()).toBe(true);
    expect(win.loaded).toEqual([LAUNCH]);
    expect(records).toEqual([
      { event: 'launch-screen.not-committed', reason: 'closed' },
    ]);
  });

  it('offers a window as a dialog parent only while it is alive', () => {
    const { controller, windows } = harness();
    controller.open(WORKSPACE, appearance);
    expect(controller.live()).toBe(windows[0]);

    windows[0].destroyed = true;
    expect(controller.current()).toBe(windows[0]);
    expect(controller.live()).toBeNull();
  });

  it('forgets a closed window', () => {
    const { controller, windows, log } = harness();
    controller.open(WORKSPACE, appearance);
    log.length = 0;

    windows[0].emit('closed');

    expect(controller.current()).toBeNull();
    expect(controller.live()).toBeNull();
    expect(log).toEqual(['menu-reset', 'owner-lost:7']);
  });

  it('opens detached devtools only when asked to', () => {
    const quiet = harness();
    quiet.controller.open(WORKSPACE, appearance);
    expect(quiet.windows[0].webContents.devTools).toEqual([]);

    const asked = harness({ openDevTools: true });
    asked.controller.open(WORKSPACE, appearance);
    expect(asked.windows[0].webContents.devTools).toEqual([{ mode: 'detach' }]);
  });
});

describe('createWorkspaceTarget', () => {
  it('trusts only the packaged renderer origin, and nothing before it exists', () => {
    let origin: string | null = null;
    const target = createWorkspaceTarget({
      isDev: false,
      devUrl: 'http://localhost:7000',
      rendererOrigin: () => origin,
    });
    expect(target.isTarget(WORKSPACE)).toBe(false);

    origin = 'http://127.0.0.1:23456';
    expect(target.url()).toBe(WORKSPACE);
    expect(target.isTarget('http://127.0.0.1:23456/usage')).toBe(true);
    expect(target.isTarget('http://127.0.0.1:23457/workspace')).toBe(false);
    expect(target.isTarget('not a url')).toBe(false);
  });

  it('trusts the dev server in development', () => {
    const target = createWorkspaceTarget({
      isDev: true,
      devUrl: 'http://localhost:7000',
      rendererOrigin: () => null,
    });
    expect(target.url()).toBe('http://localhost:7000');
    expect(target.isTarget('http://localhost:7000/workspace')).toBe(true);
  });
});

describe('createStartupScreen', () => {
  const stage = (progress: number, failed?: boolean) => ({
    progress,
    label: `at ${progress}`,
    detail: '',
    ...(failed ? { failed } : {}),
  });

  it('moves forward only, unless a stage reports a failure', () => {
    const screen = createStartupScreen(() => null, stage(0.1));
    screen.update(stage(0.5));
    screen.update(stage(0.3));
    expect(screen.stage().progress).toBe(0.5);

    screen.update(stage(0.5, true));
    expect(screen.stage()).toMatchObject({ progress: 0.5, failed: true });
  });

  it('paints only while the launch document is showing', () => {
    const contents = new FakeWebContents();
    const win = { isDestroyed: () => false, webContents: contents };
    const screen = createStartupScreen(() => win, stage(0.1));

    contents.url = 'data:text/html,launch';
    screen.update(stage(0.4));
    contents.url = WORKSPACE;
    screen.update(stage(0.9));
    screen.repaint();

    expect(contents.executed).toEqual([
      `window.exawattSetStartupStage?.(${JSON.stringify(stage(0.4))})`,
    ]);
  });
});

describe('testWindowPosition', () => {
  const displays = {
    getPrimaryDisplay: () => ({ id: 1 }),
    getAllDisplays: () => [
      { id: 1, workArea: { x: 0, y: 0, width: 1512, height: 944 } },
      { id: 2, workArea: { x: 1512, y: -200, width: 2560, height: 1440 } },
    ],
  };

  it('places a visible harness window on a non-primary display', () => {
    expect(testWindowPosition({ EXAWATT_TEST: '1' }, displays)).toEqual({
      x: 1552,
      y: -160,
    });
  });

  it('leaves real launches, and harness runs that ask for the primary display, alone', () => {
    expect(testWindowPosition({}, displays)).toBeUndefined();
    expect(
      testWindowPosition(
        { EXAWATT_TEST: '1', EXAWATT_TEST_SCREEN: 'primary' },
        displays
      )
    ).toBeUndefined();
    expect(
      testWindowPosition(
        { EXAWATT_TEST: '1' },
        { ...displays, getAllDisplays: () => [displays.getAllDisplays()[0]] }
      )
    ).toBeUndefined();
  });
});
