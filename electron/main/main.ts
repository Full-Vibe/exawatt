import { configureJsonStoreDiagnostics } from './atomic-json-file';
import {
  app,
  BrowserWindow,
  shell,
  Menu,
  dialog,
  screen,
  session as electronSession,
  net as electronNet,
  nativeTheme,
  ipcMain,
  systemPreferences,
} from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import {
  assertTrustedIpcSender,
  handleTrusted,
  setTrustedRendererOrigin,
} from './ipc-security';
import { registerSystemShortcutIPC } from './system-shortcuts';
import { registerOperatorStatsIPC } from './operator-stats-ipc';
import { registerConsumptionIPC } from './consumption-ipc';
import { ConsumptionScannerService } from './consumption/scanner-service';
import { sampleRetentionPolicy } from './consumption/retention-policy';
import {
  ClaudePlanAccountService,
  isClaudePlanRemoteReadAllowed,
} from './consumption/claude-plan-account';
import { ProviderPlanCompositeSource } from './consumption/provider-plan-composite';
import { registerAnalyticsIPC } from './analytics-ipc';
import {
  appCrashFromChildProcessGone,
  appCrashFromMainException,
  appCrashFromRenderProcessGone,
  queueMainAnalyticsEvent,
} from './analytics-bridge';
import { randomUUID } from 'crypto';
import { launchScreenUrl } from './launch-screen';
import {
  registerCommandEngineIPC,
  setCommandEnginePhase,
} from './command-engine';
import {
  loadWorkspace,
  mergeHarnessIdentities,
  saveWorkspace,
} from './workspace-store';
import type { PtySessionManager } from './pty/session-manager';
import type {
  ShutdownCoordinator,
  ShutdownIntent,
  ShutdownPhase,
} from './shutdown-coordinator';
import type { RunStateStore } from './run-state';
import type { ElectronAuthCoordinator } from './auth-coordinator';
import { createElectronAuthCookies } from './auth-cookies';
import type { AuthDiagnosticRecorder } from './auth-diagnostics';
import { resolveWindowLaunchMode } from './window-launch-mode';
import { createDirectoryPicker } from './directory-picker';
import {
  appChannels,
  authChannels,
  createAppearanceIpc,
  createDiagnosticsReports,
  dialogChannels,
} from './app-ipc';
import { createDeepLinkRouter, registerDeepLinkProtocol } from './deep-link';
import {
  registerIpcModules,
  registerTrustedChannels,
  type TrustedChannels,
} from './ipc-table';
import { createMenuController } from './menu-controller';
import {
  createMainWindowController,
  createStartupScreen,
  createWorkspaceTarget,
  testWindowPosition,
} from './window';
import { createRendererPortPolicy } from './renderer-port';
import { createRendererServer } from './renderer-server';
import { isClaudePlanWindowsEnabled, loadSettings } from './settings-store';
import {
  applyNativeAppearancePreference,
  type NativeAppearanceResolution,
} from './appearance';
import {
  createDiagnosticsLog,
  type DiagnosticRecorder,
} from './diagnostics-log';
import {
  MainThreadStallTrace,
  STALL_LOG_MAX_BYTES,
  installMainThreadStallTrace,
} from './main-thread-stall-trace';
import {
  UnhandledRejectionTrace,
  installUnhandledRejectionTrace,
} from './unhandled-rejection-trace';
import {
  configureLoginShellScratchDir,
  observedShellStartupArtifacts,
  prepareLoginShellScratchDir,
} from './pty/login-shell';
import {
  assertRendererCompositionAgreement,
  distributionChildEnvironment,
  distributionDataPathOverrides,
  distributionIpcCapabilities,
  loadDevelopmentDistribution,
  loadPackagedDistribution,
} from './distribution';
import { resolveDistributionIdentity } from '@exawatt/core/distribution';
import { commandVerbCapabilities } from '@exawatt/core';

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.EXAWATT_TEST === '1';
const windowLaunchMode = resolveWindowLaunchMode({
  isDevelopment: isDev,
  isTest,
  override: process.env.EXAWATT_WINDOW_MODE,
});
const execFileAsync = promisify(execFile);

// Electron's normal macOS activation policy can take keyboard focus before a
// BrowserWindow exists. Accessory mode prevents that initial app activation;
// an inactive development window promotes itself back to a normal app only
// after the operator deliberately clicks it. Hidden test runs never promote.
if (process.platform === 'darwin' && windowLaunchMode !== 'foreground') {
  app.setActivationPolicy('accessory');
}

// Prevent Electron from constructing a default menu while the app is booting.
// Exawatt installs its real command menu once command services are available.
Menu.setApplicationMenu(null);

// hermetic test runs: isolated userData so smoke tests never touch the
// operator's real workspace layout. Gated on EXAWATT_TEST so a stray env
// var in a normal launch can never silently redirect real layout data.
if (process.env.EXAWATT_TEST && process.env.EXAWATT_USER_DATA) {
  app.setPath('userData', process.env.EXAWATT_USER_DATA);
}
// EXAWATT_DEV_URL lets harnesses point the shell at a different dev server
const DEV_URL = process.env.EXAWATT_DEV_URL || 'http://localhost:7000';
const testQuitResponses =
  process.env.EXAWATT_TEST === '1'
    ? (process.env.EXAWATT_TEST_QUIT_RESPONSES ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    : [];
const safeThemeLaunch = process.argv.includes('--safe-theme');

let rendererReadyPromise: Promise<string> | null = null;
let rendererWasWarmAtLaunch = false;
let bootstrapExitInProgress = false;
let shutdownCoordinator: ShutdownCoordinator | null = null;
let consumptionScanner: ConsumptionScannerService | null = null;
let claudePlanAccount: ClaudePlanAccountService | null = null;
let runStateStore: RunStateStore | null = null;
let authCoordinator: ElectronAuthCoordinator | null = null;
let recordAuthDiagnostic: AuthDiagnosticRecorder = () => {};
/** `logs/main.jsonl`. A no-op until the log opens, once the userData path is
 *  final and before the renderer server starts (its port policy records
 *  here), so anything earlier degrades to dropping the entry, not throwing. */
let mainDiagnostics: DiagnosticRecorder = () => {};
let ptySessions: PtySessionManager;
let disposePty: () => Promise<void> = async () => {};
let disposeRoadmapWatchers: () => void = () => {};
let installProductUpdate: () => void = () => {
  throw new Error('Product updates are not ready.');
};
let checkForUpdatesFromMenu: () => Promise<void> = async () => {};
/** Null until the updater runtime loads; the report says so rather than
 *  inventing an idle status (ENG-025 F5). */
let currentUpdateStatus: () => Record<string, unknown> | null = () => null;

let shutdownCopy: typeof import('./shutdown-coordinator').shutdownCopy;
let safeElectronAuthError: (error: unknown) => {
  name: string;
  message: string;
  status?: number;
  code?: string;
} = error => ({
  name: 'Error',
  message: error instanceof Error ? error.message : 'Authentication failed.',
});
/**
 * Any local process can invoke `exawatt://`, so a link outcome is forwarded to
 * the renderer only after it is recognized. Null until the auth runtime loads,
 * which makes an early deep link queue rather than arrive unvetted.
 */
let isElectronAuthLinkOutcome: ((value: unknown) => boolean) | null = null;
let startupComplete = false;
const pendingCheckpoints = new Map<string, (ok: boolean) => void>();
const workspaceCheckpointOwners = new Set<number>();
const openDirectoryPicker = createDirectoryPicker({
  showOpenDialog: (parent, options) =>
    parent
      ? dialog.showOpenDialog(parent, options)
      : dialog.showOpenDialog(options),
});

interface BuildInfo {
  sha: string;
  branch: string;
  builtAt: string;
  delivery: 'dogfood' | 'signed';
  distributionDigest: string;
  rendererCompositionDigest: string | null;
}

const developmentDistribution = isDev
  ? loadDevelopmentDistribution(process.cwd())
  : null;
const buildInfo: BuildInfo = isDev
  ? {
      sha: 'development',
      branch: 'development',
      builtAt: new Date().toISOString(),
      delivery: 'dogfood',
      distributionDigest: developmentDistribution!.digest,
      rendererCompositionDigest: null,
    }
  : JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf8')
    );
const distribution =
  developmentDistribution ??
  loadPackagedDistribution({
    mainRoot: path.join(__dirname, '..'),
    resourcesPath: process.resourcesPath,
    buildInfoDigest: buildInfo.distributionDigest,
  });
const distributionIdentity = resolveDistributionIdentity(distribution.contract);
const protocolScheme = distributionIdentity.protocolScheme;
const productUpdateFeedUrl = distribution.contract.updates?.feedUrl ?? null;
const productUpdatesEnabled = productUpdateFeedUrl !== null;
app.setName(distributionIdentity.productName);
// Preserve the established official install's data path. Community uses its
// app-id namespace and can never mutate official state or renderer caches.
if (!process.env.EXAWATT_USER_DATA) {
  const overrides = distributionDataPathOverrides(distribution.contract, {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
  });
  if (overrides.userData) app.setPath('userData', overrides.userData);
  if (overrides.sessionData) app.setPath('sessionData', overrides.sessionData);
}
if (!isDev) {
  const compositionRoot = path.join(process.resourcesPath, 'renderer');
  assertRendererCompositionAgreement({
    compositionJson: fs.readFileSync(
      path.join(compositionRoot, 'renderer.composition.json'),
      'utf8'
    ),
    compositionDigest: fs
      .readFileSync(
        path.join(compositionRoot, 'renderer.composition.sha256'),
        'utf8'
      )
      .trim(),
    buildInfoDigest: buildInfo.rendererCompositionDigest,
  });
}

mainDiagnostics = createMainDiagnostics();
const rendererServer = createRendererServer({
  resourcesPath: process.resourcesPath,
  userDataPath: () => app.getPath('userData'),
  cacheNamespace: distributionIdentity.cacheNamespace,
  execPath: process.execPath,
  pid: process.pid,
  isTest,
  childEnvironment: () =>
    distributionChildEnvironment(distribution, process.env),
  forwardStdout: process.env.EXAWATT_RENDERER_LOGS === '1',
  spawn,
  ports: createRendererPortPolicy({
    userDataPath: () => app.getPath('userData'),
    record: (event, fields) => mainDiagnostics(event, fields),
  }),
  extractArchive: async (archive, destination) => {
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', archive, destination]);
  },
});

// A cached renderer uses only Node APIs and can boot before Electron's ready
// event, overlapping its server start with Chromium initialization. A cold
// renderer intentionally waits until the launch frame exists so archive I/O
// cannot delay the first visible acknowledgement.
rendererWasWarmAtLaunch = !isDev && rendererServer.hasWarmCache();
if (rendererWasWarmAtLaunch) {
  rendererReadyPromise = rendererServer.start();
  // bootstrapCommandSurface awaits and reports this same promise. Attach an
  // early observer so a very fast failure cannot become an unhandled rejection
  // before app.whenReady resolves.
  void rendererReadyPromise.catch(() => {});
}

const workspace = createWorkspaceTarget({
  isDev,
  devUrl: DEV_URL,
  rendererOrigin: () => rendererServer.origin,
});
const mainWindow = createMainWindowController({
  createBrowserWindow: options => new BrowserWindow(options),
  preloadPath: path.join(__dirname, 'preload.js'),
  launchMode: windowLaunchMode,
  productUpdatesEnabled,
  openDevTools: isDev && process.env.EXAWATT_DEVTOOLS === '1',
  position: () => testWindowPosition(process.env, screen),
  isWorkspaceTarget: target => workspace.isTarget(target),
  openExternal: url => shell.openExternal(url),
  promoteToRegularApp: () => {
    if (process.platform === 'darwin') app.setActivationPolicy('regular');
  },
  onNavigationReset: () => menu.resetAvailability(),
  onCheckpointOwnerLost: id => workspaceCheckpointOwners.delete(id),
  onLaunchScreenLoaded: () => startupScreen.repaint(),
  onWorkspaceLoaded: url => deepLinks.deliverPending(url),
});
const startupScreen = createStartupScreen(() => mainWindow.current(), {
  progress: 0.08,
  label: 'Opening command surface',
  detail: 'Preparing the local agent interface',
});
/** The main window when it can still parent a native dialog. */
function liveMainWindow(): BrowserWindow | null {
  const win = mainWindow.current();
  return win && !win.isDestroyed() ? win : null;
}

// Any local process can invoke `exawatt://`; the router vets a link before it
// reaches the renderer and holds one that arrives before the workspace loads.
const deepLinks = createDeepLinkRouter({
  protocolScheme,
  window: () => mainWindow.current(),
  authCoordinator: () => authCoordinator,
  isLinkOutcome: () => isElectronAuthLinkOutcome,
  safeAuthError: error => safeElectronAuthError(error),
  isWorkspaceTarget: target => workspace.isTarget(target),
  record: (event, fields) => recordAuthDiagnostic(event, fields),
});
// Must be registered before app.whenReady() to also catch links during startup.
registerDeepLinkProtocol(app, protocolScheme, deepLinks, {
  defaultApp: Boolean(process.defaultApp),
  execPath: process.execPath,
  argv: process.argv,
});

function applyNativeAppearance(): NativeAppearanceResolution {
  const testOsAppearance = isTest
    ? process.env.EXAWATT_TEST_OS_APPEARANCE
    : undefined;
  return applyNativeAppearancePreference(
    loadSettings().appearance,
    nativeTheme,
    {
      safeTheme: safeThemeLaunch,
      systemDarkOverride:
        testOsAppearance === 'dark'
          ? true
          : testOsAppearance === 'light'
            ? false
            : undefined,
    }
  );
}

const menuCapabilities = commandVerbCapabilities(distribution.contract);
const menu = createMenuController({
  context: () => ({
    appName: app.name,
    version: app.getVersion(),
    buildSha: buildInfo.sha.slice(0, 12),
    isDev,
    capabilities: menuCapabilities,
    onCheckForUpdates: productUpdatesEnabled
      ? () => void checkForUpdatesFromMenu()
      : undefined,
    onWindowManagementHelp: () => void promptWindowManagementRestart(),
  }),
  install: template =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
  commandTarget: () =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
});

const diagnosticsReports = createDiagnosticsReports({
  input: () => ({
    build: buildInfo,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    installPath: app.getAppPath(),
    logDirectory: path.join(app.getPath('userData'), 'logs'),
    updateStatus: currentUpdateStatus(),
    liveSessions: ptySessions
      ? ptySessions.list().filter(session => !session.exited).length
      : 0,
    locale: app.getLocale(),
  }),
  downloadsPath: () => app.getPath('downloads'),
  showItemInFolder: filePath => shell.showItemInFolder(filePath),
});
const appearanceIpc = createAppearanceIpc({
  nativeTheme,
  getAccentColor: systemPreferences.getAccentColor
    ? () => systemPreferences.getAccentColor()
    : undefined,
  appearancePreference: () => loadSettings().appearance,
  safeTheme: safeThemeLaunch,
  allWindows: () => BrowserWindow.getAllWindows(),
  assertTrustedSender: event => assertTrustedIpcSender(event),
});
/** The renderer that owns mutable workspace state answers checkpoints. */
const checkpointChannels: TrustedChannels = {
  'app:set-workspace-checkpoint-owner': (
    event,
    ownsWorkspaceState: boolean
  ) => {
    if (typeof ownsWorkspaceState !== 'boolean') return;
    if (ownsWorkspaceState) workspaceCheckpointOwners.add(event.sender.id);
    else workspaceCheckpointOwners.delete(event.sender.id);
  },
  'app:complete-checkpoint': (_event, requestId: string, ok: boolean) => {
    if (typeof requestId !== 'string' || typeof ok !== 'boolean') return;
    const complete = pendingCheckpoints.get(requestId);
    if (!complete) return;
    pendingCheckpoints.delete(requestId);
    complete(ok);
  },
};

/** Main's own channels, keyed by name, through the one trusted door. */
function registerMainChannels(): void {
  registerTrustedChannels(
    [
      authChannels({
        coordinator: () => authCoordinator,
        record: (event, fields) => recordAuthDiagnostic(event, fields),
        safeAuthError: error => safeElectronAuthError(error),
        env: process.env,
      }),
      dialogChannels({
        openDirectoryPicker,
        windowFor: sender => BrowserWindow.fromWebContents(sender),
        env: process.env,
      }),
      appChannels({
        buildInfo: () => ({
          ...buildInfo,
          // marketed version alongside the exact sha (ENG-025 feedback stamping)
          version: app.getVersion(),
          distribution: {
            contract: distribution.contract,
            digest: distribution.digest,
            identity: distributionIdentity,
            capabilities: distributionIpcCapabilities(distribution.contract),
          },
        }),
        reports: diagnosticsReports,
        record: (event, fields) => mainDiagnostics(event, fields),
        windowFor: sender => BrowserWindow.fromWebContents(sender),
      }),
      appearanceIpc.channels,
      checkpointChannels,
      menu.channels,
    ],
    handleTrusted
  );
  appearanceIpc.register((channel, listener) => ipcMain.on(channel, listener));
}

function watchInstalledBuild(): void {
  const statePath = path.join(app.getPath('userData'), 'update-state.json');
  const report = async () => {
    try {
      const state = JSON.parse(
        await fs.promises.readFile(statePath, 'utf8')
      ) as {
        installedSha?: string;
      };
      if (state.installedSha && state.installedSha !== buildInfo.sha) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('app:update-ready', {
              currentSha: buildInfo.sha,
              installedSha: state.installedSha,
            });
          }
        }
      }
    } catch {
      // No installed update state yet.
    }
  };
  fs.watchFile(statePath, { interval: 2_000 }, () => void report());
  void report();
}

function broadcastShutdown(
  phase: ShutdownPhase,
  counts: { agents: number; shells: number }
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:shutdown-status', { phase, ...counts });
    }
  }
}

async function confirmShutdown(
  intent: ShutdownIntent,
  counts: { agents: number; shells: number }
): Promise<boolean> {
  if (process.env.EXAWATT_TEST === '1') {
    const response =
      testQuitResponses.shift() ?? process.env.EXAWATT_TEST_QUIT_RESPONSE;
    if (response === 'cancel') return false;
    return true;
  }
  const copy = shutdownCopy(intent, counts, distributionIdentity.productName);
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: copy.title,
    message: copy.title,
    detail:
      intent === 'update'
        ? `${copy.detail} The downloaded update will then install and reopen ${distributionIdentity.productName}.`
        : intent === 'restart'
          ? `${copy.detail} ${distributionIdentity.productName} reopens automatically.`
          : copy.detail,
    buttons: [
      'Cancel',
      intent === 'quit' ? 'Quit and Stop' : 'Restart and Stop',
    ],
    cancelId: 0,
    noLink: true,
  };
  const result = liveMainWindow()
    ? await dialog.showMessageBox(liveMainWindow()!, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

/**
 * Operator-initiated explanation for incident 0001: after long uptime macOS can
 * stop vending Exawatt's accessibility element, and every AX-driven window
 * manager (Divvy, Rectangle, Hammerspoon) then resolves the app to zero windows
 * and silently does nothing. Exawatt CANNOT detect this — self-inspection
 * returns kAXErrorAPIDisabled without Accessibility permission, and asking the
 * operator to grant that for one degraded case is not worth it. So the remedy
 * is named here rather than detected, and routed through the normal shutdown
 * coordinator so Sessions and history checkpoint and rehydrate.
 */
async function promptWindowManagementRestart(): Promise<void> {
  const message = "Window management isn't working?";
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: message,
    message,
    detail: `After ${distributionIdentity.productName} has been open a long time, macOS can stop sharing its window with tools like Divvy, Rectangle, and Hammerspoon, so their shortcuts do nothing and you hear an error sound. This is a known macOS issue with Electron apps that ${distributionIdentity.productName} cannot detect or repair on its own.\n\nRestarting fixes it. Projects, Sessions, and terminal history are saved and restored; running agents stop and can be resumed afterwards.`,
    buttons: ['Cancel', `Restart ${distributionIdentity.productName}`],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const result = liveMainWindow()
    ? await dialog.showMessageBox(liveMainWindow()!, options)
    : await dialog.showMessageBox(options);
  if (result.response === 1) await shutdownCoordinator?.request('restart');
}

async function confirmWithoutCheckpoint(
  intent: ShutdownIntent
): Promise<boolean> {
  if (
    process.env.EXAWATT_TEST === '1' &&
    process.env.EXAWATT_TEST_CHECKPOINT_FAILURE === 'confirm'
  ) {
    return true;
  }
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: `${distributionIdentity.productName} couldn't save the latest Session state`,
    message: `${distributionIdentity.productName} couldn't save the latest Session state`,
    detail:
      'Quitting now may lose recent layout changes. Terminal history already checkpointed by the main process will remain.',
    buttons: ['Cancel', intent === 'quit' ? 'Quit Anyway' : 'Restart Anyway'],
    cancelId: 0,
    noLink: true,
  };
  const result = liveMainWindow()
    ? await dialog.showMessageBox(liveMainWindow()!, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

/**
 * When no renderer owns mutable workspace state (quit from /settings or the
 * Fleet altitude, or a non-personal tenant Workspace has the shell unmounted
 * behind the ENG-027 scope gate), the persisted LAYOUT is authoritative — but
 * harness identities settled after the shell unmounted still need to land.
 * Merge them into the store in-process so stale harness session ids cannot
 * survive a quit that never reaches the renderer checkpoint.
 */
async function refreshPersistedHarnessIdentities(): Promise<boolean> {
  try {
    const live = new Map<string, string>();
    for (const session of ptySessions.list()) {
      if (session.harnessSessionId) {
        live.set(session.durableSessionId, session.harnessSessionId);
      }
    }
    if (live.size === 0) return true;
    const state = await loadWorkspace();
    if (!mergeHarnessIdentities(state, live)) return true;
    await saveWorkspace(state);
    return true;
  } catch (error) {
    console.error('[shutdown] harness identity refresh failed', error);
    return false;
  }
}

async function checkpointRenderer(
  intent: ShutdownIntent,
  stage: 'pre-stop' | 'stopped'
): Promise<boolean> {
  if (stage === 'pre-stop') await ptySessions.settleProviderIdentities();
  const win = mainWindow.current();
  // Workspace state is mutable only while the workspace hook is mounted;
  // otherwise the store on disk holds the layout and main lands the settled
  // harness identities itself.
  if (!win || win.isDestroyed()) return refreshPersistedHarnessIdentities();
  if (!workspaceCheckpointOwners.has(win.webContents.id)) {
    return refreshPersistedHarnessIdentities();
  }
  const requestId = randomUUID();
  return await new Promise<boolean>(resolve => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingCheckpoints.delete(requestId);
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 3_000);
    pendingCheckpoints.set(requestId, finish);
    win.webContents.send('app:checkpoint-request', {
      requestId,
      reason: intent,
      stage,
    });
  });
}

async function cleanupForExit(): Promise<void> {
  disposeRoadmapWatchers();
  await disposePty();
  await rendererServer.stop();
  fs.unwatchFile(path.join(app.getPath('userData'), 'update-state.json'));
}

async function reportShutdownFailure(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  const options: Electron.MessageBoxOptions = {
    type: 'error',
    title: `${distributionIdentity.productName} couldn't stop every Session`,
    message: `${distributionIdentity.productName} couldn't stop every Session`,
    detail: `${detail.slice(0, 400)}\n\n${distributionIdentity.productName} will remain open. Check the affected Session before quitting again.`,
    buttons: ['OK'],
    noLink: true,
  };
  const parent = liveMainWindow();
  if (parent) {
    await dialog.showMessageBox(parent, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

async function bootstrapCommandSurface(): Promise<void> {
  const rendererReady = (
    isDev
      ? Promise.resolve(DEV_URL)
      : (rendererReadyPromise ??= rendererServer.start())
  ).then(url => {
    // The trusted origin is established by the step that establishes the
    // origin. It used to be set at the tail of bootstrap, which meant the
    // engine-state channel — the one surface whose whole job is to report a
    // failed bootstrap — would have rejected its own renderer (BUG-016).
    setTrustedRendererOrigin(url);
    startupScreen.update({
      progress: 0.62,
      label: 'Renderer online',
      detail: 'Local command surface is accepting connections',
    });
    return url;
  });

  const runtimeReady = Promise.all([
    import('./agent-sources-ipc'),
    import('./pty-ipc'),
    import('./roadmap/roadmap-ipc'),
    import('./projects/project-ipc'),
    import('./roadmap/roadmap-watcher'),
    import('./pty/session-manager'),
    import('./updater'),
    import('./shutdown-coordinator'),
    import('./run-state'),
    import('./auth-coordinator'),
    import('./auth-diagnostics'),
    import('./connected-sources-ipc'),
  ]).then(
    ([
      agentSourcesIpc,
      ptyIpc,
      roadmapIpc,
      projectIpc,
      roadmapWatcher,
      sessionManager,
      updater,
      shutdown,
      runState,
      auth,
      authDiagnostics,
      connectedSourcesIpc,
    ]) => {
      startupScreen.update({
        progress: 0.36,
        label: 'Command engine loaded',
        detail: 'Agent and Session services are initializing',
      });
      return {
        agentSourcesIpc,
        ptyIpc,
        roadmapIpc,
        projectIpc,
        roadmapWatcher,
        sessionManager,
        updater,
        shutdown,
        runState,
        auth,
        authDiagnostics,
        connectedSourcesIpc,
      };
    }
  );

  const [trustedRendererUrl, runtime] = await Promise.all([
    rendererReady,
    runtimeReady,
  ]);
  ptySessions = runtime.sessionManager.ptySessions;
  ptySessions.setProductName(distributionIdentity.productName);
  disposePty = runtime.ptyIpc.disposePty;
  disposeRoadmapWatchers = runtime.roadmapWatcher.disposeRoadmapWatchers;
  if (productUpdatesEnabled) {
    installProductUpdate = runtime.updater.installProductUpdate;
    checkForUpdatesFromMenu = runtime.updater.checkForUpdatesFromMenu;
    currentUpdateStatus = () => ({ ...runtime.updater.currentUpdateStatus() });
  }
  shutdownCopy = runtime.shutdown.shutdownCopy;
  safeElectronAuthError = runtime.auth.safeElectronAuthError;
  isElectronAuthLinkOutcome = runtime.auth.isElectronAuthLinkOutcome;

  const authLogPath = path.join(app.getPath('userData'), 'logs', 'auth.jsonl');
  recordAuthDiagnostic =
    runtime.authDiagnostics.createPersistentAuthDiagnostics({
      logPath: authLogPath,
      context: {
        buildSha: buildInfo.sha,
        buildBranch: buildInfo.branch,
        buildDelivery: buildInfo.delivery,
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
    });
  recordAuthDiagnostic('auth.runtime.ready', {
    transport: 'electron.net.fetch',
    logPath: authLogPath,
  });

  const electronNetworkFetch: typeof fetch = (input, init) =>
    electronNet.fetch(input instanceof URL ? input.toString() : input, init);
  const authFetch = runtime.authDiagnostics.instrumentAuthFetch(
    electronNetworkFetch,
    recordAuthDiagnostic,
    'electron.net.fetch'
  );

  authCoordinator = new runtime.auth.ElectronAuthCoordinator({
    expectedRendererOrigin: trustedRendererUrl,
    openExternal: url => shell.openExternal(url),
    cookies: createElectronAuthCookies(
      electronSession.defaultSession.cookies,
      trustedRendererUrl,
      recordAuthDiagnostic
    ),
    fetch: authFetch,
    recordDiagnostic: recordAuthDiagnostic,
  });
  runStateStore = new runtime.runState.RunStateStore(
    path.join(app.getPath('userData'), 'run-state.json')
  );
  const [, recovery] = await Promise.all([
    ptySessions.configurePersistence(
      path.join(app.getPath('userData'), 'sessions')
    ),
    runStateStore.begin(),
  ]);
  startupScreen.update({
    progress: 0.78,
    label: 'Session index restored',
    detail: 'Durable local state is ready',
  });

  // Registration is data: one row per module that owns channels, in the
  // order they must exist. Adding a module's channels is a row here; adding
  // one of main's own channels is an entry in its table (`ipc-table.ts`).
  registerIpcModules([
    {
      id: 'agent-sources',
      register: () => runtime.agentSourcesIpc.registerAgentSourcesIPC(),
    },
    {
      id: 'connected-sources',
      register: () => runtime.connectedSourcesIpc.registerConnectedSourcesIPC(),
    },
    {
      id: 'pty',
      register: () =>
        runtime.ptyIpc.registerPtyIPC(
          distribution.contract,
          recovery.previousRunInterrupted,
          // Late-bound on purpose: a recorder captured by value would be whatever
          // `mainDiagnostics` held at registration, not the log it holds later.
          (event, fields) => mainDiagnostics(event, fields)
        ),
    },
    { id: 'roadmap', register: () => runtime.roadmapIpc.registerRoadmapIPC() },
    { id: 'projects', register: () => runtime.projectIpc.registerProjectIPC() },
    { id: 'main', register: registerMainChannels },
    { id: 'system-shortcuts', register: registerSystemShortcutIPC },
    {
      id: 'operator-stats',
      register: () => {
        consumptionScanner = new ConsumptionScannerService({
          stateDir: path.join(app.getPath('userData'), 'consumption-scan'),
          identities: () => ptySessions.listProviderIdentities(),
          // BUG-032: samples are a bounded collection. The default horizon is 14
          // days; an ACTIVE Operator-profile publication widens it to its opt-in
          // anchor, so a republish (a new Run derivation, a long outage) can still
          // cover everything since consent. Publication can no longer be HARMED
          // by a narrower horizon — it never claims dates at or before the prune
          // line (BUG-164) — but it can only republish what is retained. The read
          // is LIVE, not a boot-time snapshot: the anchor is written by the
          // renderer's first sync minutes from now (BUG-141).
          // `sampleRetentionPolicy` is the one owner both hydrate and compaction
          // consult.
          sampleHorizonMs: sampleRetentionPolicy(),
        });
        registerOperatorStatsIPC(consumptionScanner, (event, fields) =>
          mainDiagnostics(event, fields)
        );
      },
    },
    {
      id: 'consumption',
      register: () => {
        // ENG-038: the credentialed Claude plan-account read — a SIBLING of the
        // scanner (the local parse stays credential- and network-free), merged
        // behind the same IPC seam by the composite.
        claudePlanAccount = new ClaudePlanAccountService({
          stateDir: path.join(app.getPath('userData'), 'consumption-plan'),
          enabled: isClaudePlanWindowsEnabled(loadSettings()),
          // Chromium owns the request in installed builds, so Little Snitch sees
          // a stable Developer ID instead of Node or an ad-hoc Electron helper.
          // WHICH builds those are is the distribution's declaration, not
          // `app.isPackaged` — an ad-hoc community package is packaged too
          // (BUG-060, decision `0036` §6). Routine unpackaged and automated test
          // launches stay local; the narrow override deliberately exercises this
          // exact account integration.
          remoteReadAllowed: isClaudePlanRemoteReadAllowed({
            stableSignedIdentity:
              distribution.contract.ownAccount?.claudePlanUsage ===
              'stable-signed',
            packaged: app.isPackaged,
            testMode: isTest,
            developmentOptIn: process.env.EXAWATT_DEV_CLAUDE_PLAN_NETWORK,
          }),
          fetchFn: electronNetworkFetch,
        });
        registerConsumptionIPC(
          () => BrowserWindow.getAllWindows(),
          new ProviderPlanCompositeSource(
            consumptionScanner!,
            claudePlanAccount
          ),
          claudePlanAccount
        );
      },
    },
    { id: 'analytics', register: registerAnalyticsIPC },
  ]);
  shutdownCoordinator = new runtime.shutdown.ShutdownCoordinator({
    countLive: () => {
      const live = ptySessions.list().filter(session => !session.exited);
      return {
        agents: live.filter(session => session.harness !== 'shell').length,
        shells: live.filter(session => session.harness === 'shell').length,
      };
    },
    confirm: confirmShutdown,
    checkpoint: checkpointRenderer,
    confirmWithoutCheckpoint,
    pauseNewWork: () => ptySessions.pauseCreates(),
    resumeNewWork: () => ptySessions.resumeCreates(),
    flushHistory: () => ptySessions.flushHistory(),
    stopProcesses: () => ptySessions.stopAll(),
    markClean: () => runStateStore?.markClean() ?? Promise.resolve(),
    cleanup: cleanupForExit,
    failure: reportShutdownFailure,
    finalize: intent => {
      if (intent === 'update') installProductUpdate();
      else {
        // A restart must come back on its own; a quit must not.
        if (intent === 'restart') app.relaunch();
        app.quit();
      }
    },
    status: broadcastShutdown,
  });
  if (productUpdatesEnabled) {
    runtime.updater.registerProductUpdater(
      productUpdateFeedUrl,
      () => ptySessions.list().filter(session => !session.exited).length,
      () => shutdownCoordinator!.request('update')
    );
  }
  menu.rebuild();
  startupScreen.update({
    progress: 0.94,
    label: 'Entering workspace',
    detail: 'Command services are ready',
  });

  setCommandEnginePhase('ready');

  const win = mainWindow.current();
  if (win && !win.isDestroyed()) await win.loadURL(workspace.url());
  startupComplete = true;
  watchInstalledBuild();
  if (productUpdatesEnabled) {
    runtime.updater.startProductUpdater(buildInfo.delivery === 'signed');
  }
  if (!isDev) rendererServer.pruneCache();
}

/**
 * Main-process diagnostics: `logs/main.jsonl`, bounded and rotated, alongside
 * `updater.jsonl` / `auth.jsonl` / `summarizer.jsonl`. A recorder that cannot
 * open its file degrades to a no-op — instrumentation must never keep the app
 * from booting.
 */
function createMainDiagnostics(): (
  event: string,
  fields?: Record<string, unknown>
) => void {
  try {
    return createDiagnosticsLog(
      path.join(app.getPath('userData'), 'logs', 'main.jsonl'),
      STALL_LOG_MAX_BYTES
    );
  } catch {
    return () => {};
  }
}

/**
 * The operator's shell startup runs in an Exawatt-owned scratch directory, not
 * in his Projects (incident `0006`). Because Exawatt owns that directory it can
 * also SEE what the startup writes, which is the finding the incident wanted:
 * the files are named in the diagnostics log instead of being discovered as
 * mystery junk in a repository. One observation per run, well after launch.
 */
function watchShellStartupArtifacts(
  record: (event: string, fields?: Record<string, unknown>) => void
): void {
  configureLoginShellScratchDir(
    path.join(app.getPath('userData'), 'shell-startup')
  );
  void prepareLoginShellScratchDir()
    .then(() => {
      const timer = setTimeout(() => {
        void observedShellStartupArtifacts()
          .then(names => {
            if (names.length === 0) return;
            record('shell.startup.writes-files', { names });
          })
          .catch(() => {});
      }, 90_000);
      timer.unref?.();
    })
    .catch(() => {});
}

app.whenReady().then(() => {
  configureJsonStoreDiagnostics(mainDiagnostics);
  // Standing main-thread instrumentation: the next beachball records itself.
  // Started before the window so a stall during startup is captured too.
  installMainThreadStallTrace(
    new MainThreadStallTrace({ record: mainDiagnostics })
  );
  // A rejection nobody awaited used to end as a console line the packaged
  // app does not keep (BUG-129 main half, BUG-146). Bounded and rate-limited
  // like the stall trace; it records, it never recovers.
  installUnhandledRejectionTrace(
    new UnhandledRejectionTrace({ record: mainDiagnostics })
  );
  watchShellStartupArtifacts(mainDiagnostics);
  // Registered BEFORE bootstrap so it survives bootstrap failing: this is the
  // channel that reports exactly that (BUG-016).
  registerCommandEngineIPC(() => BrowserWindow.getAllWindows());
  // Warm server startup is already in flight. On a version cache miss, give
  // the native launch frame priority over archive extraction.
  let commandSurface = rendererWasWarmAtLaunch
    ? bootstrapCommandSurface()
    : null;
  const appearance = applyNativeAppearance();
  mainWindow.open(
    launchScreenUrl(appearance.bootstrap, distributionIdentity.productName),
    appearance
  );
  commandSurface ??= bootstrapCommandSurface();

  app.on('activate', () => {
    if (shutdownCoordinator?.phase !== 'idle') return;
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextAppearance = applyNativeAppearance();
      mainWindow.open(
        startupComplete
          ? workspace.url()
          : launchScreenUrl(
              nextAppearance.bootstrap,
              distributionIdentity.productName
            ),
        nextAppearance
      );
    }
  });

  void commandSurface.catch(error => {
    console.error('[startup] command surface failed', error);
    // Say it on the splash AND on the wire. Without the second half, a
    // renderer that reaches a product surface anyway shows a complete, zeroed
    // local read (BUG-016).
    setCommandEnginePhase('paused');
    startupScreen.update({
      progress: startupScreen.stage().progress,
      label: 'Command engine paused',
      detail: `${distributionIdentity.productName} could not start its local command services`,
      failed: true,
    });
  });
});

// ENG-030 OS1.5b — main-process crash coverage (`app_crashed`). Each listener
// queues one typed event into the in-memory analytics bridge; it reaches
// PostHog only if a renderer later drains it through the allowlisted emission
// path (decision `0034`: main has no analytics destination of its own). A
// crash at quit that never drains is an accepted loss — no persistence, no
// extra work on the crash path.
app.on('render-process-gone', (_event, _webContents, details) => {
  const crash = appCrashFromRenderProcessGone(details.reason, app.getVersion());
  if (crash) queueMainAnalyticsEvent(crash);
});
app.on('child-process-gone', (_event, details) => {
  const crash = appCrashFromChildProcessGone(
    details.type,
    details.reason,
    app.getVersion()
  );
  if (crash) queueMainAnalyticsEvent(crash);
});
// `uncaughtExceptionMonitor` observes without changing Node's default crash
// behavior — the safe way to see main's own death. Queue-and-hope: if the
// process dies before a drain, the event is lost, and that is fine.
process.on('uncaughtExceptionMonitor', () => {
  try {
    queueMainAnalyticsEvent(appCrashFromMainException(app.getVersion()));
  } catch {
    // Never add a second failure to the crash path.
  }
});

app.on('before-quit', event => {
  // Abort any in-flight background scan and settle its state writes. The
  // store is crash-safe (append-ordered, atomic meta), so this is a courtesy
  // flush, never a correctness requirement — it must not delay quit.
  void consumptionScanner?.dispose();
  claudePlanAccount?.dispose();
  if (!shutdownCoordinator) {
    if (bootstrapExitInProgress) return;
    event.preventDefault();
    bootstrapExitInProgress = true;
    void rendererServer
      .stop()
      .catch(error => console.error('[shutdown] renderer stop failed', error))
      .finally(() => app.quit());
    return;
  }
  if (shutdownCoordinator.allowsFinalExit) return;
  event.preventDefault();
  void shutdownCoordinator.request('quit');
});

// macOS: keep app in dock when all windows closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
