import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Display,
} from 'electron';
import type { StartupStage } from './launch-screen';
import type { NativeAppearanceResolution } from './appearance';
import type { WindowLaunchMode } from './window-launch-mode';
import { AX_TILEABLE_WINDOW_SHAPE } from './window-shape';

/**
 * The main window: its construction, its navigation boundary, the startup
 * stage it shows before the workspace exists, and the one URL it trusts.
 * Window options an Accessibility-API window manager depends on stay in
 * `window-shape.ts` (BUG-002, incident `0001`); this module spreads them and
 * never inlines a replacement.
 */

/** The one origin the window may navigate within: the dev server in
 *  development, the packaged renderer's loopback origin otherwise. */
export function createWorkspaceTarget(options: {
  isDev: boolean;
  devUrl: string;
  rendererOrigin: () => string | null;
}): { url(): string; isTarget(target: string): boolean } {
  const url = () =>
    options.isDev ? options.devUrl : `${options.rendererOrigin()}/workspace`;
  return {
    url,
    isTarget(target) {
      try {
        return new URL(target).origin === new URL(url()).origin;
      } catch {
        return false;
      }
    },
  };
}

interface StartupScreenWindow {
  isDestroyed(): boolean;
  webContents: {
    getURL(): string;
    executeJavaScript(code: string): Promise<unknown>;
  };
}

/**
 * The launch document's progress. Stages only move forward unless one reports
 * a failure, and they are painted only while the window still shows the
 * self-contained launch document, never into the renderer.
 */
export function createStartupScreen(
  window: () => StartupScreenWindow | null,
  initial: StartupStage = {
    progress: 0.08,
    label: 'Opening command surface',
    detail: 'Preparing the local agent interface',
  }
): {
  stage(): StartupStage;
  update(stage: StartupStage): void;
  repaint(): void;
} {
  let startupStage = initial;
  function updateStartupScreen(stage: StartupStage): void {
    if (!stage.failed && stage.progress < startupStage.progress) return;
    startupStage = stage;
    const win = window();
    if (
      !win ||
      win.isDestroyed() ||
      !win.webContents.getURL().startsWith('data:text/html')
    ) {
      return;
    }
    const serialized = JSON.stringify(stage);
    void win.webContents
      .executeJavaScript(`window.exawattSetStartupStage?.(${serialized})`)
      .catch(() => {});
  }
  return {
    stage: () => startupStage,
    update: updateStartupScreen,
    repaint: () => updateStartupScreen(startupStage),
  };
}

/** Explicitly visible harness runs open on a NON-primary display when one
 *  exists. Normal automated runs are hidden; this remains useful with
 *  EXAWATT_WINDOW_MODE=inactive|foreground. */
export function testWindowPosition(
  env: NodeJS.ProcessEnv,
  screen: {
    getPrimaryDisplay(): Pick<Display, 'id'>;
    getAllDisplays(): Array<Pick<Display, 'id' | 'workArea'>>;
  }
): { x: number; y: number } | undefined {
  if (env.EXAWATT_TEST !== '1') return undefined;
  if (env.EXAWATT_TEST_SCREEN === 'primary') return undefined;
  try {
    const primary = screen.getPrimaryDisplay();
    const secondary = screen
      .getAllDisplays()
      .find(display => display.id !== primary.id);
    if (!secondary) return undefined;
    return {
      x: secondary.workArea.x + 40,
      y: secondary.workArea.y + 40,
    };
  } catch {
    return undefined;
  }
}

export interface MainWindowDependencies {
  createBrowserWindow: (
    options: BrowserWindowConstructorOptions
  ) => BrowserWindow;
  preloadPath: string;
  launchMode: WindowLaunchMode;
  productUpdatesEnabled: boolean;
  /** Development opt-in (EXAWATT_DEVTOOLS=1): detached devtools at open. */
  openDevTools: boolean;
  position: () => { x: number; y: number } | undefined;
  isWorkspaceTarget: (target: string) => boolean;
  openExternal: (url: string) => unknown;
  /** An inactive launch the operator clicks becomes a normal app. */
  promoteToRegularApp: () => void;
  /** Renderer-published menu truth is invalid from here on. */
  onNavigationReset: () => void;
  /** This window's renderer no longer owns mutable workspace state. */
  onCheckpointOwnerLost: (webContentsId: number) => void;
  onLaunchScreenLoaded: () => void;
  onWorkspaceLoaded: (url: string) => void;
  /** The window's renderer died underneath it (BUG-223). */
  onRenderProcessGone: (
    win: BrowserWindow,
    details: { reason: string; exitCode: number }
  ) => void;
}

interface MainWindowController {
  current(): BrowserWindow | null;
  /** The window when it can still parent a native dialog. */
  live(): BrowserWindow | null;
  open(initialUrl: string, appearance: NativeAppearanceResolution): void;
  /** Reloads `focused` when it is a web window, else the main window. It
   *  never depends on the renderer being alive to receive focus (BUG-223). */
  reload(focused: unknown, options: { ignoringCache: boolean }): void;
}

export function createMainWindowController(
  deps: MainWindowDependencies
): MainWindowController {
  let mainWindow: BrowserWindow | null = null;
  let inactiveLaunchPromoted = false;
  const resetMenuAvailability = () => deps.onNavigationReset();

  function createWindow(
    initialUrl: string,
    appearance: NativeAppearanceResolution
  ): void {
    const windowLaunchMode = deps.launchMode;
    const showAtCreation =
      windowLaunchMode === 'foreground' || inactiveLaunchPromoted;
    mainWindow = deps.createBrowserWindow({
      ...(deps.position() ?? {}),
      show: showAtCreation,
      width: 1400,
      height: 900,
      // Every option an Accessibility-API window manager (Divvy, Rectangle, …)
      // depends on, as one named contract with a test behind it. Do not inline a
      // replacement here; amend `window-shape.ts` so the reason travels with the
      // value (BUG-002, incidents `0001`).
      ...AX_TILEABLE_WINDOW_SHAPE,
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: appearance.bootstrap.background,
      webPreferences: {
        preload: deps.preloadPath,
        additionalArguments: deps.productUpdatesEnabled
          ? ['--exawatt-capability-updates']
          : [],
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        // Hidden eval windows still need deterministic timers, PTY rendering,
        // screenshots, and WebGL frames while Playwright drives them.
        backgroundThrottling: windowLaunchMode !== 'hidden',
      },
    });
    const win = mainWindow;
    // Renderer-owned command truth is invalid as soon as a document starts
    // loading or its process is gone. The main-frame navigation boundary below
    // repeats this idempotently alongside checkpoint ownership.
    win.webContents.on('did-start-loading', resetMenuAvailability);
    win.webContents.on('render-process-gone', resetMenuAvailability);

    if (!showAtCreation && windowLaunchMode === 'inactive') {
      const inactiveWindow = win;
      inactiveWindow.once('ready-to-show', () => {
        if (!inactiveWindow.isDestroyed()) inactiveWindow.showInactive();
      });
      inactiveWindow.once('focus', () => {
        inactiveLaunchPromoted = true;
        deps.promoteToRegularApp();
      });
    }

    const webContentsId = win.webContents.id;
    const clearCheckpointOwner = () =>
      deps.onCheckpointOwnerLost(webContentsId);
    win.webContents.on(
      'did-start-navigation',
      (_event, _target, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          clearCheckpointOwner();
          // Disable first; the restored workspace republishes after hydration
          // instead of leaving stale native actions clickable during reload.
          resetMenuAvailability();
        }
      }
    );
    win.webContents.on(
      'did-navigate-in-page',
      (_event, target, isMainFrame) => {
        if (!isMainFrame) return;
        try {
          if (new URL(target).pathname !== '/workspace') clearCheckpointOwner();
        } catch {
          clearCheckpointOwner();
        }
      }
    );
    win.webContents.on('destroyed', clearCheckpointOwner);
    // A dead renderer owns nothing: a quit must not wait on it to checkpoint.
    // Recovery runs after ownership is released, never before.
    win.webContents.on('render-process-gone', (_event, details) => {
      clearCheckpointOwner();
      deps.onRenderProcessGone(win, details);
    });

    void win.loadURL(initialUrl);

    win.webContents.on('will-navigate', (event, target) => {
      if (!deps.isWorkspaceTarget(target)) {
        event.preventDefault();
        if (target.startsWith('https://')) void deps.openExternal(target);
      }
    });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    );

    // Deliver any queued deep link once the page is loaded
    win.webContents.on('did-finish-load', () => {
      const currentUrl = mainWindow?.webContents.getURL() ?? '';
      if (currentUrl.startsWith('data:text/html')) {
        deps.onLaunchScreenLoaded();
      } else {
        deps.onWorkspaceLoaded(currentUrl);
      }
    });

    // Open external links in default browser
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) {
        deps.openExternal(url);
      }
      return { action: 'deny' };
    });

    // opt-in only (EXAWATT_DEVTOOLS=1): auto-opened devtools occlude the
    // workspace; toggle manually anytime with Opt+Cmd+I
    if (deps.openDevTools) {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    win.on('closed', () => {
      resetMenuAvailability();
      clearCheckpointOwner();
      mainWindow = null;
    });
  }

  return {
    current: () => mainWindow,
    live: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    open: createWindow,
    reload(focused, { ignoringCache }) {
      const target =
        focused && typeof focused === 'object' && 'webContents' in focused
          ? (focused as BrowserWindow)
          : mainWindow;
      if (!target || target.isDestroyed()) return;
      if (ignoringCache) target.webContents.reloadIgnoringCache();
      else target.webContents.reload();
    },
  };
}
