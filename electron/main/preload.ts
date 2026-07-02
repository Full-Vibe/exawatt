import { contextBridge, ipcRenderer } from 'electron';

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
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    list: () => ipcRenderer.invoke('pty:list'),
    buffer: (id: string) => ipcRenderer.invoke('pty:buffer', id),
    onData: (handler: (payload: { id: string; data: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; data: string }
      ) => handler(payload);
      ipcRenderer.on('pty:data', listener);
      return () => {
        ipcRenderer.removeListener('pty:data', listener);
      };
    },
    onExit: (handler: (payload: { id: string; exitCode: number }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number }
      ) => handler(payload);
      ipcRenderer.on('pty:exit', listener);
      return () => {
        ipcRenderer.removeListener('pty:exit', listener);
      };
    },
  },
  auth: {
    openExternal: (url: string) => ipcRenderer.invoke('auth:open-external', url),
    onDeepLinkCode: (handler: (code: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, code: string) => {
        handler(code);
      };
      ipcRenderer.on('auth:deeplink-code', listener);
      return () => {
        ipcRenderer.removeListener('auth:deeplink-code', listener);
      };
    },
  },
});
