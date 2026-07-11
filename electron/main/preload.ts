import { contextBridge, ipcRenderer } from 'electron';

/** one subscribe-shape for every main→renderer event channel: wraps the
 *  handler, registers it, returns a disposer that removes ONLY it (never
 *  removeAllListeners — that clobbers sibling subscribers) */
const subscribe =
  <T>(channel: string) =>
  (handler: (payload: T) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) =>
      handler(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,
  agent: {
    invoke: (method: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`agent:${method}`, ...args),
    on: (channel: string, handler: (...args: unknown[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args);
      ipcRenderer.on(channel, listener);
    },
    off: (channel: string, handler: (...args: unknown[]) => void) => {
      ipcRenderer.removeAllListeners(channel);
    },
  },
  pty: {
    create: (options: unknown) => ipcRenderer.invoke('pty:create', options),
    write: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data),
    engage: (id: string) => ipcRenderer.invoke('pty:engage', id),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    rename: (id: string, title: string) =>
      ipcRenderer.invoke('pty:rename', id, title),
    focus: (id: string | null) => ipcRenderer.invoke('pty:focus', id),
    list: () => ipcRenderer.invoke('pty:list'),
    buffer: (id: string) => ipcRenderer.invoke('pty:buffer', id),
    bufferSnapshot: (id: string) => ipcRenderer.invoke('pty:buffer-snapshot', id),
    bufferSince: (id: string, cursor: number) =>
      ipcRenderer.invoke('pty:buffer-since', id, cursor),
    pasteClipboard: (id: string) => ipcRenderer.invoke('pty:paste-clipboard', id),
    copyText: (text: string) => ipcRenderer.invoke('pty:copy-text', text),
    openExternal: (url: string) => ipcRenderer.invoke('pty:open-external', url),
    openPath: (filePath: string, cwd: string) =>
      ipcRenderer.invoke('pty:open-path', filePath, cwd),
    createWorktree: (repoDir: string, branch: string) =>
      ipcRenderer.invoke('pty:worktree', repoDir, branch),
    listResumeCandidates: (harness: string, cwd: string) =>
      ipcRenderer.invoke('pty:list-resume-candidates', harness, cwd),
    onData: subscribe<{ id: string; data: string; cursor: number }>('pty:data'),
    onExit: subscribe<{ id: string; exitCode: number }>('pty:exit'),
    onContext: subscribe<{ id: string; summary: string }>('pty:context'),
    onRecap: subscribe<{
      id: string;
      text: string;
      awayMs: number;
      generatedAt: number;
    }>('pty:recap'),
    onAttention: subscribe<{ id: string; attention: unknown }>('pty:attention'),
    onNotificationClick: subscribe<{ id: string }>('pty:notification-click'),
  },
  workspace: {
    load: () => ipcRenderer.invoke('workspace:load'),
    save: (state: unknown) => ipcRenderer.invoke('workspace:save', state),
  },
  roadmap: {
    read: (projectDir: string) => ipcRenderer.invoke('roadmap:read', projectDir),
    sessionEvidence: (cwd: string) =>
      ipcRenderer.invoke('roadmap:session-evidence', cwd),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setAttentionNotifications: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-attention-notifications', enabled),
    onChanged: subscribe<{
      terminal?: {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
        letterSpacing?: number;
        fontStrokeWidth?: number;
      };
      notifications?: { attention: boolean };
    }>('settings:changed'),
  },
  app: {
    getBuildInfo: () => ipcRenderer.invoke('app:get-build-info'),
    getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    restartUpdate: () => ipcRenderer.invoke('app:restart-update'),
    onUpdateReady: subscribe<{
      currentSha: string;
      installedSha: string;
    }>('app:update-ready'),
    onUpdateStatus: subscribe<{
      phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
      currentVersion: string;
      availableVersion: string | null;
      percent: number | null;
      liveSessions: number;
      error: string | null;
    }>('app:update-status'),
  },
  auth: {
    openExternal: (url: string) => ipcRenderer.invoke('auth:open-external', url),
    onDeepLinkCode: subscribe<string>('auth:deeplink-code'),
  },
  dialog: {
    openDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openDirectory'),
    pathExists: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('dialog:pathExists', path),
  },
});
