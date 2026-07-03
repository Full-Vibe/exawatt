import { ipcMain, BrowserWindow } from 'electron';
import { ptySessions } from './pty/session-manager';
import type { PtyCreateOptions } from './pty/session-manager';
import { createWorktree } from './pty/project-resolve';
import { loadWorkspace, saveWorkspace } from './workspace-store';

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

  // structured result instead of a thrown error: IPC rejections arrive as
  // opaque "Error invoking remote method" strings — useless for UX
  ipcMain.handle('pty:create', async (_event, options: PtyCreateOptions) => {
    try {
      return { ok: true as const, session: await ptySessions.create(options) };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
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

  // one-gesture worktrees: <repo>-wt/<branch> sibling container
  ipcMain.handle(
    'pty:worktree',
    async (_event, repoDir: string, branch: string) => {
      try {
        return { ok: true as const, path: await createWorktree(repoDir, branch) };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // workspace layout persistence (renderer-owned shape)
  ipcMain.handle('workspace:load', () => loadWorkspace());
  ipcMain.handle('workspace:save', (_event, state: unknown) =>
    saveWorkspace(state)
  );
}

/** app-quit cleanup: never leave orphan shells behind */
export function disposePty(): void {
  ptySessions.killAll();
}
