import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net as electronNet,
  screen,
  session as electronSession,
  shell,
  systemPreferences,
} from 'electron';
import { randomUUID } from 'crypto';
import path from 'path';
import { commandVerbCapabilities } from '@exawatt/core';
import { registerMainChannels } from './app-ipc';
import {
  applyNativeAppearancePreference,
  testSystemDarkOverride,
} from './appearance';
import {
  applyBuildIdentity,
  assertPackagedRendererComposition,
  resolveBuildIdentity,
} from './build-identity';
import {
  registerCommandEngineIPC,
  setCommandEnginePhase,
} from './command-engine';
import {
  bootstrapCommandSurface,
  CommandRuntime,
  reportCommandSurfaceFailure,
} from './command-surface';
import { createDeepLinkRouter, registerDeepLinkProtocol } from './deep-link';
import { distributionChildEnvironment } from './distribution';
import {
  assertTrustedIpcSender,
  handleTrusted,
  setTrustedRendererOrigin,
} from './ipc-security';
import { launchScreenUrl } from './launch-screen';
import {
  installCrashAnalytics,
  installMainInstrumentation,
  openMainDiagnostics,
} from './main-diagnostics';
import { createMenuController } from './menu-controller';
import { createRendererPortPolicy } from './renderer-port';
import { createRendererServer } from './renderer-server';
import { loadSettings } from './settings-store';
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
 * them. Behaviour lives in the modules it names.
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

const build = resolveBuildIdentity({
  isDev,
  cwd: process.cwd(),
  mainRoot: path.join(__dirname, '..'),
  resourcesPath: process.resourcesPath,
});
const { buildInfo, distribution, identity } = build;
const productUpdateFeedUrl = distribution.contract.updates?.feedUrl ?? null;
applyBuildIdentity(app, build, env);
if (!isDev) assertPackagedRendererComposition(process.resourcesPath, buildInfo);

const runtime = new CommandRuntime();
const mainDiagnostics = openMainDiagnostics(userDataPath());

const rendererServer = createRendererServer({
  userDataPath,
  cacheNamespace: identity.cacheNamespace,
  isTest,
  childEnvironment: () => distributionChildEnvironment(distribution, env),
  forwardStdout: env.EXAWATT_RENDERER_LOGS === '1',
  ports: createRendererPortPolicy({ userDataPath, record: mainDiagnostics }),
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
const mainWindow = createMainWindowController({
  createBrowserWindow: options => new BrowserWindow(options),
  preloadPath: path.join(__dirname, 'preload.js'),
  launchMode: windowLaunchMode,
  productUpdatesEnabled: productUpdateFeedUrl !== null,
  openDevTools: isDev && env.EXAWATT_DEVTOOLS === '1',
  position: () => testWindowPosition(env, screen),
  isWorkspaceTarget: target => workspace.isTarget(target),
  openExternal: url => shell.openExternal(url),
  promoteToRegularApp: () => {
    if (process.platform === 'darwin') app.setActivationPolicy('regular');
  },
  onNavigationReset: () => menu.resetAvailability(),
  onCheckpointOwnerLost: id => checkpoints.release(id),
  onLaunchScreenLoaded: () => startupScreen.repaint(),
  onWorkspaceLoaded: url => deepLinks.deliverPending(url),
});
const startupScreen = createStartupScreen(() => mainWindow.current());

const deepLinks = createDeepLinkRouter({
  protocolScheme: identity.protocolScheme,
  window: () => mainWindow.current(),
  authCoordinator: () => runtime.authCoordinator,
  isLinkOutcome: () => runtime.isLinkOutcome,
  safeAuthError: error => runtime.safeAuthError(error),
  isWorkspaceTarget: target => workspace.isTarget(target),
  record: (event, fields) => runtime.recordAuthDiagnostic(event, fields),
});
// Before app.whenReady(), so a link that launches the app is not lost.
registerDeepLinkProtocol(app, identity.protocolScheme, deepLinks, process);

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
  checkpoints,
  workspace: {
    load: loadWorkspace,
    mergeHarnessIdentities,
    save: saveWorkspace,
  },
  cleanup: [
    () => runtime.disposeRoadmapWatchers(),
    () => runtime.disposePty(),
    () => rendererServer.stop(),
    () => runtime.installedBuildWatch?.stop(),
  ],
  finalize: {
    installUpdate: () => runtime.installProductUpdate(),
    relaunch: () => app.relaunch(),
    quit: () => app.quit(),
  },
  coordinator: () => runtime.shutdownCoordinator,
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
        ? () => void runtime.checkForUpdatesFromMenu()
        : undefined,
    onWindowManagementHelp: () =>
      void shutdownSequence.promptWindowManagementRestart(),
  }),
  install: template =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
  commandTarget: () =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
});

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
    pruneRendererCache: () => rendererServer.pruneCache(),
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
        safeTheme: safeThemeLaunch,
        appearancePreference: () => loadSettings().appearance,
        record: mainDiagnostics,
        tables: [checkpoints.channels, menu.channels],
      }),
    shutdownSequence,
    rebuildMenu: () => menu.rebuild(),
    mainDiagnostics,
    setEnginePhase: setCommandEnginePhase,
    enterWorkspace: async () => {
      const win = mainWindow.current();
      if (win && !win.isDestroyed()) await win.loadURL(workspace.url());
    },
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
  installMainInstrumentation(userDataPath(), mainDiagnostics);
  // Registered BEFORE bootstrap so it survives bootstrap failing: this is the
  // channel that reports exactly that (BUG-016).
  registerCommandEngineIPC(() => BrowserWindow.getAllWindows());
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

installCrashAnalytics(app, process);

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
