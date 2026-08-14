import path from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { handleTrusted } from './ipc-security';
import {
  createDiagnosticsLog,
  type DiagnosticRecorder,
} from './diagnostics-log';

export type ProductUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface ProductUpdateStatus {
  phase: ProductUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  liveSessions: number;
  error: string | null;
  /** false when this build has no update channel at all (unsigned local
   *  delivery, or a dev/test run). A user on such a build never sees an
   *  update and never sees a failure; only this field says so. */
  enabled: boolean;
  /** Absolute path to the JSONL a user can send back after a failed update. */
  logPath: string | null;
}

let status: ProductUpdateStatus = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  liveSessions: 0,
  error: null,
  enabled: false,
  logPath: null,
};
let registered = false;
let downloaded = false;
let liveSessionCount = () => 0;

/**
 * Update failures used to leave no evidence anywhere (ENG-030 OS1.6). The
 * packaged app's stdout goes nowhere, electron-updater's default logger is
 * bare `console`, and the renderer notice showed "Update failed" with the
 * reason discarded. Diagnosing an external user's stuck version took a
 * terminal relaunch on their machine. Everything the updater knows now lands
 * in `userData/logs/updater.jsonl`, which is one file to ask for.
 */
let record: DiagnosticRecorder = () => {};

function broadcast(): void {
  status = { ...status, liveSessions: liveSessionCount() };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:update-status', status);
  }
}

function setStatus(patch: Partial<ProductUpdateStatus>): void {
  status = { ...status, ...patch, liveSessions: liveSessionCount() };
  broadcast();
}

function version(info: UpdateInfo): string {
  return info.version || 'unknown';
}

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const candidate = error as Error & { code?: unknown; statusCode?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    ...(typeof candidate.statusCode === 'number'
      ? { statusCode: candidate.statusCode }
      : {}),
    stack: error.stack?.split('\n').slice(0, 12).join('\n'),
  };
}

export function registerProductUpdater(
  countLiveSessions: () => number,
  restartForUpdate: () => Promise<boolean>
): void {
  liveSessionCount = countLiveSessions;
  if (registered) return;
  registered = true;

  const logPath = path.join(app.getPath('userData'), 'logs', 'updater.jsonl');
  record = createDiagnosticsLog(logPath);
  status = { ...status, logPath };

  // electron-updater's own chatter is the only place the real reason for a
  // failed download or a refused Squirrel install appears. Forward all of it.
  autoUpdater.logger = {
    info: message =>
      record('updater.log', { level: 'info', message: String(message) }),
    warn: message =>
      record('updater.log', { level: 'warn', message: String(message) }),
    error: message =>
      record('updater.log', { level: 'error', message: String(message) }),
    debug: message =>
      record('updater.log', { level: 'debug', message: String(message) }),
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    record('updater.checking', { currentVersion: status.currentVersion });
    setStatus({ phase: 'checking', error: null, percent: null });
  });
  autoUpdater.on('update-available', info => {
    record('updater.available', {
      availableVersion: version(info),
      releaseDate: info.releaseDate,
    });
    setStatus({
      phase: 'available',
      availableVersion: version(info),
      error: null,
      percent: 0,
    });
  });
  autoUpdater.on('update-not-available', info => {
    record('updater.not-available', { latestVersion: version(info) });
    setStatus({
      phase: 'idle',
      availableVersion: version(info),
      error: null,
      percent: null,
    });
  });
  autoUpdater.on('download-progress', progress => {
    setStatus({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent)),
    });
  });
  autoUpdater.on('update-downloaded', info => {
    downloaded = true;
    record('updater.downloaded', { availableVersion: version(info) });
    setStatus({
      phase: 'downloaded',
      availableVersion: version(info),
      percent: 100,
      error: null,
    });
  });
  autoUpdater.on('error', error => {
    record('updater.error', {
      phase: status.phase,
      availableVersion: status.availableVersion,
      ...describeError(error),
    });
    setStatus({
      phase: 'error',
      error: error.message.slice(0, 300),
      percent: null,
    });
  });

  handleTrusted('app:get-update-status', () => ({
    ...status,
    liveSessions: liveSessionCount(),
  }));
  handleTrusted('app:check-for-updates', async () => {
    await runCheck('renderer');
    return status;
  });
  handleTrusted('app:restart-update', async () => {
    if (!downloaded) throw new Error('No downloaded update is ready');
    record('updater.restart-requested', {
      availableVersion: status.availableVersion,
    });
    await restartForUpdate();
  });
}

async function runCheck(
  trigger: 'startup' | 'renderer' | 'menu'
): Promise<void> {
  record('updater.check-requested', { trigger, enabled: status.enabled });
  if (!status.enabled) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    record('updater.check-failed', { trigger, ...describeError(error) });
    setStatus({
      phase: 'error',
      error:
        error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
  }
}

export function installProductUpdate(): void {
  if (!downloaded) throw new Error('No downloaded update is ready');
  record('updater.installing', { availableVersion: status.availableVersion });
  autoUpdater.quitAndInstall(false, true);
}

/**
 * The macOS app menu's Check for Updates. Its job on a support call is to
 * turn any of the three silent states into a sentence the user can read
 * back: no update channel, an update in flight, or the actual failure.
 */
export async function checkForUpdatesFromMenu(): Promise<void> {
  await runCheck('menu');
  const detailSuffix = status.logPath
    ? `\n\nDiagnostics: ${status.logPath}`
    : '';

  if (!status.enabled) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Automatic updates are off for this build.',
      detail: `This copy of Exawatt ${status.currentVersion} was installed directly rather than from a signed release, so it has no update channel. Install the latest release to turn automatic updates on.`,
      buttons: ['OK'],
    });
    return;
  }
  if (status.phase === 'error') {
    await dialog.showMessageBox({
      type: 'warning',
      message: `Exawatt ${status.currentVersion} could not update.`,
      detail: `${status.error ?? 'No reason was reported.'}${detailSuffix}`,
      buttons: ['OK'],
    });
    return;
  }
  if (status.phase === 'downloaded') {
    await dialog.showMessageBox({
      type: 'info',
      message: `Exawatt ${status.availableVersion} is ready to install.`,
      detail: 'Restart to finish updating.',
      buttons: ['OK'],
    });
    return;
  }
  if (status.phase === 'available' || status.phase === 'downloading') {
    await dialog.showMessageBox({
      type: 'info',
      message: `Downloading Exawatt ${status.availableVersion}.`,
      detail: 'Exawatt will offer to restart when the download finishes.',
      buttons: ['OK'],
    });
    return;
  }
  await dialog.showMessageBox({
    type: 'info',
    message: `Exawatt ${status.currentVersion} is up to date.`,
    detail: `Latest available version: ${status.availableVersion ?? status.currentVersion}.`,
    buttons: ['OK'],
  });
}

export function startProductUpdater(enabled: boolean): void {
  const reason = !enabled
    ? 'unsigned-delivery'
    : !app.isPackaged
      ? 'not-packaged'
      : process.env.EXAWATT_TEST === '1'
        ? 'test-run'
        : null;
  setStatus({ enabled: reason === null });
  record('updater.startup', {
    currentVersion: status.currentVersion,
    enabled: status.enabled,
    ...(reason ? { disabledReason: reason } : {}),
  });
  if (reason !== null) return;
  setTimeout(() => {
    void runCheck('startup');
  }, 5_000).unref?.();
}
