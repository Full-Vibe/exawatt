import { ipcMain, BrowserWindow, app } from 'electron';
import { ptySessions } from './pty/session-manager';
import type { PtyCreateOptions } from './pty/session-manager';
import { contextSummarizer } from './pty/context-summarizer';
import { attentionMonitor } from './pty/attention-monitor';
import { createWorktree } from './pty/project-resolve';
import { loadWorkspace, saveWorkspace } from './workspace-store';
import { loadSettings } from './settings-store';

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

  // micro-context subtitles (W0.4): summaries stream as they refresh, and
  // ride along on pty:list so late attaches/pollers see the latest
  contextSummarizer.attach(ptySessions);
  contextSummarizer.start();
  contextSummarizer.on('context', (id: string, summary: string) => {
    broadcast('pty:context', { id, summary });
  });
  contextSummarizer.on('recap', (recap: unknown) => {
    broadcast('pty:recap', recap);
  });

  // attention (ENG-015 S1): "needs you" state streams to the UI, and the
  // macOS dock carries the count so nothing goes unnoticed while unfocused
  attentionMonitor.attach(ptySessions);
  attentionMonitor.start();
  // "looked at" requires OS window focus too — the active tab behind
  // another app is exactly the single-tab case attention exists for
  app.on('browser-window-focus', () => {
    attentionMonitor.setWindowFocused(true);
    contextSummarizer.setWindowFocused(true);
    // Settings may have been edited while Exawatt was in the background.
    // Main owns authoritative OS focus, so refresh existing panes from here.
    broadcast('settings:changed', loadSettings());
  });
  app.on('browser-window-blur', () => {
    attentionMonitor.setWindowFocused(false);
    contextSummarizer.setWindowFocused(false);
  });
  attentionMonitor.on('attention', (id: string, attention: unknown) => {
    broadcast('pty:attention', { id, attention });
    const count = attentionMonitor.count();
    if (app.dock) {
      app.dock.setBadge(count > 0 ? String(count) : '');
      if (attention && BrowserWindow.getFocusedWindow() === null) {
        app.dock.bounce('informational');
      }
    }
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
    // engagement clears the flag — but only when the session is actually
    // being watched: writes ALSO carry xterm auto-replies from hidden panes
    // (cursor/device queries, backlog replay), which the monitor ignores
    attentionMonitor.noteInput(id);
  });
  // xterm's onData also carries terminal protocol replies. Only onKey is
  // guaranteed human engagement, so it has a separate recap-cancellation
  // channel instead of overloading pty:write.
  ipcMain.handle('pty:engage', (_event, id: string) => {
    contextSummarizer.noteInput(id);
  });
  ipcMain.handle('pty:focus', (_event, id: string | null) => {
    attentionMonitor.setFocus(id);
    contextSummarizer.setFocus(id);
  });
  ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptySessions.resize(id, cols, rows);
  });
  ipcMain.handle('pty:kill', (_event, id: string) => {
    ptySessions.kill(id);
  });
  ipcMain.handle('pty:rename', (_event, id: string, title: string) => {
    ptySessions.rename(id, title);
  });
  ipcMain.handle('pty:list', () =>
    ptySessions.list().map((s) => ({
      ...s,
      contextSummary: contextSummarizer.getSummary(s.id),
      attention: attentionMonitor.get(s.id),
    }))
  );
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

  // user settings (S3): userData/settings.json — e.g. the terminal font
  ipcMain.handle('settings:get', () => loadSettings());
}

/** app-quit cleanup: never leave orphan shells behind */
export function disposePty(): void {
  contextSummarizer.stop();
  attentionMonitor.stop();
  ptySessions.killAll();
}
