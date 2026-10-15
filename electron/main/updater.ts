import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  dialog,
} from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { handleTrusted } from './ipc-security';
import {
  createDiagnosticsLog,
  type DiagnosticRecorder,
} from './diagnostics-log';
import type {
  ProductUpdateStatus,
  UpdaterDisabledReason,
} from '@exawatt/core/desktop-bridge';
import { broadcastToWindows } from './window-broadcast';
import { stageNativeUpdate, watchNativeInstall } from './updater-staging';

let status: ProductUpdateStatus = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  liveSessions: 0,
  error: null,
  enabled: false,
  disabledReason: null,
  logPath: null,
};
let registered = false;
let downloaded = false;
/** Squirrel.Mac has fetched and verified the downloaded update (BUG-286). */
let staged = false;
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
  broadcastToWindows(
    BrowserWindow.getAllWindows(),
    'app:update-status',
    status
  );
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
  feedUrl: string,
  countLiveSessions: () => number,
  restartForUpdate: () => Promise<boolean>
): void {
  liveSessionCount = countLiveSessions;
  if (registered) return;
  registered = true;

  const logPath = path.join(app.getPath('userData'), 'logs', 'updater.jsonl');
  record = createDiagnosticsLog(logPath);
  status = { ...status, logPath };

  // The resolved distribution is the runtime authority as well as the
  // builder authority. This prevents a copied or stale app-update.yml from
  // silently sending an otherwise valid distribution to a different feed.
  autoUpdater.setFeedURL(feedUrl);

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
    staged = false;
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

/** Read-only snapshot for callers outside the IPC handler (ENG-025 F5). */
export function currentUpdateStatus(): ProductUpdateStatus {
  return { ...status, liveSessions: liveSessionCount() };
}

/**
 * The restart's first step, before anything stops: hand the download to
 * Squirrel.Mac and wait for it to accept or refuse it (BUG-286). A refusal
 * becomes the "Update failed" notice with the reason, and the shutdown
 * returns to idle with every agent still running.
 */
export async function prepareProductUpdate(): Promise<boolean> {
  if (!downloaded) throw new Error('No downloaded update is ready');
  if (process.platform !== 'darwin' || staged) return true;
  record('updater.staging', { availableVersion: status.availableVersion });
  const outcome = await stageNativeUpdate(nativeUpdater);
  if (outcome.ok) {
    staged = true;
    record('updater.staged', { availableVersion: status.availableVersion });
    return true;
  }
  record('updater.stage-failed', {
    availableVersion: status.availableVersion,
    reason: outcome.reason,
    timedOut: outcome.timedOut,
  });
  setStatus({
    phase: 'error',
    error: outcome.reason.slice(0, 300),
    percent: null,
  });
  return false;
}

function installFailurePath(): string {
  return path.join(app.getPath('userData'), 'update-install-failure.json');
}

/**
 * The shutdown's last step. Everything has already stopped, so if the
 * install fails anyway the app must not sit on "Closing…": it records why,
 * relaunches the current version, and the next launch shows the reason.
 */
export function installProductUpdate(): void {
  if (!downloaded) throw new Error('No downloaded update is ready');
  record('updater.installing', { availableVersion: status.availableVersion });
  void watchNativeInstall(nativeUpdater, {
    install: () => autoUpdater.quitAndInstall(false, true),
  }).then(outcome => {
    if (outcome.ok) return;
    record('updater.install-failed', {
      availableVersion: status.availableVersion,
      reason: outcome.reason,
      timedOut: outcome.timedOut,
    });
    try {
      writeFileSync(
        installFailurePath(),
        JSON.stringify({
          fromVersion: status.currentVersion,
          toVersion: status.availableVersion,
          reason: outcome.reason.slice(0, 300),
        })
      );
    } catch (error) {
      record('updater.install-failure-unsaved', describeError(error));
    }
    app.relaunch();
    app.quit();
  });
}

/**
 * The previous launch's failed install, once, if this is still the version
 * it failed to leave. Showing it is the whole point, so the startup check
 * that would replace it with "ready to install" waits for this launch.
 */
function takeInstallFailure(): string | null {
  const file = installFailurePath();
  let failure: { fromVersion?: unknown; toVersion?: unknown; reason?: unknown };
  try {
    failure = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  try {
    rmSync(file, { force: true });
  } catch (error) {
    record('updater.install-failure-unsaved', describeError(error));
  }
  if (failure.fromVersion !== status.currentVersion) return null;
  record('updater.install-failure-reported', failure);
  return typeof failure.reason === 'string' && failure.reason
    ? failure.reason.slice(0, 300)
    : 'No reason was reported.';
}

/**
 * The macOS app menu's Check for Updates. Its job on a support call is to
 * turn any of the three silent states into a sentence the user can read
 * back: no update channel, an update in flight, or the actual failure.
 */
export async function checkForUpdatesFromMenu(): Promise<void> {
  await runCheck('menu');
  const productName = app.name;
  const detailSuffix = status.logPath
    ? `\n\nDiagnostics: ${status.logPath}`
    : '';

  if (!status.enabled) {
    // 'no-feed-config' is the only one of these a released build can hit, and
    // the user cannot fix it from inside the app: the build itself is missing
    // its update channel, so the way forward is a fresh download.
    const detail =
      status.disabledReason === 'no-feed-config'
        ? `${productName} ${status.currentVersion} was packaged without an update channel, so it cannot check for new versions. Download the current release from your distributor and replace this copy.${detailSuffix}`
        : `This copy of ${productName} ${status.currentVersion} was installed directly rather than from a signed release, so it has no update channel. Install the latest signed release to turn automatic updates on.`;
    await dialog.showMessageBox({
      type: status.disabledReason === 'no-feed-config' ? 'warning' : 'info',
      message: 'Automatic updates are off for this build.',
      detail,
      buttons: ['OK'],
    });
    return;
  }
  if (status.phase === 'error') {
    await dialog.showMessageBox({
      type: 'warning',
      message: `${productName} ${status.currentVersion} could not update.`,
      detail: `${status.error ?? 'No reason was reported.'}${detailSuffix}`,
      buttons: ['OK'],
    });
    return;
  }
  if (status.phase === 'downloaded') {
    await dialog.showMessageBox({
      type: 'info',
      message: `${productName} ${status.availableVersion} is ready to install.`,
      detail: 'Restart to finish updating.',
      buttons: ['OK'],
    });
    return;
  }
  if (status.phase === 'available' || status.phase === 'downloading') {
    await dialog.showMessageBox({
      type: 'info',
      message: `Downloading ${productName} ${status.availableVersion}.`,
      detail: `${productName} will offer to restart when the download finishes.`,
      buttons: ['OK'],
    });
    return;
  }
  await dialog.showMessageBox({
    type: 'info',
    message: `${productName} ${status.currentVersion} is up to date.`,
    detail: `Latest available version: ${status.availableVersion ?? status.currentVersion}.`,
    buttons: ['OK'],
  });
}

/**
 * A build with no `app-update.yml` is not a build with a broken network: it
 * has no feed at all, and electron-updater's `loadUpdateConfig` reads that
 * file with a bare `readFile`, so the first check rejects with ENOENT and
 * every launch after it repeats. Six signed releases shipped that way
 * (BUG-015, incident `0009`). The packaging guard makes it unshippable; this
 * makes it legible if it ever ships again, because "no update channel" is a
 * true sentence a user can act on and a recurring "Update failed" is not.
 */
export function updaterDisabledReason(input: {
  signedDelivery: boolean;
  packaged: boolean;
  testRun: boolean;
  hasFeedConfig: boolean;
}): UpdaterDisabledReason | null {
  if (!input.signedDelivery) return 'unsigned-delivery';
  if (!input.packaged) return 'not-packaged';
  if (input.testRun) return 'test-run';
  if (!input.hasFeedConfig) return 'no-feed-config';
  return null;
}

export function startProductUpdater(enabled: boolean): void {
  const packaged = app.isPackaged;
  const reason = updaterDisabledReason({
    signedDelivery: enabled,
    packaged,
    testRun: process.env.EXAWATT_TEST === '1',
    // only meaningful once packaged; an unpacked run has already bailed out
    hasFeedConfig:
      !packaged ||
      existsSync(path.join(process.resourcesPath, 'app-update.yml')),
  });
  setStatus({ enabled: reason === null, disabledReason: reason });
  record('updater.startup', {
    currentVersion: status.currentVersion,
    enabled: status.enabled,
    ...(reason ? { disabledReason: reason } : {}),
  });
  if (reason !== null) return;
  const lastFailure = takeInstallFailure();
  if (lastFailure !== null) {
    setStatus({ phase: 'error', error: lastFailure, percent: null });
    return;
  }
  setTimeout(() => {
    void runCheck('startup');
  }, 5_000).unref?.();
}
