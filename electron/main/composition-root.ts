import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net as electronNet,
  powerMonitor,
  screen,
  session as electronSession,
  shell,
  systemPreferences,
} from 'electron';
import { randomUUID } from 'crypto';
import path from 'path';
import { installUnreadableStateNotice } from './unreadable-state-notice';
import { registerPermissionsIPC } from './permissions/permissions-ipc';
import { installPermissions } from './permissions/runtime';
import { testNotificationAuthorization } from './permissions/test-authorization';
import { commandVerbCapabilities } from '@exawatt/core';
import { registerAppearanceIpc, registerMainChannels } from './app-ipc';
import { observeHostPower } from './host-power';
import { createScreenLockReader } from './screen-lock-snapshot';
import { broadcastToWindows } from './window-broadcast';
import {
  applyNativeAppearancePreference,
  testSystemDarkOverride,
} from './appearance';
import { assertPackagedRendererComposition } from './build-identity';
import { launchBuildIdentity } from './launch-identity';
import {
  registerCommandEngineIPC,
  setCommandEnginePhase,
} from './command-engine';
import {
  bootstrapCommandSurface,
  CommandRuntime,
  reloadWindow,
  reportCommandSurfaceFailure,
} from './command-surface';
import { routeSecondLaunches } from './app-instance';
import { createDeepLinkRouter, registerDeepLinkProtocol } from './deep-link';
import { recordWebLink } from './analytics-activity';
import { distributionChildEnvironment } from './distribution';
import {
  assertTrustedIpcSender,
  handleTrusted,
  setTrustedRendererOrigin,
} from './ipc-security';
import { launchScreenUrl } from './launch-screen';
import {
  installMainInstrumentation,
  openMainDiagnostics,
  watchProcessDeaths,
} from './main-diagnostics';
import { boundDiagnosticRecorderPerFamily } from './diagnostics-log';
import { createMenuController } from './menu-controller';
import {
  createRendererRecovery,
  createRendererServerSupervisor,
  rendererHangPrompt,
  rendererRecoveryPrompt,
  sharedRecoveryPrompt,
  testHangChoice,
} from './process-recovery';
import { clearSessionOrigins, createRendererPortPolicy } from './renderer-port';
import { createRendererServer } from './renderer-server';
import { loadSettings } from './settings-store';
import { createNoticeDismissalStore } from './notice-dismissals';
import {
  createApplicationsPlacement,
  readInstalledCopy,
} from './installed-build';
import { testProductUpdate } from './updater-test-double';
import {
  createBeforeQuitHandler,
  createCheckpointBroker,
  createShutdownSequence,
} from './shutdown-sequence';
import {
  createMainWindowController,
  createStartupScreen,
  createWorkspaceTarget,
  testWindowPosition,
} from './window';
import { resolveWindowLaunchMode } from './window-launch-mode';
import {
  loadWorkspace,
  mergeHarnessIdentities,
  saveWorkspace,
} from './workspace-store';

/**
 * Electron main's composition root. It decides nothing itself: it reads the
 * launch environment, builds each module with its dependencies, and connects
 * them. Behaviour lives in the modules it names. `main.ts` evaluates it only
 * in the process that holds this profile's instance lock (BUG-305).
 */

const env = process.env;
const isDev = env.NODE_ENV === 'development';
const isTest = env.EXAWATT_TEST === '1';
const windowLaunchMode = resolveWindowLaunchMode({
  isDevelopment: isDev,
  isTest,
  override: env.EXAWATT_WINDOW_MODE,
});
// EXAWATT_DEV_URL lets harnesses point the shell at a different dev server
const DEV_URL = env.EXAWATT_DEV_URL || 'http://localhost:7000';
const safeThemeLaunch = process.argv.includes('--safe-theme');
const userDataPath = () => app.getPath('userData');

// Electron's normal macOS activation policy can take keyboard focus before a
// BrowserWindow exists. Accessory mode prevents that initial app activation;
// an inactive development window promotes itself back to a normal app only
// after the operator deliberately clicks it. Hidden test runs never promote.
if (process.platform === 'darwin' && windowLaunchMode !== 'foreground') {
  app.setActivationPolicy('accessory');
}
// No default menu while booting; the real command menu arrives with services.
Menu.setApplicationMenu(null);

// Settled by `main.ts` before the instance lock, which is the profile's.
const build = launchBuildIdentity();
const { buildInfo, distribution, identity } = build;
const productUpdateFeedUrl = distribution.contract.updates?.feedUrl ?? null;
/** An automated launch may drive Restart to Update through a double. */
const testUpdateDouble =
  isTest && testProductUpdate(env.EXAWATT_TEST_PRODUCT_UPDATE) !== null;
if (!isDev) assertPackagedRendererComposition(process.resourcesPath, buildInfo);

const runtime = new CommandRuntime();
const mainDiagnostics = openMainDiagnostics(userDataPath());
// Process deaths are bounded so a helper stuck in a crash loop cannot fill
// the diagnostics log (BUG-223), and bounded per family (`child`, `renderer`,
// `renderer-server`) so that loop cannot silence the renderer's own record.
const processDiagnostics = boundDiagnosticRecorderPerFamily(mainDiagnostics, {
  perMinute: 20,
  perRun: 200,
});
/** Past confirmation, shutdown owns every process: nothing restarts. */
const isShuttingDown = () => {
  const phase = runtime.shutdownCoordinator?.phase ?? 'idle';
  return phase !== 'idle' && phase !== 'confirming';
};

const rendererServer = createRendererServer({
  userDataPath,
  cacheNamespace: identity.cacheNamespace,
  isTest,
  childEnvironment: () => distributionChildEnvironment(distribution, env),
  forwardStdout: env.EXAWATT_RENDERER_LOGS === '1',
  ports: createRendererPortPolicy({
    userDataPath,
    record: mainDiagnostics,
    // BUG-170: Chromium's own deletion, for exactly the packaged server's
    // abandoned origins; every other origin in the session is left alone.
    clearOrigins: origins =>
      clearSessionOrigins(electronSession.defaultSession, origins),
  }),
  onUnexpectedExit: details => rendererServerSupervisor.exited(details),
});
// A cached renderer uses only Node APIs and can boot before Electron's ready
// event, overlapping its server start with Chromium initialization. A cold
// renderer intentionally waits until the launch frame exists so archive I/O
// cannot delay the first visible acknowledgement.
const rendererWasWarmAtLaunch = !isDev && rendererServer.hasWarmCache();
let rendererReadyPromise = rendererWasWarmAtLaunch
  ? rendererServer.start()
  : null;
// Bootstrap awaits and reports this same promise; an early observer keeps a
// very fast failure from becoming an unhandled rejection before ready.
void rendererReadyPromise?.catch(() => {});

const workspace = createWorkspaceTarget({
  isDev,
  devUrl: DEV_URL,
  rendererOrigin: () => rendererServer.origin,
});
const checkpoints = createCheckpointBroker({ randomUUID });
/** Reload Window or Quit, once automatic recovery is spent. */
const askToRecover = sharedRecoveryPrompt(async () => {
  const prompt = rendererRecoveryPrompt(identity.productName);
  const parent = mainWindow.live();
  const { response } = parent
    ? await dialog.showMessageBox(parent, prompt.options)
    : await dialog.showMessageBox(prompt.options);
  return prompt.choice(response);
});
const rendererRecovery = createRendererRecovery({
  record: processDiagnostics,
  isQuitting: isShuttingDown,
  ask: askToRecover,
  askWhileUnresponsive: async (win, signal) => {
    // A hidden automation window has no one to ask; the run says the answer.
    if (isTest) return testHangChoice(env);
    const prompt = rendererHangPrompt(identity.productName);
    const { response } = await dialog.showMessageBox(win as BrowserWindow, {
      ...prompt.options,
      signal,
    });
    return prompt.choice(response);
  },
  quit: () => app.quit(),
});
const mainWindow = createMainWindowController({
  createBrowserWindow: options => new BrowserWindow(options),
  preloadPath: path.join(__dirname, 'preload.js'),
  launchMode: windowLaunchMode,
  productUpdatesEnabled: productUpdateFeedUrl !== null || testUpdateDouble,
  openDevTools: isDev && env.EXAWATT_DEVTOOLS === '1',
  position: () => testWindowPosition(env, screen),
  isWorkspaceTarget: target => workspace.isTarget(target),
  openExternal: url => shell.openExternal(url),
  promoteToRegularApp: () => {
    if (process.platform === 'darwin') app.setActivationPolicy('regular');
  },
  activateApp: () => app.focus({ steal: true }),
  onNavigationReset: () => menu.resetAvailability(),
  onCheckpointOwnerLost: id => checkpoints.release(id),
  onLaunchScreenLoaded: () => startupScreen.repaint(),
  onWorkspaceLoaded: url => deepLinks.deliverPending(url),
  onRenderProcessGone: (win, details) =>
    rendererRecovery.rendererGone(win, details),
  onRenderUnresponsive: win => rendererRecovery.rendererUnresponsive(win),
  onRenderResponsive: () => rendererRecovery.rendererResponsive(),
  record: mainDiagnostics,
});
const rendererServerSupervisor = createRendererServerSupervisor({
  record: processDiagnostics,
  isQuitting: isShuttingDown,
  restart: () => rendererServer.restart(),
  isDown: () => rendererServer.isDown(),
  reloadWorkspace: () => {
    const win = mainWindow.live();
    if (win && workspace.isTarget(win.webContents.getURL())) {
      win.webContents.reload();
    }
  },
  ask: askToRecover,
  quit: () => app.quit(),
});
const startupScreen = createStartupScreen(() => mainWindow.current());

const deepLinks = createDeepLinkRouter({
  protocolScheme: identity.protocolScheme,
  window: () => mainWindow.current(),
  authCoordinator: () => runtime.authCoordinator,
  isLinkOutcome: () => runtime.isLinkOutcome,
  safeAuthError: error => runtime.safeAuthError(error),
  isWorkspaceTarget: target => workspace.isTarget(target),
  welcome: webId => void recordWebLink(webId),
  record: (event, fields) => runtime.recordAuthDiagnostic(event, fields),
});
// Before app.whenReady(), so a link that launches the app is not lost.
registerDeepLinkProtocol(app, identity.protocolScheme, deepLinks, process);
// A later launch over this profile is the operator asking for Exawatt: it
// brings this window forward. A link reaches this process through
// `open-url` above, from macOS, whichever copy it launched.
routeSecondLaunches(app, {
  bringForward: () => {
    if (isShuttingDown()) return 'quitting';
    if (mainWindow.live()) return mainWindow.present();
    openMainWindow(runtime.startupComplete);
    return 'opened';
  },
  record: (event, fields) => mainDiagnostics(event, fields),
});

const shutdownSequence = createShutdownSequence({
  productName: identity.productName,
  env,
  showMessageBox: options => {
    const parent = mainWindow.live();
    return parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options);
  },
  window: () => mainWindow.current(),
  allWindows: () => BrowserWindow.getAllWindows(),
  // A cancelled quit hands the processes back: whatever died while shutdown
  // owned them comes back now. A restarted server reloads the window again
  // once it answers.
  shutdownCancelled: () => {
    rendererServerSupervisor.shutdownCancelled();
    rendererRecovery.shutdownCancelled(BrowserWindow.getAllWindows());
  },
  checkpoints,
  workspace: {
    load: loadWorkspace,
    mergeHarnessIdentities,
    save: saveWorkspace,
  },
  closing: [
    { name: 'services', run: () => runtime.disposeServices() },
    { name: 'roadmap-watchers', run: () => runtime.disposeRoadmapWatchers() },
    { name: 'sessions', run: () => runtime.disposePty() },
    { name: 'renderer-server', run: () => rendererServer.stop() },
    {
      name: 'installed-build-watch',
      run: () => runtime.installedBuildWatch?.stop(),
    },
  ],
  prepareUpdate: signal => runtime.prepareProductUpdate(signal),
  updateRefused: reason => runtime.reportUpdateRefused(reason),
  handOff: {
    installUpdate: signal => runtime.installProductUpdate(signal),
    relaunch: () => app.relaunch(),
    quit: () => app.quit(),
  },
  runRecord: {
    saveHeldState: async held => {
      await runtime.runStateStore?.recordHeldState(held);
    },
    previousHeldState: () => runtime.previousRun?.heldState ?? null,
    saveInstallFailure: async reason => {
      await runtime.runStateStore?.recordInstallFailure(
        runtime.installFailure(reason)
      );
    },
  },
  record: (event, fields) => mainDiagnostics(event, fields),
  assertTrustedSender: assertTrustedIpcSender,
  coordinator: () => runtime.shutdownCoordinator,
});

// BUG-285: one record of dismissed notices, for every window and launch.
const notices = createNoticeDismissalStore({
  file: path.join(userDataPath(), 'notice-dismissals.json'),
  allWindows: () => BrowserWindow.getAllWindows(),
});

// BUG-305: an official build running outside Applications offers to move
// there. An automated launch may ask for the offer to render it, and its
// mover moves nothing.
const testPlacement = isTest && env.EXAWATT_TEST_APP_PLACEMENT === 'outside';
const placement = createApplicationsPlacement({
  offered:
    testPlacement ||
    (process.platform === 'darwin' &&
      app.isPackaged &&
      !isTest &&
      productUpdateFeedUrl !== null),
  bundlePath: path.resolve(process.execPath, '..', '..', '..'),
  running: { version: app.getVersion(), builtAt: buildInfo.builtAt },
  mover: testPlacement
    ? {
        isInApplicationsFolder: () => false,
        moveToApplicationsFolder: () => false,
      }
    : app,
  installedCopy: testPlacement ? () => 'absent' : readInstalledCopy,
  record: (event, fields) => mainDiagnostics(event, fields),
});

const menuCapabilities = commandVerbCapabilities(distribution.contract);
const menu = createMenuController({
  context: () => ({
    appName: app.name,
    version: app.getVersion(),
    buildSha: buildInfo.sha.slice(0, 12),
    isDev,
    capabilities: menuCapabilities,
    onCheckForUpdates:
      productUpdateFeedUrl !== null
        ? () => {
            // Asking is the operator taking back a dismissal.
            notices.forget('product-update:');
            void runtime.checkForUpdatesFromMenu();
          }
        : undefined,
    onWindowManagementHelp: () =>
      void shutdownSequence.promptWindowManagementRestart(),
    onReloadWindow: (focused, options) =>
      reloadWindow(
        {
          startupComplete: () => runtime.startupComplete,
          window: () => mainWindow.live(),
          isWorkspaceTarget: target => workspace.isTarget(target),
          workspaceUrl: () => workspace.url(),
          reload: (target, reloadOptions) =>
            mainWindow.reload(target, reloadOptions),
        },
        focused,
        options
      ),
  }),
  install: template =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
  commandTarget: () =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
});

/** The OS appearance's IPC, registered once, before the first window. */
let appearanceIpc: ReturnType<typeof registerAppearanceIpc> | null = null;
function appearanceChannels(): ReturnType<typeof registerAppearanceIpc> {
  appearanceIpc ??= registerAppearanceIpc({
    electron: { BrowserWindow, ipcMain, nativeTheme, systemPreferences },
    assertTrustedSender: assertTrustedIpcSender,
    safeTheme: safeThemeLaunch,
    appearancePreference: () => loadSettings().appearance,
  });
  return appearanceIpc;
}

function startCommandSurface(): Promise<void> {
  return bootstrapCommandSurface({
    runtime,
    isDev,
    isTest,
    env,
    build,
    rendererReady: () =>
      isDev
        ? Promise.resolve(DEV_URL)
        : (rendererReadyPromise ??= rendererServer.start()),
    pruneRendererLeftovers: () => rendererServer.pruneLeftovers(),
    setTrustedRendererOrigin,
    startupScreen,
    electron: {
      app,
      net: electronNet,
      session: electronSession,
      shell,
      BrowserWindow,
    },
    registerMainChannels: () =>
      registerMainChannels({
        electron: {
          app,
          BrowserWindow,
          dialog,
          ipcMain,
          nativeTheme,
          shell,
          systemPreferences,
        },
        handle: handleTrusted,
        assertTrustedSender: assertTrustedIpcSender,
        build,
        runtime,
        env,
        appearance: appearanceChannels(),
        record: mainDiagnostics,
        syncRegistrations: [onSync => shutdownSequence.registerSync(onSync)],
        tables: [
          checkpoints.channels,
          menu.channels,
          shutdownSequence.channels,
          notices.channels,
          placement.channels,
          {
            'app:installed-build': () =>
              runtime.installedBuildWatch?.current() ?? null,
            // Registered after the run record is read, so this always knows.
            'app:previous-version': () => {
              if (!runtime.previousRun) {
                throw new Error('The run record has not been read yet');
              }
              return runtime.previousRun.previousVersion;
            },
          },
        ],
      }),
    shutdownSequence,
    rebuildMenu: () => menu.rebuild(),
    mainDiagnostics,
    setEnginePhase: setCommandEnginePhase,
    enterWorkspace: () => mainWindow.navigate(workspace.url()),
    quitApp: () => app.quit(),
  });
}

/** Opens the main window over the launch appearance this launch resolves. */
function openMainWindow(workspaceReady: boolean): void {
  const appearance = applyNativeAppearancePreference(
    loadSettings().appearance,
    nativeTheme,
    {
      safeTheme: safeThemeLaunch,
      systemDarkOverride: testSystemDarkOverride(
        isTest,
        env.EXAWATT_TEST_OS_APPEARANCE
      ),
    }
  );
  mainWindow.open(
    workspaceReady
      ? workspace.url()
      : launchScreenUrl(appearance.bootstrap, identity.productName),
    appearance
  );
}

app.whenReady().then(() => {
  installMainInstrumentation(userDataPath(), mainDiagnostics, powerMonitor);
  // Permissions come first: the unreadable-state notice and every other
  // notification path ask the registry before they post (ENG-045).
  registerPermissionsIPC(
    installPermissions({
      bundleId: app.isPackaged ? identity.stateNamespace : null,
      testAuthorization: testNotificationAuthorization(isTest, env),
    })
  );
  installUnreadableStateNotice(identity.productName);
  const hostPower = observeHostPower(
    {
      isOnBatteryPower: () => powerMonitor.isOnBatteryPower(),
      getScreenLockState: createScreenLockReader(powerMonitor),
      on: powerMonitor.on.bind(powerMonitor),
      removeListener: powerMonitor.removeListener.bind(powerMonitor),
    },
    snapshot => {
      broadcastToWindows(
        BrowserWindow.getAllWindows(),
        'app:host-power-changed',
        snapshot
      );
    }
  );
  runtime.hostPower = hostPower;
  handleTrusted('app:host-power', () => hostPower.getSnapshot());
  app.once('will-quit', hostPower.dispose);
  // Registered BEFORE bootstrap so it survives bootstrap failing: this is the
  // channel that reports exactly that (BUG-016).
  registerCommandEngineIPC(() => BrowserWindow.getAllWindows());
  // Before any window: its preload's synchronous first-paint read must find
  // an answer, or its renderer hangs (BUG-308).
  appearanceChannels();
  // Warm server startup is already in flight. On a version cache miss, give
  // the native launch frame priority over archive extraction.
  let commandSurface = rendererWasWarmAtLaunch ? startCommandSurface() : null;
  openMainWindow(false);
  commandSurface ??= startCommandSurface();

  app.on('activate', () => {
    if (runtime.shutdownCoordinator?.phase !== 'idle') return;
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow(runtime.startupComplete);
    }
  });

  void commandSurface.catch(error =>
    reportCommandSurfaceFailure(error, {
      productName: identity.productName,
      setEnginePhase: setCommandEnginePhase,
      startupScreen,
    })
  );
});

watchProcessDeaths(app, process, processDiagnostics);

app.on(
  'before-quit',
  createBeforeQuitHandler({
    disposeServices: () => runtime.disposeServices(),
    coordinator: () => runtime.shutdownCoordinator,
    stopRendererServer: () => rendererServer.stop(),
    quit: () => app.quit(),
  })
);

// macOS: keep app in dock when all windows closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
