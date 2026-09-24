import { createSessionPauser } from './pty/session-pause';
import { readSessionCloneContext } from './pty/session-clone-context';
import { BrowserWindow, Notification, app, nativeTheme, shell } from 'electron';
import { handleBounded } from './ipc-arguments';
import { handleTrusted } from './ipc-security';
import { createSessionModelChanger } from './pty/session-model-change';
import { resolveContainedPath, isRepoRelativePath } from './contained-path';
import { ptySessions } from './pty/session-manager';
import { defaultShell } from './pty/session-manager';
import { listAgentModels, setAgentModelCatalogCache } from './pty/agent-models';
import { AgentModelCatalogCache } from './pty/agent-model-catalog-cache';
import {
  agentSourceLaunchReadiness,
  inspectAgentSources,
  inspectOpencodeLaunchEnvironment,
} from './pty/agent-source-registry';
import { ContextSummarizer } from './pty/context-summarizer';
import {
  createDiagnosticsLog,
  type DiagnosticRecorder,
} from './diagnostics-log';
import { attentionMonitor } from './pty/attention-monitor';
import { harnessEventChannel } from './harness-events/channel';
import { delegationMonitor } from './harness-events/delegation-monitor';
import { codexDelegationObserver } from './harness-events/codex-app-server';
import { wireReportedTurnTruth } from './harness-events/turn-truth';
import { ClosedSessionLedger } from './pty/closed-session-ledger';
import { createWorktree, expandTilde } from './pty/project-resolve';
import {
  loadWorkspace,
  saveWorkspace,
  recoverWorkspace,
  workspaceStorageRecovery,
} from './workspace-store';
import { hydrateGoalVisual, retainGoalVisual } from './goal-visual-store';
import {
  loadSettings,
  deleteLaunchConfiguration,
  recordAgentSourceUse,
  recordLaunchConfigurationSuccess,
  renameLaunchConfiguration,
  saveNamedLaunchConfiguration,
  setAgentPermissionMode,
  setAttentionNotifications,
  setDockBadge,
  setGoalVisualsEnabled,
  setKeyboardShortcutOverrides,
  setHostedContextLabels,
  setHostedConversationSummaries,
  setLaunchConfigurationPinned,
  setOperatorAutoPublish,
  recordOperatorProfilePublicationState,
  setReentryRecapEnabled,
  setAppearancePreferences,
} from './settings-store';
import { applyNativeAppearancePreference } from './appearance';
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
import { broadcastToWindows, pushToRenderer } from './window-broadcast';
import { isAgentHarness, type AgentPermissionMode } from '@exawatt/core';
import type { DistributionContractV2 } from '@exawatt/core/distribution';
import type {
  ClosedSessionEntry,
  DesktopBridgePush,
  DesktopBridgePushChannel,
  PtyCreateOptions,
  PtySessionInfo,
  PtySessionRecord,
  SessionModelChange,
} from '@exawatt/core/desktop-bridge';

let activeContextSummarizer: ContextSummarizer | null = null;

// Engines and their model lists change on the order of days, but the composer
// re-probed all of them on every entry (ENG-016 D49). The cache is installed at
// module load: main.ts overrides userData before importing any IPC module, so
// `app.getPath` is already the right directory here.
setAgentModelCatalogCache(
  new AgentModelCatalogCache(() => app.getPath('userData'))
);

/**
 * IPC surface for PTY sessions (decision 0005). Invocations are namespaced
 * `pty:*`; output/exit stream to every window via `pty:data` / `pty:exit`
 * (single-window app today; cheap to scope per-window later).
 */
export function registerPtyIPC(
  distribution: DistributionContractV2,
  previousRunInterrupted = false,
  /** `logs/main.jsonl`; a no-op keeps every diagnostic from being load-bearing */
  diagnostics: DiagnosticRecorder = () => {}
): void {
  const contextSummarizer = new ContextSummarizer({ distribution });
  activeContextSummarizer = contextSummarizer;
  const broadcast = <C extends DesktopBridgePushChannel>(
    channel: C,
    payload: DesktopBridgePush<C>
  ) => {
    broadcastToWindows<DesktopBridgePushChannel>(
      BrowserWindow.getAllWindows(),
      channel,
      payload
    );
  };
  const closedLedger = new ClosedSessionLedger(
    path.join(app.getPath('userData'), 'closed-sessions.json'),
    durableSessionId => ptySessions.purgeHistory(durableSessionId)
  );
  const publishClosedSessionCount = () =>
    broadcast('pty:closed-sessions-changed', closedLedger.list().length);
  const reapClosedSessions = async () => {
    try {
      const reaped = await closedLedger.reap();
      if (reaped > 0) publishClosedSessionCount();
    } catch (error) {
      diagnostics('closed-sessions.reap-failed', {
        error: error instanceof Error ? error.message : 'Store unavailable',
      });
    }
  };
  void reapClosedSessions();
  const reapTimer = setInterval(
    () => void reapClosedSessions(),
    6 * 60 * 60 * 1000
  );
  reapTimer.unref?.();
  const conversationCatalog = new RecentConversationCatalog({
    distribution,
    cacheFile: path.join(
      app.getPath('userData'),
      'conversation-summary-cache.json'
    ),
    projectSessions: () => closedLedger.list(),
    openCodeShell: defaultShell,
    hostedSummariesEnabled: () =>
      loadSettings().conversationSummaries?.hosted !== false,
  });
  const nativeNotifications = new Map<string, Notification>();

  ptySessions.on(
    'data',
    (id: string, data: string, cursor: number, durableSessionId: string) => {
      broadcast('pty:data', { id, durableSessionId, data, cursor });
    }
  );
  ptySessions.on(
    'exit',
    (
      id: string,
      exitCode: number,
      durableSessionId: string,
      exitSignal: string | null
    ) => {
      broadcast('pty:exit', { id, durableSessionId, exitCode, exitSignal });
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
  // Hosted-feature switches are read once at boot and again on every change;
  // absent means the disclosed default (ENG-030 OS1.5, decision `0031`).
  contextSummarizer.setContextLabelsEnabled(
    loadSettings().contextLabels?.hosted !== false
  );
  contextSummarizer.setGoalVisualsEnabled(
    loadSettings().goalVisuals?.enabled !== false
  );
  contextSummarizer.setReentryRecapEnabled(
    loadSettings().reentryRecap?.enabled !== false
  );
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
  contextSummarizer.on('context', (durableSessionId, summary) => {
    broadcast('pty:context', { durableSessionId, summary });
  });
  contextSummarizer.on('goal-visual', (durableSessionId, visual) => {
    // The pixels land in the content store as soon as they exist; the
    // layout only ever persists the reference (BUG-031).
    void retainGoalVisual(visual).catch(() => undefined);
    broadcast('pty:goal-visual', { durableSessionId, visual });
  });
  contextSummarizer.on('recap', recap => {
    broadcast('pty:recap', recap);
  });

  // delegation (ENG-023 D1): sources that report their own delegated work
  // stream it here, so "the team is working" stops depending on byte
  // quiescence. A source without the capability simply never publishes.
  delegationMonitor.attach(harnessEventChannel, ptySessions);
  codexDelegationObserver.attach(ptySessions, delegationMonitor);
  // Reported truth and inferred truth correct each other through ONE wiring
  // (D4/D7), shared with the turn-truth pipeline contract so what is tested is
  // what ships. A census that expires by inference leaves evidence in
  // `logs/main.jsonl` (BUG-081).
  wireReportedTurnTruth({
    attention: attentionMonitor,
    delegation: delegationMonitor,
    record: diagnostics,
    harnessOf: id =>
      ptySessions.list().find(session => session.id === id)?.harness ?? null,
  });
  delegationMonitor.on('delegation', (id, delegation) => {
    broadcast('pty:delegation', { id, delegation });
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
    const settings = loadSettings();
    const appearance = applyNativeAppearancePreference(
      settings.appearance,
      nativeTheme,
      {
        safeTheme: process.argv.includes('--safe-theme'),
      }
    );
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed())
        win.setBackgroundColor(appearance.bootstrap.background);
    }
    broadcast('settings:changed', settings);
  });
  app.on('browser-window-blur', () => {
    attentionMonitor.setWindowFocused(false);
    contextSummarizer.setWindowFocused(false);
  });
  // working/quiet transitions (D18): the tab strip's live status glyphs
  attentionMonitor.on('activity', (id, working) => {
    broadcast('pty:activity', { id, working });
  });
  // started/unstarted truth (D22) — fires once per session, first work given
  attentionMonitor.on('engaged', id => {
    broadcast('pty:engaged', { id });
  });
  attentionMonitor.on('attention', (id, attention) => {
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
    if (
      !shouldDeliverNativeNotification(
        loadSettings().notifications?.attention ?? false,
        BrowserWindow.getFocusedWindow() !== null,
        attention
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
      pushToRenderer(win.webContents, 'pty:notification-click', { id });
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
  handleBounded('pty:create', async (_event, options) => {
    try {
      if (options.harness !== 'shell') {
        const shellPath = await defaultShell();
        const registry = await inspectAgentSources(shellPath, 'launch', false);
        const readiness = agentSourceLaunchReadiness(registry, options.harness);
        const source = registry.sources.find(
          candidate => candidate.harness === options.harness
        );
        const homeOnlyOpencodeSeamError =
          options.harness === 'opencode' &&
          source?.facts.reachability.value ===
            'Launch configuration seam occupied';
        // Only an OBSERVED negative refuses a launch (BUG-063). When a probe
        // never answered, the launch attempt is itself the better probe and
        // the harness speaks for itself in the pane, which is what the
        // operator got by clicking Resume a second time.
        if (
          readiness.known &&
          readiness.blocked &&
          !homeOnlyOpencodeSeamError
        ) {
          throw new Error(readiness.message);
        }
        if (options.harness === 'opencode') {
          const launchCwd =
            expandTilde((options.cwd ?? '').trim()) || os.homedir();
          const launchEnvironment = await inspectOpencodeLaunchEnvironment(
            shellPath,
            launchCwd
          );
          if (launchEnvironment === 'occupied') {
            throw new Error(
              'OpenCode launch cannot replace the non-empty OPENCODE_CONFIG_CONTENT value active in this workspace. Remove it from the workspace shell environment and try again.'
            );
          }
          // 'unknown' means the seam check never came back. Same rule: an
          // unanswered probe does not refuse the launch.
        }
      }
      const session = await ptySessions.create(options);
      // the composer's task is the goal — show it as the subtitle instantly;
      // a resume re-anchors the goal persisted with the layout (D21)
      // Restore durable truth before considering zero-network launch copy. A
      // resume must not let an incidental launch prompt replace the last good
      // context label.
      contextSummarizer.restore(
        session.durableSessionId,
        options.restoredSubtitle
      );
      contextSummarizer.seedFromTask(
        session.durableSessionId,
        options.initialPrompt
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
  const pauseSessions = createSessionPauser({
    session: durableSessionId =>
      ptySessions
        .list()
        .find(session => session.durableSessionId === durableSessionId),
    active: id =>
      attentionMonitor.isWorking(id) ||
      delegationMonitor.isBusy(id) ||
      !!delegationMonitor.get(id)?.blockedOn ||
      (!!attentionMonitor.get(id) &&
        attentionMonitor.get(id)?.kind !== 'turn-end'),
    prepare: id => ptySessions.prepareSessionPause(id),
  });
  handleTrusted(
    'pty:pause-sessions',
    (_event, ids: string[], confirmed?: boolean) =>
      pauseSessions(ids, confirmed)
  );
  const changeModel = createSessionModelChanger({
    session: id => ptySessions.list().find(session => session.id === id),
    available: id =>
      !attentionMonitor.isWorking(id) &&
      !delegationMonitor.isBusy(id) &&
      !delegationMonitor.get(id)?.blockedOn &&
      (!attentionMonitor.get(id) ||
        attentionMonitor.get(id)?.kind === 'turn-end'),
    catalog: async session => {
      if (!isAgentHarness(session.harness)) {
        throw new Error('Unsupported Agent Source');
      }
      return listAgentModels(
        session.harness,
        session.cwd,
        await defaultShell()
      );
    },
    restart: async (id, choice) => {
      const session = await ptySessions.changeModel(id, choice);
      attentionMonitor.noteEngaged(session.id);
      return session;
    },
  });
  handleTrusted(
    'pty:change-model',
    async (_event, id: string, choice: SessionModelChange) => {
      try {
        return { ok: true as const, session: await changeModel(id, choice) };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
  handleBounded(
    'pty:list-agent-models',
    async (_event, harness, cwd, refresh) =>
      listAgentModels(harness, cwd, await defaultShell(), refresh)
  );
  handleTrusted(
    'pty:write',
    (_event, id: string, data: string, operatorEngaged = false) => {
      // Engagement and write are ONE ordered main-process operation. Keeping
      // these as separate renderer invokes let a fast PTY echo arrive while a
      // finished turn was still latched, hiding the legitimate next turn.
      if (operatorEngaged) {
        contextSummarizer.noteInput(id, data);
        attentionMonitor.noteEngaged(id);
      }
      ptySessions.write(id, data);
      // Input clears attention only when the session is actually watched:
      // writes also carry xterm auto-replies from hidden panes.
      attentionMonitor.noteInput(id);
    }
  );
  // Compatibility path for clients that signal engagement separately. The
  // workspace sends its human marker atomically on pty:write to avoid races.
  handleTrusted('pty:engage', (_event, id: string) => {
    contextSummarizer.noteInput(id);
    // the first human keystroke is work given — started truth (D22)
    attentionMonitor.noteEngaged(id);
  });
  handleBounded('pty:set-context-auth', (_event, accessToken) => {
    contextSummarizer.setAccessToken(accessToken);
  });
  handleBounded('pty:correct-context', (_event, durableSessionId, label) =>
    contextSummarizer.correct(durableSessionId, label)
  );
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
    'pty:restore-goal-visual',
    async (_event, durableSessionId: string, visual: unknown) => {
      // The renderer hands back the layout's REFERENCE. Main resolves it to
      // pixels from the content store before the summarizer validates it —
      // `validGoalVisual` refuses a `ready` visual with no data URL, so a
      // reference restored raw would silently drop the Session's identity.
      const hydrated = await hydrateGoalVisual(visual);
      if (!hydrated) return null;
      return contextSummarizer.restoreGoalVisual(durableSessionId, hydrated);
    }
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
      await ptySessions.closeSession(durableSessionId, discard);
      return true;
    }
  );
  handleTrusted(
    'pty:archive-session',
    async (_event, entry: Omit<ClosedSessionEntry, 'closedAt'>) => {
      const runtime = ptySessions
        .list()
        .find(item => item.durableSessionId === entry.durableSessionId);
      if (runtime && !runtime.exited) {
        throw new Error('cannot archive a running session');
      }
      if (runtime) await ptySessions.settleProviderIdentity(runtime.id);
      const durableIdentity = ptySessions.durableProviderIdentity(
        entry.durableSessionId,
        entry.harness
      );
      const stamped = closedLedger.add(
        durableIdentity
          ? { ...entry, harnessSessionId: durableIdentity }
          : entry
      );
      conversationCatalog.invalidate();
      // without this, rehydration resurrects the closed tab from the
      // leftover exited record
      ptySessions.forgetExited(entry.durableSessionId);
      publishClosedSessionCount();
      return stamped;
    }
  );
  handleTrusted('pty:closed-sessions', () => closedLedger.list());
  handleTrusted('pty:reopen-session', (_event, durableSessionId: string) => {
    const entry = closedLedger.take(durableSessionId);
    if (entry) {
      conversationCatalog.invalidate();
      publishClosedSessionCount();
    }
    return entry;
  });
  handleTrusted('pty:rename', (_event, id: string, title: string) => {
    ptySessions.rename(id, title);
  });
  /** One `pty:list` row: what the PTY owner knows, plus main's live
   *  observations of the Session, so a reload or a late attach sees them at
   *  once instead of waiting for the next push. */
  const sessionInfo = (record: PtySessionRecord): PtySessionInfo => ({
    ...record,
    contextSummary: contextSummarizer.getSummary(record.durableSessionId),
    goalVisual: contextSummarizer.getGoalVisual(record.durableSessionId),
    attention: attentionMonitor.get(record.id),
    engaged: attentionMonitor.isEngaged(record.id),
    working: attentionMonitor.isWorking(record.id),
    // Ride-along so a reload or late attach sees live children immediately
    // instead of waiting for the next delegation change (ENG-023).
    delegation: delegationMonitor.getLive(record.id),
  });
  handleTrusted('pty:list', () => ptySessions.list().map(sessionInfo));
  handleTrusted('pty:buffer', (_event, id: string) => ptySessions.buffer(id));
  handleTrusted('pty:buffer-snapshot', (_event, id: string) =>
    ptySessions.bufferSnapshot(id)
  );
  handleTrusted('pty:buffer-since', (_event, id: string, cursor: number) => ({
    ...ptySessions.bufferSince(id, cursor),
    cursor: ptySessions.bufferCursor(id),
  }));
  handleBounded('pty:clone-context', async (_event, durableSessionId) => {
    const runtime = ptySessions
      .list()
      .find(row => row.durableSessionId === durableSessionId);
    const identity =
      runtime ??
      ptySessions
        .listProviderIdentities()
        .find(row => row.durableSessionId === durableSessionId);
    if (!identity || identity.harness === 'shell')
      throw new Error('The original Agent Session is unavailable.');
    return readSessionCloneContext(identity);
  });
  // The paused-Agent record's read: O(1), no transcript (incident 0008).
  handleTrusted(
    'pty:retained-history-meta',
    (_event, durableSessionId: string) =>
      ptySessions.retainedHistoryMeta(durableSessionId)
  );
  // Explicitly requested, rendered in main, bounded before it crosses IPC.
  handleTrusted(
    'pty:retained-transcript',
    (_event, durableSessionId: string, maxLines?: number) =>
      ptySessions.retainedTranscript(
        durableSessionId,
        typeof maxLines === 'number' && maxLines > 0
          ? Math.min(maxLines, 20_000)
          : 2_000
      )
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
    if (payload.input) {
      // Paste is operator input too. Open a finished turn before writing so
      // even a synchronous echo cannot be mistaken for passive redraw data.
      contextSummarizer.noteInput(id, payload.input);
      attentionMonitor.noteEngaged(id);
      ptySessions.write(id, payload.input);
      attentionMonitor.noteInput(id);
    }
    return { kind: payload.kind, path: payload.path };
  });
  handleBounded('pty:copy-text', (_event, text) => {
    writeClipboardText(text);
  });
  handleTrusted('pty:open-external', async (_event, rawUrl: string) => {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Only HTTP(S) links can open externally');
    }
    await shell.openExternal(url.toString());
  });
  handleBounded('pty:open-path', async (_event, rawPath, cwd, options) => {
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
  });
  handleTrusted(
    'pty:list-resume-candidates',
    async (_event, harness: PtyCreateOptions['harness'], cwd: string) =>
      listResumeCandidates(harness, cwd, undefined, await defaultShell())
  );
  handleBounded('pty:reconcile-resume-identities', (_event, hints) =>
    ptySessions.reconcileResumeIdentities(hints)
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
  handleBounded('pty:worktree', async (_event, repoDir, branch) => {
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
  });

  // workspace layout persistence (renderer-owned shape)
  handleTrusted('workspace:load', () => loadWorkspace());
  handleTrusted('workspace:save', async (_event, state: unknown) => {
    await saveWorkspace(state);
    broadcast('workspace:changed', state);
  });
  handleTrusted('workspace:recovery', () => ({ previousRunInterrupted }));
  handleTrusted('workspace:storage-recovery', () => workspaceStorageRecovery());
  handleTrusted('workspace:retry-recovery', () => recoverWorkspace('retry'));
  handleTrusted('workspace:reveal-recovery', () => {
    const recovery = workspaceStorageRecovery();
    const file = recovery.recoveryFile ?? recovery.originalFile;
    if (file) shell.showItemInFolder(file);
  });

  // user settings (S3): userData/settings.json — e.g. the terminal font
  handleTrusted('settings:get', () => loadSettings());
  handleTrusted('settings:set-appearance', (_event, appearance: unknown) => {
    const settings = setAppearancePreferences(appearance);
    const resolved = applyNativeAppearancePreference(
      settings.appearance,
      nativeTheme,
      {
        safeTheme: process.argv.includes('--safe-theme'),
      }
    );
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed())
        win.setBackgroundColor(resolved.bootstrap.background);
    }
    broadcast('settings:changed', settings);
    return settings;
  });
  handleBounded('settings:set-attention-notifications', (_event, enabled) => {
    const settings = setAttentionNotifications(enabled);
    broadcast('settings:changed', settings);
    return settings;
  });
  handleBounded('settings:set-dock-badge', (_event, enabled) => {
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
  handleBounded('settings:set-hosted-context-labels', (_event, enabled) => {
    const settings = setHostedContextLabels(enabled);
    // Applied before the write is announced: no request may be constructed
    // after the operator has switched the feature off.
    contextSummarizer.setContextLabelsEnabled(enabled);
    broadcast('settings:changed', settings);
    return settings;
  });
  handleBounded(
    'settings:set-hosted-conversation-summaries',
    (_event, enabled) => {
      const settings = setHostedConversationSummaries(enabled);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleBounded('settings:set-goal-visuals', (_event, enabled) => {
    const settings = setGoalVisualsEnabled(enabled);
    contextSummarizer.setGoalVisualsEnabled(enabled);
    broadcast('settings:changed', settings);
    return settings;
  });
  // Per-device keyboard overrides (BUG-044). No broadcast: the writing
  // renderer already holds the authoritative registry, and a `settings:changed`
  // round trip would reload bindings mid-edit in the surface being edited.
  handleTrusted(
    'settings:set-keyboard-shortcuts',
    (_event, overrides: unknown) => setKeyboardShortcutOverrides(overrides)
  );
  handleBounded('settings:set-reentry-recap', (_event, enabled) => {
    const settings = setReentryRecapEnabled(enabled);
    // Applied before the write is announced: no scrollback may be read and no
    // recap process spawned after the operator has switched the recap off.
    contextSummarizer.setReentryRecapEnabled(enabled);
    broadcast('settings:changed', settings);
    return settings;
  });
  handleBounded('settings:set-operator-auto-publish', (_event, enabled) => {
    // No main-side enforcement point exists on purpose: uploads only ever
    // leave from the renderer's sync path, which re-reads this preference
    // at execution time (ENG-035; decision `0029`). Main persists the
    // choice and announces it.
    const settings = setOperatorAutoPublish(enabled);
    broadcast('settings:changed', settings);
    return settings;
  });
  handleBounded('settings:record-operator-profile-state', (_event, state) => {
    const settings = recordOperatorProfilePublicationState(state);
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
        permissionMode as AgentPermissionMode
      );
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted(
    'settings:record-launch-configuration-success',
    (_event, projectDir: string, target: unknown) => {
      const settings = recordLaunchConfigurationSuccess(projectDir, target);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted(
    'settings:save-named-launch-configuration',
    (_event, configuration: unknown, name: unknown) => {
      const settings = saveNamedLaunchConfiguration(configuration, name);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted(
    'settings:rename-launch-configuration',
    (_event, id: unknown, name: unknown) => {
      const settings = renameLaunchConfiguration(id, name);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted(
    'settings:delete-launch-configuration',
    (_event, id: unknown) => {
      const settings = deleteLaunchConfiguration(id);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
  handleTrusted(
    'settings:set-launch-configuration-pinned',
    (_event, projectDir: string, id: unknown, pinned: unknown) => {
      const settings = setLaunchConfigurationPinned(projectDir, id, pinned);
      broadcast('settings:changed', settings);
      return settings;
    }
  );
}

/** app-quit cleanup: never leave orphan shells behind */
export async function disposePty(): Promise<void> {
  activeContextSummarizer?.stop();
  activeContextSummarizer = null;
  attentionMonitor.stop();
  await cleanupClipboardImages();
}
