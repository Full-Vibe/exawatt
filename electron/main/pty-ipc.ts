import { BrowserWindow, Notification, app, shell } from 'electron';
import { handleTrusted } from './ipc-security';
import { resolveContainedPath, isRepoRelativePath } from './contained-path';
import { ptySessions } from './pty/session-manager';
import type { PtyCreateOptions } from './pty/session-manager';
import { contextSummarizer } from './pty/context-summarizer';
import { createDiagnosticsLog } from './diagnostics-log';
import { attentionMonitor } from './pty/attention-monitor';
import {
  ClosedSessionLedger,
  type ClosedSessionEntry,
} from './pty/closed-session-ledger';
import { createWorktree } from './pty/project-resolve';
import { loadWorkspace, saveWorkspace } from './workspace-store';
import {
  loadSettings,
  recordAgentSourceUse,
  setAgentPermissionMode,
  setAttentionNotifications,
  setDockBadge,
} from './settings-store';
import { listResumeCandidates } from './pty/resume-candidates';
import { RecentConversationCatalog } from './pty/conversation-catalog';
import {
  clipboardInput,
  cleanupClipboardImages,
  writeClipboardText,
} from './clipboard-paste';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  nativeNotificationCopy,
  shouldDeliverNativeNotification,
} from './notification-policy';

/**
 * IPC surface for PTY sessions (decision 0005). Invocations are namespaced
 * `pty:*`; output/exit stream to every window via `pty:data` / `pty:exit`
 * (single-window app today; cheap to scope per-window later).
 */
export function registerPtyIPC(previousRunInterrupted = false): void {
  const closedLedger = new ClosedSessionLedger(
    path.join(app.getPath('userData'), 'closed-sessions.json'),
    durableSessionId => ptySessions.purgeHistory(durableSessionId)
  );
  void closedLedger.reap();
  const reapTimer = setInterval(
    () => void closedLedger.reap(),
    6 * 60 * 60 * 1000
  );
  reapTimer.unref?.();
  const conversationCatalog = new RecentConversationCatalog({
    cacheFile: path.join(
      app.getPath('userData'),
      'conversation-summary-cache.json'
    ),
    projectSessions: () => closedLedger.list(),
  });
  const nativeNotifications = new Map<string, Notification>();
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  ptySessions.on(
    'data',
    (id: string, data: string, cursor: number, durableSessionId: string) => {
      broadcast('pty:data', { id, durableSessionId, data, cursor });
    }
  );
  ptySessions.on(
    'exit',
    (id: string, exitCode: number, durableSessionId: string) => {
      broadcast('pty:exit', { id, durableSessionId, exitCode });
    }
  );
  ptySessions.on(
    'identity',
    (id: string, durableSessionId: string, harnessSessionId: string) => {
      broadcast('pty:identity', { id, durableSessionId, harnessSessionId });
    }
  );

  // micro-context subtitles (W0.4): summaries stream as they refresh, and
  // ride along on pty:list so late attaches/pollers see the latest
  contextSummarizer.attach(ptySessions);
  // packaged-app stdout goes nowhere — the summarizer's attempts, failures,
  // and backoffs persist to userData/logs so a silent-subtitle dogfood
  // report is a file read (D28)
  contextSummarizer.setDiagnostics(
    createDiagnosticsLog(
      path.join(app.getPath('userData'), 'logs', 'summarizer.jsonl')
    )
  );
  contextSummarizer.start();
  // goal subtitles are durable-Session truth (D21): renderers key by
  // durableSessionId so a subtitle survives PTY replacement and restarts
  contextSummarizer.on(
    'context',
    (durableSessionId: string, summary: string) => {
      broadcast('pty:context', { durableSessionId, summary });
    }
  );
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
  // working/quiet transitions (D18): the tab strip's live status glyphs
  attentionMonitor.on('activity', (id: string, working: boolean) => {
    broadcast('pty:activity', { id, working });
  });
  // started/unstarted truth (D22) — fires once per session, first work given
  attentionMonitor.on('engaged', (id: string) => {
    broadcast('pty:engaged', { id });
  });
  attentionMonitor.on('attention', (id: string, attention: unknown) => {
    broadcast('pty:attention', { id, attention });
    const count = attentionMonitor.count();
    if (app.dock) {
      // ambient OS-level signals are opt-in (D18): an unexplained dock
      // number with no in-app way to clear it reads as noise, not truth
      const dockBadge = loadSettings().notifications?.dockBadge ?? false;
      app.dock.setBadge(dockBadge && count > 0 ? String(count) : '');
      if (dockBadge && attention && BrowserWindow.getFocusedWindow() === null) {
        app.dock.bounce('informational');
      }
    }
    nativeNotifications.get(id)?.close();
    nativeNotifications.delete(id);
    const typedAttention = attention as
      | import('./pty/attention-monitor').SessionAttention
      | null;
    if (
      !shouldDeliverNativeNotification(
        loadSettings().notifications?.attention ?? false,
        BrowserWindow.getFocusedWindow() !== null,
        typedAttention
      ) ||
      !Notification.isSupported()
    ) {
      return;
    }
    const session = ptySessions.list().find(item => item.id === id);
    if (!session) return;
    const notice = new Notification({
      ...nativeNotificationCopy(session),
      silent: true,
    });
    notice.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('pty:notification-click', { id });
    });
    notice.on('close', () => {
      if (nativeNotifications.get(id) === notice)
        nativeNotifications.delete(id);
    });
    nativeNotifications.set(id, notice);
    notice.show();
  });

  // structured result instead of a thrown error: IPC rejections arrive as
  // opaque "Error invoking remote method" strings — useless for UX
  handleTrusted('pty:create', async (_event, options: PtyCreateOptions) => {
    try {
      const session = await ptySessions.create(options);
      // the composer's task is the goal — show it as the subtitle instantly;
      // a resume re-anchors the goal persisted with the layout (D21)
      contextSummarizer.seedFromTask(
        session.durableSessionId,
        options.initialPrompt
      );
      contextSummarizer.restore(
        session.durableSessionId,
        options.restoredSubtitle
      );
      // a launch task or an exact resume IS work given: the tab must never
      // read "unstarted" (D22)
      if (options.initialPrompt || options.resumeSessionId) {
        attentionMonitor.noteEngaged(session.id);
      }
      return { ok: true as const, session };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  handleTrusted('pty:write', (_event, id: string, data: string) => {
    ptySessions.write(id, data);
    // engagement clears the flag — but only when the session is actually
    // being watched: writes ALSO carry xterm auto-replies from hidden panes
    // (cursor/device queries, backlog replay), which the monitor ignores
    attentionMonitor.noteInput(id);
  });
  // xterm's onData also carries terminal protocol replies. Only onKey is
  // guaranteed human engagement, so it has a separate recap-cancellation
  // channel instead of overloading pty:write.
  handleTrusted('pty:engage', (_event, id: string) => {
    contextSummarizer.noteInput(id);
    // the first human keystroke is work given — started truth (D22)
    attentionMonitor.noteEngaged(id);
  });
  handleTrusted('pty:focus', (_event, id: string | null) => {
    attentionMonitor.setFocus(id);
    contextSummarizer.setFocus(id);
  });
  // Persisted subtitles re-enter through main so the same validator owns
  // both generated and restored goal text. The accepted value returns to
  // hydration; null actively sheds stale model preambles.
  handleTrusted(
    'pty:restore-context',
    (_event, durableSessionId: string, subtitle: string) =>
      contextSummarizer.restore(durableSessionId, subtitle)
  );
  handleTrusted(
    'pty:resize',
    (_event, id: string, cols: number, rows: number) =>
      // node-pty can synchronously emit the WINCH redraw from resize(), so
      // the monitor owns the ordering boundary and guards before the call.
      attentionMonitor.runWithResizeGuard(id, () =>
        ptySessions.resize(id, cols, rows)
      )
  );
  handleTrusted('pty:kill', (_event, id: string) => ptySessions.kill(id));
  // ── Close-as-lifecycle (D23). The renderer owns the grammar (park →
  // archive) and any confirmation; main just executes honest primitives.
  // The old pty:delete-session native dialog + one-stroke history
  // destruction are gone — the ledger reap is now the only destroyer.
  // ⌘W closes like Chrome (D24/D25): the renderer owns the in-app
  // confirm; main executes one stop → await death → forget the runtime
  // record.
  handleTrusted(
    'pty:close-session',
    async (_event, durableSessionId: string, discard = false) => {
      const session = ptySessions
        .list()
        .find(item => item.durableSessionId === durableSessionId);
      if (session && !session.exited) {
        await ptySessions.stop(session.id);
        // stop() awaits process-group death, but node-pty's exit callback
        // lands on a later tick — wait for the honest exited flag so the
        // archive that follows sees a dead session
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline) {
          const current = ptySessions
            .list()
            .find(item => item.durableSessionId === durableSessionId);
          if (!current || current.exited) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      // the dead record must not resurrect the closed tab on rehydration;
      // a discarded (never-started) session also sheds its banner history
      ptySessions.forgetExited(durableSessionId);
      if (discard) await ptySessions.purgeHistory(durableSessionId);
      return true;
    }
  );
  handleTrusted(
    'pty:archive-session',
    (_event, entry: Omit<ClosedSessionEntry, 'closedAt'>) => {
      const live = ptySessions
        .list()
        .some(
          item =>
            item.durableSessionId === entry.durableSessionId && !item.exited
        );
      if (live) throw new Error('cannot archive a running session');
      const stamped = closedLedger.add(entry);
      // without this, rehydration resurrects the closed tab from the
      // leftover exited record
      ptySessions.forgetExited(entry.durableSessionId);
      return stamped;
    }
  );
  handleTrusted('pty:closed-sessions', () => closedLedger.list());
  handleTrusted('pty:reopen-session', (_event, durableSessionId: string) =>
    closedLedger.take(durableSessionId)
  );
  handleTrusted('pty:rename', (_event, id: string, title: string) => {
    ptySessions.rename(id, title);
  });
  handleTrusted('pty:list', () =>
    ptySessions.list().map(s => ({
      ...s,
      contextSummary: contextSummarizer.getSummary(s.durableSessionId),
      attention: attentionMonitor.get(s.id),
      engaged: attentionMonitor.isEngaged(s.id),
      working: attentionMonitor.isWorking(s.id),
    }))
  );
  handleTrusted('pty:buffer', (_event, id: string) => ptySessions.buffer(id));
  handleTrusted('pty:buffer-snapshot', (_event, id: string) =>
    ptySessions.bufferSnapshot(id)
  );
  handleTrusted('pty:buffer-since', (_event, id: string, cursor: number) => ({
    ...ptySessions.bufferSince(id, cursor),
    cursor: ptySessions.bufferCursor(id),
  }));
  handleTrusted('pty:retained-history', (_event, durableSessionId: string) =>
    ptySessions.retainedHistory(durableSessionId)
  );
  // read-only clipboard for the composer (D24 image paste): an image
  // saves to a temp file (same lifecycle as terminal pastes), text
  // returns as-is — nothing is written to any PTY
  handleTrusted('pty:clipboard-read', async () => {
    const result = await clipboardInput();
    return result.kind === 'image'
      ? { kind: 'image' as const, path: result.path ?? null }
      : { kind: result.kind, text: result.input };
  });
  handleTrusted('pty:paste-clipboard', async (_event, id: string) => {
    const payload = await clipboardInput();
    if (payload.input) ptySessions.write(id, payload.input);
    return { kind: payload.kind, path: payload.path };
  });
  handleTrusted('pty:copy-text', (_event, text: string) => {
    if (typeof text !== 'string' || text.length > 4_000_000) {
      throw new Error('Invalid clipboard text');
    }
    writeClipboardText(text);
  });
  handleTrusted('pty:open-external', async (_event, rawUrl: string) => {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Only HTTP(S) links can open externally');
    }
    await shell.openExternal(url.toString());
  });
  handleTrusted(
    'pty:open-path',
    async (
      _event,
      rawPath: string,
      cwd: string,
      options?: { contain?: boolean }
    ) => {
      if (!rawPath || rawPath.includes('\0') || rawPath.length > 4096) {
        throw new Error('Invalid local path');
      }
      // `contain` = the path came from UNTRUSTED repo content (roadmap
      // `Project doc:` bullets). Such a path must stay inside the project:
      // no home expansion, no absolute paths, no `..` escape, and — after
      // symlink resolution — the real target must sit under the real cwd.
      // Otherwise a cloned repo could point a chip at ~/x.command and have
      // the operator's click launch it. Terminal ⌘-click keeps its existing
      // uncontained behavior (the operator clicked a literal path).
      if (options?.contain) {
        if (!isRepoRelativePath(rawPath)) {
          throw new Error('Path must be inside the project');
        }
        const root = await fs.promises.realpath(cwd);
        const realTarget = await fs.promises.realpath(
          path.resolve(root, rawPath)
        );
        const resolved = resolveContainedPath(root, realTarget);
        if (!resolved) throw new Error('Path escapes the project');
        const stat = await fs.promises.stat(resolved);
        if (!stat.isFile() && !stat.isDirectory())
          throw new Error('Unsupported path');
        const error = await shell.openPath(resolved);
        if (error) throw new Error(error);
        return;
      }
      const expanded = rawPath.startsWith('~/')
        ? path.join(os.homedir(), rawPath.slice(2))
        : rawPath;
      const resolved = path.resolve(cwd, expanded);
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile() && !stat.isDirectory())
        throw new Error('Unsupported path');
      const error = await shell.openPath(resolved);
      if (error) throw new Error(error);
    }
  );
  handleTrusted(
    'pty:list-resume-candidates',
    (_event, harness: PtyCreateOptions['harness'], cwd: string) =>
      listResumeCandidates(harness, cwd)
  );
  handleTrusted('pty:list-recent-conversations', (_event, cwd: string) =>
    conversationCatalog.list(cwd)
  );
  handleTrusted(
    'pty:enrich-recent-conversations',
    (_event, cwd: string, accessToken: string) =>
      conversationCatalog.enrich(cwd, accessToken)
  );

  // one-gesture worktrees: <repo>-wt/<branch> sibling container
  handleTrusted(
    'pty:worktree',
    async (_event, repoDir: string, branch: string) => {
      try {
        return {
          ok: true as const,
          path: await createWorktree(repoDir, branch),
        };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // workspace layout persistence (renderer-owned shape)
  handleTrusted('workspace:load', () => loadWorkspace());
  handleTrusted('workspace:save', async (_event, state: unknown) => {
    await saveWorkspace(state);
    broadcast('workspace:changed', state);
  });
  handleTrusted('workspace:recovery', () => ({ previousRunInterrupted }));

  // user settings (S3): userData/settings.json — e.g. the terminal font
  handleTrusted('settings:get', () => loadSettings());
  handleTrusted(
    'settings:set-attention-notifications',
    (_event, enabled: boolean) => {
      if (typeof enabled !== 'boolean')
        throw new Error('Invalid notification setting');
      const settings = setAttentionNotifications(enabled);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted('settings:set-dock-badge', (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean')
      throw new Error('Invalid dock badge setting');
    const settings = setDockBadge(enabled);
    // apply immediately: turning the badge off must clear it right now, and
    // turning it on must reflect any attention already waiting
    if (app.dock) {
      const count = attentionMonitor.count();
      app.dock.setBadge(enabled && count > 0 ? String(count) : '');
    }
    broadcast('settings:changed', settings);
    return settings;
  });
  handleTrusted(
    'settings:record-agent-source-use',
    (_event, projectDir: string, source: string, usedAt: number) => {
      const settings = recordAgentSourceUse(projectDir, source, usedAt);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted(
    'settings:set-agent-permission-mode',
    (_event, projectDir: string, source: string, permissionMode: string) => {
      const settings = setAgentPermissionMode(
        projectDir,
        source,
        permissionMode as import('./settings-store').AgentPermissionMode
      );
      broadcast('settings:changed', settings);
      return settings;
    }
  );
}

/** app-quit cleanup: never leave orphan shells behind */
export async function disposePty(): Promise<void> {
  contextSummarizer.stop();
  attentionMonitor.stop();
  await cleanupClipboardImages();
}
