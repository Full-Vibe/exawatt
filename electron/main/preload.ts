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
