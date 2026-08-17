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
import { spawn, type ChildProcess } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import nodeNet from 'net';
import http from 'http';
import path from 'path';
import {
  assertTrustedIpcSender,
  handleTrusted,
  setTrustedRendererOrigin,
} from './ipc-security';
import { registerSystemShortcutIPC } from './system-shortcuts';
import {
  buildDiagnosticsReport,
  type DiagnosticsReport,
} from './diagnostics-report';
import { registerOperatorStatsIPC } from './operator-stats-ipc';
import { registerConsumptionIPC } from './consumption-ipc';
import { resolveSampleHorizonMs } from '@exawatt/core';
import { ConsumptionScannerService } from './consumption/scanner-service';
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
import { launchScreenUrl, type StartupStage } from './launch-screen';
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
import type {
  ElectronAuthCoordinator,
  ElectronAuthLinkConfig,
  ElectronAuthStartConfig,
} from './auth-coordinator';
import { createElectronAuthCookies } from './auth-cookies';
import type { AuthDiagnosticRecorder } from './auth-diagnostics';
import { resolveWindowLaunchMode } from './window-launch-mode';
import { createDirectoryPicker } from './directory-picker';
import { stopChildProcess } from './child-process-lifecycle';
import {
  availabilityMenuCommands,
  buildApplicationMenuTemplate,
  defaultMenuAccelerators,
} from './application-menu';
import { isClaudePlanWindowsEnabled, loadSettings } from './settings-store';
import {
  applyNativeAppearancePreference,
  refreshNativeWindowBackgrounds,
  rendererAppearanceBootstrapSnapshot,
  type NativeAppearanceResolution,
} from './appearance';
import { AX_TILEABLE_WINDOW_SHAPE } from './window-shape';
import { createDiagnosticsLog } from './diagnostics-log';
import {
  MainThreadStallTrace,
  STALL_LOG_MAX_BYTES,
  installMainThreadStallTrace,
} from './main-thread-stall-trace';
import {
  configureLoginShellScratchDir,
  observedShellStartupArtifacts,
  prepareLoginShellScratchDir,
} from './pty/login-shell';
import {
  assertRendererCompositionAgreement,
  distributionChildEnvironment,
  distributionIpcCapabilities,
  loadDevelopmentDistribution,
  loadPackagedDistribution,
} from './distribution';
import { resolveDistributionIdentity } from '@exawatt/core/distribution';

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

let mainWindow: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = null;
let rendererServer: ChildProcess | null = null;
let rendererOrigin: string | null = null;
let activeRendererCacheKey: string | null = null;
let rendererReadyPromise: Promise<string> | null = null;
let rendererWasWarmAtLaunch = false;
let bootstrapExitInProgress = false;
let shutdownCoordinator: ShutdownCoordinator | null = null;
let consumptionScanner: ConsumptionScannerService | null = null;
let claudePlanAccount: ClaudePlanAccountService | null = null;
let runStateStore: RunStateStore | null = null;
let authCoordinator: ElectronAuthCoordinator | null = null;
let recordAuthDiagnostic: AuthDiagnosticRecorder = () => {};
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

/**
 * ENG-025 F5 — assemble the anonymized diagnostics bundle from whatever main
 * currently knows. Deliberately tolerant: a report from a half-started or
 * broken app is exactly the report worth having, so every source degrades to
 * a null or a zero rather than throwing.
 */
function collectDiagnosticsReport(signedIn: boolean): DiagnosticsReport {
  return buildDiagnosticsReport({
    build: buildInfo,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    installPath: app.getAppPath(),
    logDirectory: path.join(app.getPath('userData'), 'logs'),
    updateStatus: currentUpdateStatus(),
    signedIn,
    liveSessions: ptySessions
      ? ptySessions.list().filter(session => !session.exited).length
      : 0,
    locale: app.getLocale(),
  });
}

/**
 * The signed-out path. ⌘⇧F is a no-op without an account and a broken install
 * is disproportionately signed out, so the report has to be obtainable with
 * no network and no session: write it next to the user's other downloads and
 * put a Finder window in front of them.
 */
async function saveDiagnosticsReport(
  signedIn: boolean
): Promise<{ ok: boolean; filePath: string | null }> {
  try {
    const report = collectDiagnosticsReport(signedIn);
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const filePath = path.join(
      app.getPath('downloads'),
      `exawatt-diagnostics-${stamp}.json`
    );
    await fs.promises.writeFile(
      filePath,
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    shell.showItemInFolder(filePath);
    return { ok: true, filePath };
  } catch {
    return { ok: false, filePath: null };
  }
}
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
let inactiveLaunchPromoted = false;
let startupStage: StartupStage = {
  progress: 0.08,
  label: 'Opening command surface',
  detail: 'Preparing the local agent interface',
};
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
const productUpdatesEnabled = distribution.contract.updates !== null;
app.setName(distributionIdentity.productName);
// Preserve the established official install's state location. A source build
// gets an app-id-derived namespace so it can never mutate official state or
// reuse its extracted renderer cache.
if (!distribution.contract.brand && !process.env.EXAWATT_USER_DATA) {
  app.setPath(
    'userData',
    path.join(
      path.dirname(app.getPath('userData')),
      distributionIdentity.stateNamespace
    )
  );
  app.setPath(
    'sessionData',
    path.join(
      path.dirname(app.getPath('sessionData')),
      `${distributionIdentity.cacheNamespace}.cache`
    )
  );
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

async function availableLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = nodeNet.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a renderer port'));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForRenderer(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>(resolve => {
      const request = http.get(url, response => {
        response.resume();
        resolve(response.statusCode !== undefined && response.statusCode < 500);
      });
      request.once('error', () => resolve(false));
      request.setTimeout(1_000, () => {
        request.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    if (rendererServer?.exitCode !== null) {
      throw new Error(
        `Packaged renderer exited with ${rendererServer?.exitCode}`
      );
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Timed out starting the packaged renderer');
}

async function startPackagedRenderer(): Promise<string> {
  const port = await availableLoopbackPort();
  const packagedRenderer = path.join(process.resourcesPath, 'renderer');
  const archive = path.join(packagedRenderer, 'renderer.zip');
  const archiveHash = (
    await fs.promises.readFile(
      path.join(packagedRenderer, 'renderer.sha256'),
      'utf8'
    )
  ).trim();
  activeRendererCacheKey = archiveHash;
  const cacheRoot = path.join(
    app.getPath('userData'),
    'renderer-cache',
    distributionIdentity.cacheNamespace
  );
  const versionRoot = path.join(cacheRoot, archiveHash);
  const standaloneRoot = path.join(versionRoot, 'dist-renderer');
  try {
    await fs.promises.access(path.join(standaloneRoot, 'server.js'));
  } catch {
    const staging = `${versionRoot}.staging-${process.pid}`;
    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.mkdir(staging, { recursive: true });
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', archive, staging]);
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    await fs.promises.rename(staging, versionRoot).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await fs.promises.rm(staging, { recursive: true, force: true });
    });
  }
  const serverEntry = path.join(standaloneRoot, 'server.js');
  rendererServer = spawn(process.execPath, [serverEntry], {
    cwd: standaloneRoot,
    env: {
      ...distributionChildEnvironment(distribution, process.env),
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  rendererServer.stdout?.on('data', data => {
    if (process.env.EXAWATT_RENDERER_LOGS === '1') process.stdout.write(data);
  });
  rendererServer.stderr?.on('data', data => process.stderr.write(data));
  const origin = `http://127.0.0.1:${port}`;
  await waitForRenderer(`${origin}/workspace`);
  rendererOrigin = origin;
  return origin;
}

function pruneRendererCache(): void {
  const cacheRoot = path.join(
    app.getPath('userData'),
    'renderer-cache',
    distributionIdentity.cacheNamespace
  );
  const keep = activeRendererCacheKey;
  if (!keep) return;
  const delay = process.env.EXAWATT_TEST === '1' ? 250 : 15_000;
  setTimeout(() => {
    void fs.promises
      .readdir(cacheRoot, { withFileTypes: true })
      .then(entries =>
        Promise.all(
          entries
            .filter(entry => entry.name !== keep)
            .map(entry =>
              fs.promises.rm(path.join(cacheRoot, entry.name), {
                recursive: true,
                force: true,
              })
            )
        )
      )
      .catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[startup] could not prune renderer cache', error);
        }
      });
  }, delay).unref?.();
}

function hasWarmRendererCache(): boolean {
  try {
    const packagedRenderer = path.join(process.resourcesPath, 'renderer');
    const key = fs
      .readFileSync(path.join(packagedRenderer, 'renderer.sha256'), 'utf8')
      .trim();
    return fs.existsSync(
      path.join(
        app.getPath('userData'),
        'renderer-cache',
        distributionIdentity.cacheNamespace,
        key,
        'dist-renderer',
        'server.js'
      )
    );
  } catch {
    return false;
  }
}

async function stopRendererServer(): Promise<void> {
  const server = rendererServer;
  if (!server) return;
  await stopChildProcess(server, {
    forceAfterMs: isTest ? 250 : 1_500,
    failAfterMs: isTest ? 2_000 : 5_000,
    failureMessage: 'Packaged renderer did not stop during shutdown',
  });
  // Clear ownership only after the process is truthfully stopped. A rejection
  // leaves the same handle available to the next shutdown attempt.
  if (rendererServer === server) rendererServer = null;
}

// A cached renderer uses only Node APIs and can boot before Electron's ready
// event, overlapping its server start with Chromium initialization. A cold
// renderer intentionally waits until the launch frame exists so archive I/O
// cannot delay the first visible acknowledgement.
rendererWasWarmAtLaunch = !isDev && hasWarmRendererCache();
if (rendererWasWarmAtLaunch) {
  rendererReadyPromise = startPackagedRenderer();
  // bootstrapCommandSurface awaits and reports this same promise. Attach an
  // early observer so a very fast failure cannot become an unhandled rejection
  // before app.whenReady resolves.
  void rendererReadyPromise.catch(() => {});
}

// Register only when this distribution owns a protocol. Community builds do
// not claim the official URL scheme.
if (protocolScheme) {
  // In dev (process.defaultApp), pass execPath + script so macOS can re-launch correctly.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocolScheme, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(protocolScheme);
  }
}

// macOS: deep links on a running app arrive via open-url.
// Must be registered before app.whenReady() to also catch links during startup.
if (protocolScheme) {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function handleDeepLink(url: string): void {
  if (!protocolScheme || !url.startsWith(`${protocolScheme}://`)) {
    recordAuthDiagnostic('auth.callback.rejected_scheme');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    recordAuthDiagnostic('auth.callback.parse_failure', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // exawatt://auth/callback?code=...  or  ?link=<outcome>
  if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
    const code = parsed.searchParams.get('code');
    const linkOutcome = parsed.searchParams.get('link');
    recordAuthDiagnostic('auth.callback.received', {
      host: parsed.hostname,
      path: parsed.pathname,
      queryNames: [...new Set(parsed.searchParams.keys())].sort(),
      hasCode: Boolean(code),
      codeLength: code?.length ?? 0,
      windowReady: Boolean(mainWindow && !mainWindow.isDestroyed()),
      coordinatorReady: Boolean(authCoordinator),
    });

    if (code) {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        authCoordinator &&
        isWorkspaceTarget(mainWindow.webContents.getURL())
      ) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        void completeElectronAuth(code);
      } else {
        // Window not ready — queue for delivery after load
        pendingDeepLinkUrl = url;
        recordAuthDiagnostic('auth.callback.queued');
      }
    } else if (linkOutcome) {
      // An identity link that Supabase answered without a code — including
      // "already linked", which is the state the operator wanted. The surface
      // that started it owns the verdict, so main only relays the token.
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        isElectronAuthLinkOutcome &&
        isWorkspaceTarget(mainWindow.webContents.getURL())
      ) {
        if (!isElectronAuthLinkOutcome(linkOutcome)) {
          recordAuthDiagnostic('auth.callback.link_outcome_rejected');
          return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('auth:link-outcome', linkOutcome);
        recordAuthDiagnostic('auth.callback.link_outcome_sent', {
          outcome: linkOutcome,
        });
      } else {
        pendingDeepLinkUrl = url;
        recordAuthDiagnostic('auth.callback.queued');
      }
    } else {
      recordAuthDiagnostic('auth.callback.missing_code');
    }
  } else {
    recordAuthDiagnostic('auth.callback.ignored_route', {
      host: parsed.hostname,
      path: parsed.pathname,
    });
  }
}

async function completeElectronAuth(code: string): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  try {
    if (!authCoordinator) throw new Error('Authentication is not ready.');
    await authCoordinator.exchangeCode(code);
    if (!win.isDestroyed()) {
      win.webContents.send('auth:complete');
      recordAuthDiagnostic('auth.renderer_completion_sent');
    } else {
      recordAuthDiagnostic('auth.renderer_completion_skipped_destroyed');
    }
  } catch (error) {
    const safeError = safeElectronAuthError(error);
    recordAuthDiagnostic('auth.completion_failure', { error: safeError });
    console.error('[auth] Electron OAuth code exchange failed', safeError);
    if (!win.isDestroyed()) win.webContents.send('auth:error', safeError);
  }
}

function workspaceUrl(): string {
  return isDev ? DEV_URL : `${rendererOrigin}/workspace`;
}

function isWorkspaceTarget(target: string): boolean {
  try {
    return new URL(target).origin === new URL(workspaceUrl()).origin;
  } catch {
    return false;
  }
}

function updateStartupScreen(stage: StartupStage): void {
  if (!stage.failed && stage.progress < startupStage.progress) return;
  startupStage = stage;
  const win = mainWindow;
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

/** Explicitly visible harness runs open on a NON-primary display when one
 *  exists. Normal automated runs are hidden; this remains useful with
 *  EXAWATT_WINDOW_MODE=inactive|foreground. */
function testWindowPosition(): { x: number; y: number } | undefined {
  if (process.env.EXAWATT_TEST !== '1') return undefined;
  if (process.env.EXAWATT_TEST_SCREEN === 'primary') return undefined;
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

function createWindow(
  initialUrl: string,
  appearance: NativeAppearanceResolution
): void {
  const showAtCreation =
    windowLaunchMode === 'foreground' || inactiveLaunchPromoted;
  mainWindow = new BrowserWindow({
    ...(testWindowPosition() ?? {}),
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
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: productUpdatesEnabled
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
  // Renderer-owned command truth is invalid as soon as a document starts
  // loading or its process is gone. The main-frame navigation boundary below
  // repeats this idempotently alongside checkpoint ownership.
  mainWindow.webContents.on('did-start-loading', resetMenuAvailability);
  mainWindow.webContents.on('render-process-gone', resetMenuAvailability);

  if (!showAtCreation && windowLaunchMode === 'inactive') {
    const inactiveWindow = mainWindow;
    inactiveWindow.once('ready-to-show', () => {
      if (!inactiveWindow.isDestroyed()) inactiveWindow.showInactive();
    });
    inactiveWindow.once('focus', () => {
      inactiveLaunchPromoted = true;
      if (process.platform === 'darwin') app.setActivationPolicy('regular');
    });
  }

  const webContentsId = mainWindow.webContents.id;
  const clearCheckpointOwner = () =>
    workspaceCheckpointOwners.delete(webContentsId);
  mainWindow.webContents.on(
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
  mainWindow.webContents.on(
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
  mainWindow.webContents.on('destroyed', clearCheckpointOwner);

  void mainWindow.loadURL(initialUrl);

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!isWorkspaceTarget(target)) {
      event.preventDefault();
      if (target.startsWith('https://')) void shell.openExternal(target);
    }
  });
  mainWindow.webContents.on('will-attach-webview', event =>
    event.preventDefault()
  );
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  // Deliver any queued deep link once the page is loaded
  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow?.webContents.getURL() ?? '';
    if (currentUrl.startsWith('data:text/html')) {
      updateStartupScreen(startupStage);
    } else if (pendingDeepLinkUrl && isWorkspaceTarget(currentUrl)) {
      handleDeepLink(pendingDeepLinkUrl);
      pendingDeepLinkUrl = null;
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // opt-in only (EXAWATT_DEVTOOLS=1): auto-opened devtools occlude the
  // workspace; toggle manually anytime with Opt+Cmd+I
  if (isDev && process.env.EXAWATT_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    resetMenuAvailability();
    clearCheckpointOwner();
    mainWindow = null;
  });
}

/** Send a named command to the focused renderer. Menu items are the
 *  discoverable, always-current cheat sheet for the app's shortcuts; the
 *  renderer stays the single keyboard authority (rebindable, terminal-focus
 *  aware), so items show their combo with `registerAccelerator: false` and
 *  only ⌘, — a chrome-level macOS invariant — registers for real. */
function sendMenuCommand(command: string): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu:command', command);
}

/** Display accelerators per menu command (D10): seeded from the command-verb
 *  manifest's own bindings, overwritten when the renderer syncs the registry's
 *  effective bindings — a rebind updates what the menus show instead of
 *  letting them lie. An empty string clears the column (e.g. a verb rebound
 *  to a chord). */
const menuAccelerators: Record<string, string> = defaultMenuAccelerators();

/** Renderer-owned context projected into native menu enablement. Commands
 *  start unavailable until the restored workspace publishes real targets;
 *  which commands those are is a manifest fact, not a list kept by hand. */
const menuAvailability: Record<string, boolean> = Object.fromEntries(
  availabilityMenuCommands().map(command => [command, false])
);

function resetMenuAvailability(): void {
  let changed = false;
  for (const command of Object.keys(menuAvailability)) {
    if (menuAvailability[command]) {
      menuAvailability[command] = false;
      changed = true;
    }
  }
  if (changed) createMenu();
}

let feedbackAuthenticated = false;

const ACCELERATOR_PATTERN =
  /^((Command|Control|Alt|Shift)\+)*([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|[\[\]\\;',./`=-]|Enter|Escape|Tab|Space|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown)$/;

function registerMenuIPC(): void {
  handleTrusted('menu:sync-accelerators', async (_event, map: unknown) => {
    if (!map || typeof map !== 'object') return;
    for (const [command, value] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(menuAccelerators, command))
        continue;
      if (value === '') {
        menuAccelerators[command] = '';
      } else if (typeof value === 'string' && ACCELERATOR_PATTERN.test(value)) {
        menuAccelerators[command] = value;
      }
    }
    createMenu();
  });
  handleTrusted('menu:sync-availability', async (_event, map: unknown) => {
    if (!map || typeof map !== 'object') return;
    let changed = false;
    for (const [command, value] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(menuAvailability, command)) {
        continue;
      }
      if (typeof value !== 'boolean') continue;
      if (menuAvailability[command] !== value) {
        menuAvailability[command] = value;
        changed = true;
      }
    }
    if (changed) createMenu();
  });
  handleTrusted(
    'feedback:set-authenticated',
    async (_event, value: boolean) => {
      if (typeof value !== 'boolean') throw new Error('Invalid auth state');
      if (feedbackAuthenticated === value) return;
      feedbackAuthenticated = value;
      createMenu();
    }
  );
  handleTrusted('feedback:capture-screenshot', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error('Window unavailable');
    const image = await win.capturePage();
    const size = image.getSize();
    const bounded =
      size.width > 1600
        ? image.resize({
            width: 1600,
            height: Math.max(1, Math.round((size.height * 1600) / size.width)),
            quality: 'better',
          })
        : image;
    return `data:image/jpeg;base64,${bounded.toJPEG(78).toString('base64')}`;
  });
}

function createMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate({
        appName: app.name,
        version: app.getVersion(),
        buildSha: buildInfo.sha.slice(0, 12),
        isDev,
        feedbackAuthenticated,
        accelerators: menuAccelerators,
        availability: menuAvailability,
        onCommand: sendMenuCommand,
        onCheckForUpdates: productUpdatesEnabled
          ? () => void checkForUpdatesFromMenu()
          : undefined,
        onWindowManagementHelp: () => void promptWindowManagementRestart(),
      })
    )
  );
}

function registerAuthIPC(): void {
  handleTrusted(
    'auth:start-google',
    async (_event, config: ElectronAuthStartConfig) => {
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      try {
        await authCoordinator.startGoogle(config);
      } catch (error) {
        recordAuthDiagnostic('auth.start_ipc_failure', {
          error: safeElectronAuthError(error),
        });
        throw error;
      }
    }
  );
  handleTrusted(
    'auth:link-github',
    async (_event, config: ElectronAuthLinkConfig) => {
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      try {
        await authCoordinator.linkGithub(config);
      } catch (error) {
        recordAuthDiagnostic('auth.link_github_ipc_failure', {
          error: safeElectronAuthError(error),
        });
        throw error;
      }
    }
  );
  handleTrusted(
    'auth:install-test-session',
    async (
      _event,
      config: Pick<ElectronAuthStartConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
      tokens: { accessToken: string; refreshToken: string }
    ) => {
      if (
        process.env.EXAWATT_TEST !== '1' ||
        process.env.EXAWATT_TEST_AUTH !== '1'
      ) {
        throw new Error('Test authentication is disabled.');
      }
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      await authCoordinator.installSession(config, tokens);
    }
  );
}

/** Native "Open project directory" picker (ENG-015 S5 P4) — lets the operator
 *  browse to a project instead of typing a path. Returns the chosen absolute
 *  path, or null if cancelled. */
function registerDialogIPC(): void {
  handleTrusted(
    'dialog:openDirectory',
    async (event, requestedTitle?: string) => {
      // test hook: skip the native modal (which automation can't drive) and
      // return a fixed directory, so ⌘N / Browse can be exercised end-to-end.
      // Double-gated (like the userData redirect) so a stray env var in a normal
      // launch can never silently replace the real folder picker.
      if (process.env.EXAWATT_TEST && process.env.EXAWATT_TEST_DIR) {
        return process.env.EXAWATT_TEST_DIR;
      }
      return openDirectoryPicker(
        BrowserWindow.fromWebContents(event.sender),
        requestedTitle
      );
    }
  );
  // does a path exist on THIS machine? — detects a synced Project whose
  // directory is absent here (ENG-015 S5 P5 "locate on this machine")
  handleTrusted('dialog:pathExists', (_event, p: string) => {
    try {
      return typeof p === 'string' && p.length > 0 && fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function registerAppIPC(): void {
  // Preload executes before the document's inline first-paint script. A tiny
  // synchronous read is intentional here: it lets Electron's durable settings,
  // including one-launch safe mode, win before any renderer pixels are chosen.
  ipcMain.on('app:appearance-bootstrap', event => {
    // Unlike handleTrusted (ipcMain.handle), Electron does not catch a throw
    // from a plain ipcMain.on listener — it becomes an uncaught main-process
    // exception and surfaces as the native crash dialog. A rejected sender
    // here (e.g. querying event.senderFrame mid-navigation) must fail closed
    // into the renderer's existing first-paint recovery theme instead.
    try {
      assertTrustedIpcSender(event);
    } catch {
      event.returnValue = undefined;
      return;
    }
    event.returnValue = rendererAppearanceBootstrapSnapshot(
      loadSettings().appearance,
      safeThemeLaunch,
      nativeTheme.shouldUseDarkColors
    );
  });
  handleTrusted('app:get-build-info', () => ({
    ...buildInfo,
    // marketed version alongside the exact sha (ENG-025 feedback stamping)
    version: app.getVersion(),
    distribution: {
      contract: distribution.contract,
      digest: distribution.digest,
      identity: distributionIdentity,
      capabilities: distributionIpcCapabilities(distribution.contract),
    },
  }));
  // ENG-025 F5. `signedIn` is renderer-supplied because the Supabase session
  // lives there; it is a self-report in a self-reported bundle, not a claim
  // main can make on its own.
  handleTrusted('app:get-diagnostics-report', (_event, signedIn?: boolean) =>
    collectDiagnosticsReport(Boolean(signedIn))
  );
  handleTrusted(
    'app:save-diagnostics-report',
    async (_event, signedIn?: boolean) =>
      saveDiagnosticsReport(Boolean(signedIn))
  );
  // Optional ENG-032 action overlay input: '#RRGGBB' or null off-macOS.
  // The selected theme remains the default and Project identity stays separate.
  const systemAccentColor = () => {
    try {
      const accent = systemPreferences.getAccentColor?.();
      return accent ? `#${accent.slice(0, 6)}` : null;
    } catch {
      return null;
    }
  };
  const appearanceSnapshot = () => ({
    dark: nativeTheme.shouldUseDarkColors,
    highContrast: nativeTheme.shouldUseHighContrastColors,
    invertedColors: nativeTheme.shouldUseInvertedColorScheme,
    systemAccent: systemAccentColor(),
    safeTheme: safeThemeLaunch,
  });
  handleTrusted('app:accent-color', systemAccentColor);
  handleTrusted('app:appearance', appearanceSnapshot);
  nativeTheme.on('updated', () => {
    refreshNativeWindowBackgrounds(
      loadSettings().appearance,
      nativeTheme,
      BrowserWindow.getAllWindows(),
      { safeTheme: safeThemeLaunch }
    );
    const snapshot = appearanceSnapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('app:appearance-changed', snapshot);
      }
    }
  });
  handleTrusted(
    'app:set-workspace-checkpoint-owner',
    (event, ownsWorkspaceState: boolean) => {
      if (typeof ownsWorkspaceState !== 'boolean') return;
      if (ownsWorkspaceState) workspaceCheckpointOwners.add(event.sender.id);
      else workspaceCheckpointOwners.delete(event.sender.id);
    }
  );
  handleTrusted(
    'app:complete-checkpoint',
    (_event, requestId: string, ok: boolean) => {
      if (typeof requestId !== 'string' || typeof ok !== 'boolean') return;
      const complete = pendingCheckpoints.get(requestId);
      if (!complete) return;
      pendingCheckpoints.delete(requestId);
      complete(ok);
    }
  );
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
  const copy = shutdownCopy(intent, counts);
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: copy.title,
    message: copy.title,
    detail:
      intent === 'update'
        ? `${copy.detail} The downloaded update will then install and reopen Exawatt.`
        : intent === 'restart'
          ? `${copy.detail} Exawatt reopens automatically.`
          : copy.detail,
    buttons: [
      'Cancel',
      intent === 'quit' ? 'Quit and Stop' : 'Restart and Stop',
    ],
    cancelId: 0,
    noLink: true,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
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
    detail:
      'After Exawatt has been open a long time, macOS can stop sharing its window with tools like Divvy, Rectangle, and Hammerspoon, so their shortcuts do nothing and you hear an error sound. This is a known macOS issue with Electron apps that Exawatt cannot detect or repair on its own.\n\nRestarting fixes it. Projects, Sessions, and terminal history are saved and restored; running agents stop and can be resumed afterwards.',
    buttons: ['Cancel', 'Restart Exawatt'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
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
    title: "Exawatt couldn't save the latest Session state",
    message: "Exawatt couldn't save the latest Session state",
    detail:
      'Quitting now may lose recent layout changes. Terminal history already checkpointed by the main process will remain.',
    buttons: ['Cancel', intent === 'quit' ? 'Quit Anyway' : 'Restart Anyway'],
    cancelId: 0,
    noLink: true,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
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
  const win = mainWindow;
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
  await stopRendererServer();
  fs.unwatchFile(path.join(app.getPath('userData'), 'update-state.json'));
}

async function reportShutdownFailure(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  const options: Electron.MessageBoxOptions = {
    type: 'error',
    title: "Exawatt couldn't stop every Session",
    message: "Exawatt couldn't stop every Session",
    detail: `${detail.slice(0, 400)}\n\nExawatt will remain open. Check the affected Session before quitting again.`,
    buttons: ['OK'],
    noLink: true,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

async function bootstrapCommandSurface(): Promise<void> {
  const rendererReady = (
    isDev
      ? Promise.resolve(DEV_URL)
      : (rendererReadyPromise ??= startPackagedRenderer())
  ).then(url => {
    // The trusted origin is established by the step that establishes the
    // origin. It used to be set at the tail of bootstrap, which meant the
    // engine-state channel — the one surface whose whole job is to report a
    // failed bootstrap — would have rejected its own renderer (BUG-016).
    setTrustedRendererOrigin(url);
    updateStartupScreen({
      progress: 0.62,
      label: 'Renderer online',
      detail: 'Local command surface is accepting connections',
    });
    return url;
  });

  const runtimeReady = Promise.all([
    import('./agent-ipc'),
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
    import('./openclaw-gateway-ipc'),
  ]).then(
    ([
      agentIpc,
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
      openClawGatewayIpc,
    ]) => {
      updateStartupScreen({
        progress: 0.36,
        label: 'Command engine loaded',
        detail: 'Agent and Session services are initializing',
      });
      return {
        agentIpc,
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
        openClawGatewayIpc,
      };
    }
  );

  const [trustedRendererUrl, runtime] = await Promise.all([
    rendererReady,
    runtimeReady,
  ]);
  ptySessions = runtime.sessionManager.ptySessions;
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
  updateStartupScreen({
    progress: 0.78,
    label: 'Session index restored',
    detail: 'Durable local state is ready',
  });

  runtime.agentIpc.registerAgentIPC();
  runtime.agentSourcesIpc.registerAgentSourcesIPC();
  runtime.openClawGatewayIpc.registerOpenClawGatewayIPC();
  runtime.ptyIpc.registerPtyIPC(
    distribution.contract,
    recovery.previousRunInterrupted
  );
  runtime.roadmapIpc.registerRoadmapIPC();
  runtime.projectIpc.registerProjectIPC();
  registerAuthIPC();
  registerDialogIPC();
  registerAppIPC();
  registerMenuIPC();
  registerSystemShortcutIPC();
  const operatorProfile = loadSettings().operatorProfile;
  consumptionScanner = new ConsumptionScannerService({
    stateDir: path.join(app.getPath('userData'), 'consumption-scan'),
    identities: () => ptySessions.listProviderIdentities(),
    // BUG-032: samples are a bounded collection now. The floor is the default
    // horizon; an ACTIVE Operator-profile publication widens it, because that
    // sync rescans everything since its opt-in anchor and replaces the hosted
    // aggregate wholesale — pruning under it would truncate a published
    // profile. `resolveSampleHorizonMs` clamps both ends.
    sampleHorizonMs: resolveSampleHorizonMs(
      operatorProfile?.autoPublish ? operatorProfile.startedAt : null,
      Date.now()
    ),
  });
  registerOperatorStatsIPC(consumptionScanner);
  // ENG-038: the credentialed Claude plan-account read — a SIBLING of the
  // scanner (the local parse stays credential- and network-free), merged
  // behind the same IPC seam by the composite.
  claudePlanAccount = new ClaudePlanAccountService({
    stateDir: path.join(app.getPath('userData'), 'consumption-plan'),
    enabled: isClaudePlanWindowsEnabled(loadSettings()),
    // Chromium owns the request in installed builds, so Little Snitch sees
    // Exawatt's stable Developer ID instead of Node or an ad-hoc Electron
    // helper. Routine unpackaged and automated test launches stay local; the
    // narrow override deliberately exercises this exact account integration.
    remoteReadAllowed: isClaudePlanRemoteReadAllowed({
      packaged: app.isPackaged,
      testMode: isTest,
      developmentOptIn: process.env.EXAWATT_DEV_CLAUDE_PLAN_NETWORK,
    }),
    fetchFn: electronNetworkFetch,
  });
  registerConsumptionIPC(
    () => BrowserWindow.getAllWindows(),
    new ProviderPlanCompositeSource(consumptionScanner, claudePlanAccount),
    claudePlanAccount
  );
  registerAnalyticsIPC();
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
      () => ptySessions.list().filter(session => !session.exited).length,
      () => shutdownCoordinator!.request('update')
    );
  }
  createMenu();
  updateStartupScreen({
    progress: 0.94,
    label: 'Entering workspace',
    detail: 'Command services are ready',
  });

  setCommandEnginePhase('ready');

  const win = mainWindow;
  if (win && !win.isDestroyed()) await win.loadURL(workspaceUrl());
  startupComplete = true;
  watchInstalledBuild();
  if (productUpdatesEnabled) {
    runtime.updater.startProductUpdater(buildInfo.delivery === 'signed');
  }
  if (!isDev) pruneRendererCache();
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
  const mainDiagnostics = createMainDiagnostics();
  // Standing main-thread instrumentation: the next beachball records itself.
  // Started before the window so a stall during startup is captured too.
  installMainThreadStallTrace(
    new MainThreadStallTrace({ record: mainDiagnostics })
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
  createWindow(launchScreenUrl(appearance.bootstrap), appearance);
  commandSurface ??= bootstrapCommandSurface();

  app.on('activate', () => {
    if (shutdownCoordinator?.phase !== 'idle') return;
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextAppearance = applyNativeAppearance();
      createWindow(
        startupComplete
          ? workspaceUrl()
          : launchScreenUrl(nextAppearance.bootstrap),
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
    updateStartupScreen({
      progress: startupStage.progress,
      label: 'Command engine paused',
      detail: 'Exawatt could not start its local command services',
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
    void stopRendererServer()
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
