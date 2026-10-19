import { existsSync } from 'fs';
import path from 'path';
import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  dialog,
} from 'electron';
import {
  autoUpdater as electronUpdater,
  type Logger,
  type UpdateInfo,
} from 'electron-updater';
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
import {
  createNativeStaging,
  watchNativeInstall,
  type NativeStaging,
  type NativeUpdater,
} from './updater-staging';
import type { InstallFailure } from './run-state';

/**
 * The two updaters this module drives: electron-updater's (feed, download)
 * and Electron's native one (Squirrel.Mac). A test launch may substitute a
 * double with the same surface (`updater-test-double.ts`); nothing else does.
 */
export interface ProductUpdaterBoundary {
  updater: {
    setFeedURL(url: string): void;
    logger: Logger | null;
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    allowPrerelease: boolean;
    on(event: 'checking-for-update', listener: () => void): unknown;
    on(
      event: 'update-available' | 'update-not-available' | 'update-downloaded',
      listener: (info: UpdateInfo) => void
    ): unknown;
    on(
      event: 'download-progress',
      listener: (progress: { percent: number }) => void
    ): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    checkForUpdates(): Promise<unknown>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  };
  native: NativeUpdater;
}

/** Null until a test launch substitutes a double; read through `updaters()`. */
let substituted: ProductUpdaterBoundary | null = null;
function updaters(): ProductUpdaterBoundary {
  return substituted ?? { updater: electronUpdater, native: nativeUpdater };
}

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
let liveSessionCount = () => 0;

/**
 * Squirrel.Mac's view of the downloaded update (BUG-286): one staging per
 * native updater, so a test launch's double gets its own.
 */
let staging: { native: NativeUpdater; staging: NativeStaging } | null = null;
function nativeStaging(): NativeStaging {
  const native = updaters().native;
  if (staging?.native !== native) {
    staging = {
      native,
      staging: createNativeStaging(native, {
        accepted: ({ late }) => {
          record('updater.staged', {
            availableVersion: status.availableVersion,
            late,
          });
          // The restart stopped waiting and said the update failed; Squirrel
          // has it now, so the notice offers Restart to Update again.
          if (late && downloaded && status.phase === 'error') {
            setStatus({ phase: 'downloaded', error: null, percent: 100 });
          }
        },
        refused: (reason, { late }) =>
          record('updater.stage-failed', {
            availableVersion: status.availableVersion,
            reason,
            late,
          }),
      }),
    };
  }
  return staging.staging;
}

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
  restartForUpdate: () => Promise<boolean>,
  double: ProductUpdaterBoundary | null = null
): void {
  liveSessionCount = countLiveSessions;
  if (registered) return;
  registered = true;
  substituted = double;
  const autoUpdater = double?.updater ?? electronUpdater;

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
    nativeStaging().reset();
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
    await updaters().updater.checkForUpdates();
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
 * Squirrel.Mac and wait for it to accept or refuse it (BUG-286). Resolves
 * null once it is accepted, or with the refusal. The lifecycle owner bounds
 * the wait and lets the operator cancel it; `signal` ends this wait, and
 * Squirrel's later answer still lands (`nativeStaging`).
 */
export async function prepareProductUpdate(
  signal?: AbortSignal
): Promise<string | null> {
  if (!downloaded) throw new Error('No downloaded update is ready');
  const native = nativeStaging();
  if (process.platform !== 'darwin' || native.staged) return null;
  record('updater.staging', { availableVersion: status.availableVersion });
  return await native.stage(signal);
}

/** The update did not go ahead: the notice says why, every agent still runs. */
export function reportUpdateRefused(reason: string): void {
  record('updater.refused', {
    availableVersion: status.availableVersion,
    reason,
  });
  setStatus({ phase: 'error', error: reason.slice(0, 300), percent: null });
}

/**
 * The shutdown's handoff. Everything has already stopped; resolves only if
 * the install fails, with the reason, so the lifecycle owner can relaunch
 * the current version instead of sitting on "Closing…".
 */
export async function installProductUpdate(
  signal?: AbortSignal
): Promise<string> {
  if (!downloaded) throw new Error('No downloaded update is ready');
  record('updater.installing', { availableVersion: status.availableVersion });
  const reason = await watchNativeInstall(
    updaters().native,
    () => updaters().updater.quitAndInstall(false, true),
    signal
  );
  record('updater.install-failed', {
    availableVersion: status.availableVersion,
    reason,
  });
  return reason;
}

/** What the run record keeps when the install fails after everything stopped. */
export function installFailure(reason: string): InstallFailure {
  return {
    fromVersion: status.currentVersion,
    toVersion: status.availableVersion,
    reason: reason.slice(0, 300),
  };
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

/**
 * `lastInstallFailure` is the previous run's failed install, from the run
 * record. Shown once, and only while this is still the version it failed to
 * leave; the startup check that would replace it with "ready to install"
 * waits for this launch.
 */
export function startProductUpdater(
  enabled: boolean,
  lastInstallFailure: InstallFailure | null
): void {
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
  if (lastInstallFailure?.fromVersion === status.currentVersion) {
    record('updater.install-failure-reported', { ...lastInstallFailure });
    setStatus({
      phase: 'error',
      error: lastInstallFailure.reason || 'No reason was reported.',
      percent: null,
    });
    return;
  }
  setTimeout(() => {
    void runCheck('startup');
  }, 5_000).unref?.();
}
