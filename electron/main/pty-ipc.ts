import { ipcMain, BrowserWindow } from 'electron';
import { ptySessions } from './pty/session-manager';
import type { PtyCreateOptions } from './pty/session-manager';

/**
 * IPC surface for PTY sessions (decision 0005). Invocations are namespaced
 * `pty:*`; output/exit stream to every window via `pty:data` / `pty:exit`
 * (single-window app today; cheap to scope per-window later).
 */
export function registerPtyIPC(): void {
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  ptySessions.on('data', (id: string, data: string) => {
    broadcast('pty:data', { id, data });
  });
  ptySessions.on('exit', (id: string, exitCode: number) => {
    broadcast('pty:exit', { id, exitCode });
  });

  ipcMain.handle('pty:create', (_event, options: PtyCreateOptions) =>
    ptySessions.create(options)
  );
  ipcMain.handle('pty:write', (_event, id: string, data: string) => {
    ptySessions.write(id, data);
  });
  ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptySessions.resize(id, cols, rows);
  });
  ipcMain.handle('pty:kill', (_event, id: string) => {
    ptySessions.kill(id);
  });
  ipcMain.handle('pty:list', () => ptySessions.list());
  ipcMain.handle('pty:buffer', (_event, id: string) => ptySessions.buffer(id));
}

/** app-quit cleanup: never leave orphan shells behind */
export function disposePty(): void {
  ptySessions.killAll();
}
