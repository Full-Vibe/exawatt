import { app, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { handleTrusted } from './ipc-security';

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
}

let status: ProductUpdateStatus = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  liveSessions: 0,
  error: null,
};
let registered = false;
let downloaded = false;
let liveSessionCount = () => 0;

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

export function registerProductUpdater(countLiveSessions: () => number): void {
  liveSessionCount = countLiveSessions;
  if (registered) return;
  registered = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    setStatus({ phase: 'checking', error: null, percent: null });
  });
  autoUpdater.on('update-available', info => {
    setStatus({
      phase: 'available',
      availableVersion: version(info),
      error: null,
      percent: 0,
    });
  });
  autoUpdater.on('update-not-available', info => {
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
    setStatus({
      phase: 'downloaded',
      availableVersion: version(info),
      percent: 100,
      error: null,
    });
  });
  autoUpdater.on('error', error => {
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
    await autoUpdater.checkForUpdates();
    return status;
  });
  handleTrusted('app:restart-update', () => {
    if (!downloaded) throw new Error('No downloaded update is ready');
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
}

export function startProductUpdater(enabled: boolean): void {
  if (!enabled || !app.isPackaged || process.env.EXAWATT_TEST === '1') return;
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(error => {
      setStatus({
        phase: 'error',
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      });
    });
  }, 5_000).unref?.();
}
