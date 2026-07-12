import { app, BrowserWindow, shell, Menu, dialog } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import net from 'net';
import http from 'http';
import path from 'path';
import { registerAgentIPC } from './agent-ipc';
import { registerPtyIPC, disposePty } from './pty-ipc';
import { registerRoadmapIPC } from './roadmap/roadmap-ipc';
import { disposeRoadmapWatchers } from './roadmap/roadmap-watcher';
import { handleTrusted, setTrustedRendererOrigin } from './ipc-security';
import { ptySessions } from './pty/session-manager';
import {
  installProductUpdate,
  registerProductUpdater,
  startProductUpdater,
} from './updater';
import {
  ShutdownCoordinator,
  shutdownCopy,
  type ShutdownIntent,
  type ShutdownPhase,
} from './shutdown-coordinator';
import { RunStateStore } from './run-state';
import { randomUUID } from 'crypto';

const isDev = process.env.NODE_ENV === 'development';
const execFileAsync = promisify(execFile);

// hermetic test runs: isolated userData so smoke tests never touch the
// operator's real workspace layout. Gated on EXAWATT_TEST so a stray env
// var in a normal launch can never silently redirect real layout data.
if (process.env.EXAWATT_TEST && process.env.EXAWATT_USER_DATA) {
  app.setPath('userData', process.env.EXAWATT_USER_DATA);
}
// EXAWATT_DEV_URL lets harnesses point the shell at a different dev server
const DEV_URL = process.env.EXAWATT_DEV_URL || 'http://localhost:7000';
const PROTOCOL = 'exawatt';
const testQuitResponses =
  process.env.EXAWATT_TEST === '1'
    ? (process.env.EXAWATT_TEST_QUIT_RESPONSES ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    : [];

let mainWindow: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = null;
let rendererServer: ChildProcess | null = null;
let rendererOrigin: string | null = null;
let shutdownCoordinator: ShutdownCoordinator | null = null;
let runStateStore: RunStateStore | null = null;
const pendingCheckpoints = new Map<string, (ok: boolean) => void>();
const workspaceCheckpointOwners = new Set<number>();

interface BuildInfo {
  sha: string;
  branch: string;
  builtAt: string;
  delivery: 'dogfood' | 'signed';
}

const buildInfo: BuildInfo = isDev
  ? {
      sha: 'development',
      branch: 'development',
      builtAt: new Date().toISOString(),
      delivery: 'dogfood',
    }
  : JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf8')
    );

async function availableLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
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
    await new Promise(resolve => setTimeout(resolve, 150));
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
  const cacheRoot = path.join(app.getPath('userData'), 'renderer-cache');
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
      ...process.env,
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

// Register as protocol handler before app is ready.
// In dev (process.defaultApp), pass execPath + script so macOS can re-launch correctly.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// macOS: deep links on a running app arrive via open-url.
// Must be registered before app.whenReady() to also catch links during startup.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  // exawatt://auth/callback?code=...
  if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
    const code = parsed.searchParams.get('code');

    if (code) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:deeplink-code', code);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      } else {
        // Window not ready — queue for delivery after load
        pendingDeepLinkUrl = url;
      }
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const webContentsId = mainWindow.webContents.id;
  const clearCheckpointOwner = () =>
    workspaceCheckpointOwners.delete(webContentsId);
  mainWindow.webContents.on(
    'did-start-navigation',
    (_event, _target, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) clearCheckpointOwner();
    }
  );
  mainWindow.webContents.on('destroyed', clearCheckpointOwner);

  // Development uses the explicit dev server. Production uses renderer code
  // packaged in this exact app build; remote web code never receives PTY APIs.
  const url = isDev ? DEV_URL : `${rendererOrigin}/workspace`;
  mainWindow.loadURL(url);

  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowedOrigin = new URL(url).origin;
    if (new URL(target).origin !== allowedOrigin) {
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
    if (pendingDeepLinkUrl) {
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

/** Display accelerators per menu command (D10): seeded with the defaults,
 *  overwritten when the renderer syncs the registry's effective bindings —
 *  a rebind updates what the menus show instead of letting them lie. An
 *  empty string clears the column (e.g. a verb rebound to a chord). */
const menuAccelerators: Record<string, string> = {
  'command-palette': 'Command+K',
  'go-terminal': 'Command+1',
  'go-sessions': 'Command+2',
  'go-spatial': 'Command+3',
  'history-back': 'Command+[',
  'history-forward': 'Command+]',
  'launch-shell': 'Command+T',
  'rename-tab': 'Command+E',
  'toggle-split': 'Command+D',
  'close-tab': 'Command+W',
  'jump-attention': 'Command+J',
};

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
}

function menuCommand(
  label: string,
  command: string,
  registerAccelerator = false
): Electron.MenuItemConstructorOptions {
  const accelerator =
    command === 'open-settings' ? 'Command+,' : menuAccelerators[command];
  return {
    label,
    ...(accelerator ? { accelerator, registerAccelerator } : {}),
    click: () => sendMenuCommand(command),
  };
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: `Build ${buildInfo.sha.slice(0, 12)}`, enabled: false },
        { type: 'separator' },
        menuCommand('Settings…', 'open-settings', true),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev
          ? [
              { type: 'separator' as const },
              { role: 'toggleDevTools' as const },
            ]
          : []),
      ],
    },
    {
      label: 'Go',
      submenu: [
        menuCommand('Command Palette…', 'command-palette'),
        { type: 'separator' },
        menuCommand('Terminal', 'go-terminal'),
        menuCommand('Sessions', 'go-sessions'),
        menuCommand('Spatial', 'go-spatial'),
        { type: 'separator' },
        menuCommand('Back', 'history-back'),
        menuCommand('Forward', 'history-forward'),
      ],
    },
    {
      label: 'Session',
      submenu: [
        menuCommand('New Claude Code Session', 'launch-claude'),
        menuCommand('New Codex Session', 'launch-codex'),
        menuCommand('New Shell Session', 'launch-shell'),
        { type: 'separator' },
        menuCommand('Rename Session', 'rename-tab'),
        menuCommand('Split: Pin / Unpin', 'toggle-split'),
        menuCommand('Close Tab', 'close-tab'),
        { type: 'separator' },
        menuCommand('Jump to Session Needing You', 'jump-attention'),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerAuthIPC(): void {
  handleTrusted('auth:open-external', async (_event, url: string) => {
    if (url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });
}

/** Native "Open project directory" picker (ENG-015 S5 P4) — lets the operator
 *  browse to a project instead of typing a path. Returns the chosen absolute
 *  path, or null if cancelled. */
function registerDialogIPC(): void {
  handleTrusted('dialog:openDirectory', async () => {
    // test hook: skip the native modal (which automation can't drive) and
    // return a fixed directory, so ⌘N / Browse can be exercised end-to-end.
    // Double-gated (like the userData redirect) so a stray env var in a normal
    // launch can never silently replace the real folder picker.
    if (process.env.EXAWATT_TEST && process.env.EXAWATT_TEST_DIR) {
      return process.env.EXAWATT_TEST_DIR;
    }
    const options: Electron.OpenDialogOptions = {
      title: 'Open project directory',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
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
  handleTrusted('app:get-build-info', () => buildInfo);
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
        : copy.detail,
    buttons: [
      'Cancel',
      intent === 'update' ? 'Restart and Stop' : 'Quit and Stop',
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
    buttons: ['Cancel', intent === 'update' ? 'Restart Anyway' : 'Quit Anyway'],
    cancelId: 0,
    noLink: true,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function checkpointRenderer(
  intent: ShutdownIntent,
  stage: 'pre-stop' | 'stopped'
): Promise<boolean> {
  if (stage === 'pre-stop') await ptySessions.settleProviderIdentities();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return true;
  // Workspace state is mutable only while the workspace hook is mounted. On
  // Fleet/Spatial/other routes the serialized store is already authoritative.
  if (!workspaceCheckpointOwners.has(win.webContents.id)) return true;
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
  rendererServer?.kill();
  rendererServer = null;
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

app.whenReady().then(async () => {
  if (!isDev) await startPackagedRenderer();
  await ptySessions.configurePersistence(
    path.join(app.getPath('userData'), 'sessions')
  );
  setTrustedRendererOrigin(isDev ? DEV_URL : rendererOrigin!);
  registerAgentIPC();
  runStateStore = new RunStateStore(
    path.join(app.getPath('userData'), 'run-state.json')
  );
  const recovery = await runStateStore.begin();
  registerPtyIPC(recovery.previousRunInterrupted);
  registerRoadmapIPC();
  registerAuthIPC();
  registerDialogIPC();
  registerAppIPC();
  registerMenuIPC();
  shutdownCoordinator = new ShutdownCoordinator({
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
      else app.quit();
    },
    status: broadcastShutdown,
  });
  registerProductUpdater(
    () => ptySessions.list().filter(session => !session.exited).length,
    () => shutdownCoordinator!.request('update')
  );
  createMenu();
  createWindow();
  watchInstalledBuild();
  startProductUpdater(buildInfo.delivery === 'signed');

  app.on('activate', () => {
    if (shutdownCoordinator?.phase !== 'idle') return;
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', event => {
  if (!shutdownCoordinator || shutdownCoordinator.allowsFinalExit) return;
  event.preventDefault();
  void shutdownCoordinator.request('quit');
});

// macOS: keep app in dock when all windows closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
