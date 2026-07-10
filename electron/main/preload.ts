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
    createWorktree: (repoDir: string, branch: string) =>
      ipcRenderer.invoke('pty:worktree', repoDir, branch),
    onData: subscribe<{ id: string; data: string }>('pty:data'),
    onExit: subscribe<{ id: string; exitCode: number }>('pty:exit'),
    onContext: subscribe<{ id: string; summary: string }>('pty:context'),
    onRecap: subscribe<{
      id: string;
      text: string;
      awayMs: number;
      generatedAt: number;
    }>('pty:recap'),
    onAttention: subscribe<{ id: string; attention: unknown }>('pty:attention'),
  },
  workspace: {
    load: () => ipcRenderer.invoke('workspace:load'),
    save: (state: unknown) => ipcRenderer.invoke('workspace:save', state),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    onChanged: subscribe<{
      terminal?: {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
        letterSpacing?: number;
        fontStrokeWidth?: number;
      };
    }>('settings:changed'),
  },
  app: {
    getBuildInfo: () => ipcRenderer.invoke('app:get-build-info'),
    onUpdateReady: subscribe<{
      currentSha: string;
      installedSha: string;
    }>('app:update-ready'),
  },
  auth: {
    openExternal: (url: string) => ipcRenderer.invoke('auth:open-external', url),
    onDeepLinkCode: subscribe<string>('auth:deeplink-code'),
  },
  dialog: {
    openDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openDirectory'),
  },
});
