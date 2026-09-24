import type { Cookies } from 'electron';
import path from 'path';
import type { DistributionContractV2 } from '@exawatt/core/distribution';
import { registerAnalyticsIPC } from './analytics-ipc';
import { createElectronAuthCookies } from './auth-cookies';
import type { ElectronAuthCoordinator } from './auth-coordinator';
import type { AuthDiagnosticRecorder } from './auth-diagnostics';
import type { CommandEnginePhase } from './command-engine';
import {
  ClaudePlanAccountService,
  isClaudePlanRemoteReadAllowed,
} from './consumption/claude-plan-account';
import { ProviderPlanCompositeSource } from './consumption/provider-plan-composite';
import { sampleRetentionPolicy } from './consumption/retention-policy';
import { ConsumptionScannerService } from './consumption/scanner-service';
import { registerConsumptionIPC } from './consumption-ipc';
import type { DiagnosticRecorder } from './diagnostics-log';
import { watchInstalledBuild } from './installed-build';
import { registerIpcModules } from './ipc-table';
import type { StartupStage } from './launch-screen';
import { registerOperatorStatsIPC } from './operator-stats-ipc';
import type { PtySessionManager } from './pty/session-manager';
import type { RunStateStore } from './run-state';
import { isClaudePlanWindowsEnabled, loadSettings } from './settings-store';
import type { ShutdownCoordinator } from './shutdown-coordinator';
import type { ShutdownSequence } from './shutdown-sequence';
import { registerSystemShortcutIPC } from './system-shortcuts';

/**
 * The command surface: everything behind the launch frame. Bootstrap loads the
 * Session, auth, updater and roadmap runtime, builds the services they need,
 * registers every IPC module in one ordered table, constructs the shutdown
 * coordinator, and moves the window from the launch document to the
 * workspace.
 *
 * What the rest of main needs from that runtime lives on `CommandRuntime`,
 * which starts empty and is filled here. Every reader treats an empty field as
 * "not started yet", the same way the module globals it replaces did.
 */

interface SafeAuthError {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

export class CommandRuntime {
  ptySessions: PtySessionManager | null = null;
  shutdownCoordinator: ShutdownCoordinator | null = null;
  consumptionScanner: ConsumptionScannerService | null = null;
  claudePlanAccount: ClaudePlanAccountService | null = null;
  runStateStore: RunStateStore | null = null;
  authCoordinator: ElectronAuthCoordinator | null = null;
  recordAuthDiagnostic: AuthDiagnosticRecorder = () => {};
  safeAuthError: (error: unknown) => SafeAuthError = error => ({
    name: 'Error',
    message: error instanceof Error ? error.message : 'Authentication failed.',
  });
  /**
   * Any local process can invoke `exawatt://`, so a link outcome is forwarded
   * to the renderer only after it is recognized. Null until the auth runtime
   * loads, which makes an early deep link queue rather than arrive unvetted.
   */
  isLinkOutcome: ((value: unknown) => boolean) | null = null;
  disposePty: () => Promise<void> = async () => {};
  disposeRoadmapWatchers: () => void = () => {};
  installProductUpdate: () => void = () => {
    throw new Error('Product updates are not ready.');
  };
  checkForUpdatesFromMenu: () => Promise<void> = async () => {};
  /** Null until the updater runtime loads; the report says so rather than
   *  inventing an idle status (ENG-025 F5). */
  currentUpdateStatus: () => Record<string, unknown> | null = () => null;
  /** The workspace has been loaded once, so a new window opens straight to it. */
  startupComplete = false;
  installedBuildWatch: { stop(): void } | null = null;

  /**
   * Abort any in-flight background scan and settle its state writes. The
   * store is crash-safe (append-ordered, atomic meta), so this is a courtesy
   * flush, never a correctness requirement — it must not delay quit.
   */
  disposeServices(): void {
    void this.consumptionScanner?.dispose();
    this.claudePlanAccount?.dispose();
  }

  liveSessionCount(): number {
    return this.ptySessions
      ? this.ptySessions.list().filter(session => !session.exited).length
      : 0;
  }
}

/** The modules bootstrap loads lazily, so the launch frame never waits on them. */
async function loadCommandRuntimeModules() {
  const [
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
  ] = await Promise.all([
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
  ]);
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

type CommandRuntimeModules = Awaited<
  ReturnType<typeof loadCommandRuntimeModules>
>;

interface CommandSurfaceDependencies {
  runtime: CommandRuntime;
  isDev: boolean;
  isTest: boolean;
  env: NodeJS.ProcessEnv;
  build: {
    buildInfo: { sha: string; branch: string; delivery: 'dogfood' | 'signed' };
    distribution: { contract: DistributionContractV2 };
    identity: { productName: string };
  };
  /** The renderer origin: the dev server, or the packaged server once serving. */
  rendererReady: () => Promise<string>;
  pruneRendererCache: () => void;
  setTrustedRendererOrigin: (url: string) => void;
  startupScreen: { update(stage: StartupStage): void };
  electron: {
    app: {
      getVersion(): string;
      readonly isPackaged: boolean;
      getPath(name: 'userData'): string;
    };
    net: Pick<Electron.Net, 'fetch'>;
    session: {
      defaultSession: { cookies: Pick<Cookies, 'get' | 'set' | 'remove'> };
    };
    shell: { openExternal(url: string): Promise<void> };
    BrowserWindow: { getAllWindows(): Electron.BrowserWindow[] };
  };
  /** Main's own channel tables (`app-ipc.ts`, the menu, checkpoints). */
  registerMainChannels: () => void;
  shutdownSequence: ShutdownSequence;
  rebuildMenu: () => void;
  mainDiagnostics: DiagnosticRecorder;
  setEnginePhase: (phase: CommandEnginePhase) => void;
  /** Navigates the main window to the workspace, if it still exists. */
  enterWorkspace: () => Promise<void>;
  loadRuntime?: () => Promise<CommandRuntimeModules>;
}

export async function bootstrapCommandSurface(
  deps: CommandSurfaceDependencies
): Promise<void> {
  const { runtime, startupScreen } = deps;
  const { app } = deps.electron;
  const userDataPath = () => app.getPath('userData');
  const buildInfo = deps.build.buildInfo;
  const distribution = deps.build.distribution.contract;
  /** Null when the distribution declares no update feed. */
  const productUpdateFeedUrl = distribution.updates?.feedUrl ?? null;
  const rendererReady = deps.rendererReady().then(url => {
    // The trusted origin is established by the step that establishes the
    // origin. It used to be set at the tail of bootstrap, which meant the
    // engine-state channel — the one surface whose whole job is to report a
    // failed bootstrap — would have rejected its own renderer (BUG-016).
    deps.setTrustedRendererOrigin(url);
    startupScreen.update({
      progress: 0.62,
      label: 'Renderer online',
      detail: 'Local command surface is accepting connections',
    });
    return url;
  });

  const runtimeReady = (deps.loadRuntime ?? loadCommandRuntimeModules)().then(
    modules => {
      startupScreen.update({
        progress: 0.36,
        label: 'Command engine loaded',
        detail: 'Agent and Session services are initializing',
      });
      return modules;
    }
  );

  const [trustedRendererUrl, modules] = await Promise.all([
    rendererReady,
    runtimeReady,
  ]);
  const ptySessions = modules.sessionManager.ptySessions;
  runtime.ptySessions = ptySessions;
  ptySessions.setProductName(deps.build.identity.productName);
  runtime.disposePty = modules.ptyIpc.disposePty;
  runtime.disposeRoadmapWatchers =
    modules.roadmapWatcher.disposeRoadmapWatchers;
  if (productUpdateFeedUrl !== null) {
    runtime.installProductUpdate = modules.updater.installProductUpdate;
    runtime.checkForUpdatesFromMenu = modules.updater.checkForUpdatesFromMenu;
    runtime.currentUpdateStatus = () => ({
      ...modules.updater.currentUpdateStatus(),
    });
  }
  runtime.safeAuthError = modules.auth.safeElectronAuthError;
  runtime.isLinkOutcome = modules.auth.isElectronAuthLinkOutcome;

  const authLogPath = path.join(userDataPath(), 'logs', 'auth.jsonl');
  const recordAuthDiagnostic =
    modules.authDiagnostics.createPersistentAuthDiagnostics({
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
  runtime.recordAuthDiagnostic = recordAuthDiagnostic;
  recordAuthDiagnostic('auth.runtime.ready', {
    transport: 'electron.net.fetch',
    logPath: authLogPath,
  });

  // Chromium's network stack, not Node's: the account and plan reads leave
  // from the app's own signed identity (see the plan-account note below).
  const electronNetworkFetch: typeof fetch = (input, init) =>
    deps.electron.net.fetch(
      input instanceof URL ? input.toString() : input,
      init
    );
  const authFetch = modules.authDiagnostics.instrumentAuthFetch(
    electronNetworkFetch,
    recordAuthDiagnostic,
    'electron.net.fetch'
  );

  runtime.authCoordinator = new modules.auth.ElectronAuthCoordinator({
    expectedRendererOrigin: trustedRendererUrl,
    openExternal: url => deps.electron.shell.openExternal(url),
    cookies: createElectronAuthCookies(
      deps.electron.session.defaultSession.cookies,
      trustedRendererUrl,
      recordAuthDiagnostic
    ),
    fetch: authFetch,
    recordDiagnostic: recordAuthDiagnostic,
  });
  const runStateStore = new modules.runState.RunStateStore(
    path.join(userDataPath(), 'run-state.json')
  );
  runtime.runStateStore = runStateStore;
  const [, recovery] = await Promise.all([
    ptySessions.configurePersistence(path.join(userDataPath(), 'sessions')),
    runStateStore.begin(),
  ]);
  startupScreen.update({
    progress: 0.78,
    label: 'Session index restored',
    detail: 'Durable local state is ready',
  });

  // Registration is data: one row per module that owns channels, in the order
  // they must exist. Adding a module's channels is a row here; adding one of
  // main's own channels is an entry in its table (`ipc-table.ts`). The two
  // consumption rows construct their services where the channels need them,
  // so a constructor that throws leaves every earlier row registered.
  registerIpcModules([
    {
      id: 'agent-sources',
      register: () => modules.agentSourcesIpc.registerAgentSourcesIPC(),
    },
    {
      id: 'connected-sources',
      register: () => modules.connectedSourcesIpc.registerConnectedSourcesIPC(),
    },
    {
      id: 'pty',
      register: () =>
        modules.ptyIpc.registerPtyIPC(
          distribution,
          recovery.previousRunInterrupted,
          deps.mainDiagnostics
        ),
    },
    { id: 'roadmap', register: () => modules.roadmapIpc.registerRoadmapIPC() },
    { id: 'projects', register: () => modules.projectIpc.registerProjectIPC() },
    { id: 'main', register: deps.registerMainChannels },
    { id: 'system-shortcuts', register: registerSystemShortcutIPC },
    {
      id: 'operator-stats',
      register: () => {
        runtime.consumptionScanner = new ConsumptionScannerService({
          stateDir: path.join(userDataPath(), 'consumption-scan'),
          identities: () => ptySessions.listProviderIdentities(),
          // BUG-032: samples are a bounded collection. The default horizon is
          // 14 days; an ACTIVE Operator-profile publication widens it to its
          // opt-in anchor, so a republish (a new Run derivation, a long outage)
          // can still cover everything since consent. Publication can no
          // longer be HARMED by a narrower horizon — it never claims dates at
          // or before the prune line (BUG-164) — but it can only republish
          // what is retained. The read is LIVE, not a boot-time snapshot: the
          // anchor is written by the renderer's first sync minutes from now
          // (BUG-141). `sampleRetentionPolicy` is the one owner both hydrate
          // and compaction consult.
          sampleHorizonMs: sampleRetentionPolicy(),
        });
        registerOperatorStatsIPC(
          runtime.consumptionScanner,
          deps.mainDiagnostics
        );
      },
    },
    {
      id: 'consumption',
      register: () => {
        // ENG-038: the credentialed Claude plan-account read — a SIBLING of
        // the scanner (the local parse stays credential- and network-free),
        // merged behind the same IPC seam by the composite.
        const claudePlanAccount = new ClaudePlanAccountService({
          stateDir: path.join(userDataPath(), 'consumption-plan'),
          enabled: isClaudePlanWindowsEnabled(loadSettings()),
          // Chromium owns the request in installed builds, so Little Snitch
          // sees a stable Developer ID instead of Node or an ad-hoc Electron
          // helper. WHICH builds those are is the distribution's declaration,
          // not `app.isPackaged` — an ad-hoc community package is packaged
          // too (BUG-060, decision `0036` §6). Routine unpackaged and
          // automated test launches stay local; the narrow override
          // deliberately exercises this exact account integration.
          remoteReadAllowed: isClaudePlanRemoteReadAllowed({
            stableSignedIdentity:
              distribution.ownAccount?.claudePlanUsage === 'stable-signed',
            packaged: app.isPackaged,
            testMode: deps.isTest,
            developmentOptIn: deps.env.EXAWATT_DEV_CLAUDE_PLAN_NETWORK,
          }),
          fetchFn: electronNetworkFetch,
        });
        runtime.claudePlanAccount = claudePlanAccount;
        registerConsumptionIPC(
          () => deps.electron.BrowserWindow.getAllWindows(),
          new ProviderPlanCompositeSource(
            runtime.consumptionScanner!,
            claudePlanAccount
          ),
          claudePlanAccount
        );
      },
    },
    { id: 'analytics', register: registerAnalyticsIPC },
  ]);
  const shutdownCoordinator = new modules.shutdown.ShutdownCoordinator(
    deps.shutdownSequence.coordinatorDependencies({
      sessions: ptySessions,
      shutdownCopy: modules.shutdown.shutdownCopy,
      markClean: () => runtime.runStateStore?.markClean() ?? Promise.resolve(),
    })
  );
  runtime.shutdownCoordinator = shutdownCoordinator;
  if (productUpdateFeedUrl !== null) {
    modules.updater.registerProductUpdater(
      productUpdateFeedUrl,
      () => runtime.liveSessionCount(),
      () => shutdownCoordinator.request('update')
    );
  }
  deps.rebuildMenu();
  startupScreen.update({
    progress: 0.94,
    label: 'Entering workspace',
    detail: 'Command services are ready',
  });

  deps.setEnginePhase('ready');

  await deps.enterWorkspace();
  runtime.startupComplete = true;
  runtime.installedBuildWatch = watchInstalledBuild({
    statePath: path.join(userDataPath(), 'update-state.json'),
    currentSha: buildInfo.sha,
    allWindows: () => deps.electron.BrowserWindow.getAllWindows(),
  });
  if (productUpdateFeedUrl !== null) {
    modules.updater.startProductUpdater(buildInfo.delivery === 'signed');
  }
  if (!deps.isDev) deps.pruneRendererCache();
}

/**
 * Says a failed bootstrap on the splash AND on the wire. Without the second
 * half, a renderer that reaches a product surface anyway shows a complete,
 * zeroed local read (BUG-016).
 */
export function reportCommandSurfaceFailure(
  error: unknown,
  deps: {
    productName: string;
    setEnginePhase: (phase: CommandEnginePhase) => void;
    startupScreen: {
      stage(): StartupStage;
      update(stage: StartupStage): void;
    };
    logError?: (message: string, error: unknown) => void;
  }
): void {
  (deps.logError ?? ((message, cause) => console.error(message, cause)))(
    '[startup] command surface failed',
    error
  );
  deps.setEnginePhase('paused');
  deps.startupScreen.update({
    progress: deps.startupScreen.stage().progress,
    label: 'Command engine paused',
    detail: `${deps.productName} could not start its local command services`,
    failed: true,
  });
}
