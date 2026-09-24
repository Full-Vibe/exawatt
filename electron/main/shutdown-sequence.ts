import type { MessageBoxOptions } from 'electron';
import type { TrustedChannels } from './ipc-table';
import type { PtySessionManager } from './pty/session-manager';
import type {
  LiveProcessCounts,
  ShutdownDependencies,
  ShutdownIntent,
  ShutdownPhase,
  shutdownCopy as ShutdownCopy,
} from './shutdown-coordinator';

/**
 * What quit, restart and update-restart DO, step by step. The order of
 * operations is `ShutdownCoordinator`'s (`shutdown-coordinator.ts`); this
 * module supplies each step: the confirmations, the checkpoint handshake with
 * the renderer that owns workspace state, the ordered cleanup, the failure
 * report, and the pre-bootstrap quit that has no coordinator yet.
 *
 * Every native dialog the sequence can open goes through one seam that names
 * it on the console first (`[shutdown] native dialog: <kind>`), so an
 * automated quit can tell a quit that prompted from a quit that was merely
 * slow (BUG-050).
 */

interface CheckpointWindow {
  isDestroyed(): boolean;
  webContents: {
    id: number;
    send(channel: string, ...args: unknown[]): void;
  };
}

interface BroadcastWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

type CheckpointStage = 'pre-stop' | 'stopped';

export interface CheckpointBroker {
  /** Whether the renderer in this web contents owns mutable workspace state. */
  owns(webContentsId: number): boolean;
  /** The renderer navigated away or went away: it no longer owns the state. */
  release(webContentsId: number): void;
  /** Asks the owning renderer to save; false on refusal or no answer in time. */
  request(
    win: CheckpointWindow,
    intent: ShutdownIntent,
    stage: CheckpointStage
  ): Promise<boolean>;
  channels: TrustedChannels;
}

export function createCheckpointBroker(deps: {
  randomUUID: () => string;
  timeoutMs?: number;
}): CheckpointBroker {
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const pendingCheckpoints = new Map<string, (ok: boolean) => void>();
  const workspaceCheckpointOwners = new Set<number>();

  return {
    owns: id => workspaceCheckpointOwners.has(id),
    release: id => {
      workspaceCheckpointOwners.delete(id);
    },
    request(win, intent, stage) {
      const requestId = deps.randomUUID();
      return new Promise<boolean>(resolve => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          pendingCheckpoints.delete(requestId);
          resolve(ok);
        };
        const timeout = setTimeout(() => finish(false), timeoutMs);
        pendingCheckpoints.set(requestId, finish);
        win.webContents.send('app:checkpoint-request', {
          requestId,
          reason: intent,
          stage,
        });
      });
    },
    channels: {
      'app:set-workspace-checkpoint-owner': (
        event,
        ownsWorkspaceState: boolean
      ) => {
        if (typeof ownsWorkspaceState !== 'boolean') return;
        if (ownsWorkspaceState) workspaceCheckpointOwners.add(event.sender.id);
        else workspaceCheckpointOwners.delete(event.sender.id);
      },
      'app:complete-checkpoint': (_event, requestId: string, ok: boolean) => {
        if (typeof requestId !== 'string' || typeof ok !== 'boolean') return;
        const complete = pendingCheckpoints.get(requestId);
        if (!complete) return;
        pendingCheckpoints.delete(requestId);
        complete(ok);
      },
    },
  };
}

type ShutdownSessions = Pick<
  PtySessionManager,
  | 'list'
  | 'settleProviderIdentities'
  | 'pauseCreates'
  | 'resumeCreates'
  | 'flushHistory'
  | 'stopAll'
>;

export interface ShutdownSequenceDependencies {
  productName: string;
  /** Automation answers for the quit confirmation, consumed in order. */
  testQuitResponses: string[];
  env: NodeJS.ProcessEnv;
  /** Shows a native message box over the main window when there is one. */
  showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>;
  window: () => CheckpointWindow | null;
  allWindows: () => BroadcastWindow[];
  checkpoints: CheckpointBroker;
  workspace: {
    load(): Promise<unknown | null>;
    mergeHarnessIdentities(
      state: unknown,
      harnessIds: ReadonlyMap<string, string>
    ): boolean;
    save(state: unknown): Promise<void>;
  };
  /** Released in this order, each awaited, once every Session has stopped. */
  cleanup: ReadonlyArray<() => Promise<void> | void>;
  finalize: (intent: ShutdownIntent) => void;
  /** For the window-management restart, which is a normal restart. */
  coordinator: () => {
    request(intent: ShutdownIntent): Promise<boolean>;
  } | null;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

export interface ShutdownSequence {
  /** Everything `ShutdownCoordinator` needs, once the Session runtime exists. */
  coordinatorDependencies(runtime: {
    sessions: ShutdownSessions;
    shutdownCopy: typeof ShutdownCopy;
    markClean: () => Promise<void>;
  }): ShutdownDependencies;
  promptWindowManagementRestart(): Promise<void>;
}

export function createShutdownSequence(
  deps: ShutdownSequenceDependencies
): ShutdownSequence {
  const productName = deps.productName;
  const log = deps.log ?? (message => console.info(message));
  const logError =
    deps.logError ?? ((message, error) => console.error(message, error));

  /** The one way the sequence opens a native dialog (BUG-050). */
  async function nativeDialog(
    kind: string,
    options: MessageBoxOptions
  ): Promise<{ response: number }> {
    log(`[shutdown] native dialog: ${kind}`);
    return await deps.showMessageBox(options);
  }

  function broadcastShutdown(
    phase: ShutdownPhase,
    counts: LiveProcessCounts
  ): void {
    for (const win of deps.allWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('app:shutdown-status', { phase, ...counts });
      }
    }
  }

  /**
   * Operator-initiated explanation for incident 0001: after long uptime macOS
   * can stop vending Exawatt's accessibility element, and every AX-driven
   * window manager (Divvy, Rectangle, Hammerspoon) then resolves the app to
   * zero windows and silently does nothing. Exawatt CANNOT detect this —
   * self-inspection returns kAXErrorAPIDisabled without Accessibility
   * permission, and asking the operator to grant that for one degraded case is
   * not worth it. So the remedy is named here rather than detected, and routed
   * through the normal shutdown coordinator so Sessions and history checkpoint
   * and rehydrate.
   */
  async function promptWindowManagementRestart(): Promise<void> {
    const message = "Window management isn't working?";
    const result = await nativeDialog('window-management-restart', {
      type: 'info',
      title: message,
      message,
      detail: `After ${productName} has been open a long time, macOS can stop sharing its window with tools like Divvy, Rectangle, and Hammerspoon, so their shortcuts do nothing and you hear an error sound. This is a known macOS issue with Electron apps that ${productName} cannot detect or repair on its own.\n\nRestarting fixes it. Projects, Sessions, and terminal history are saved and restored; running agents stop and can be resumed afterwards.`,
      buttons: ['Cancel', `Restart ${productName}`],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) await deps.coordinator()?.request('restart');
  }

  async function confirmWithoutCheckpoint(
    intent: ShutdownIntent
  ): Promise<boolean> {
    if (
      deps.env.EXAWATT_TEST === '1' &&
      deps.env.EXAWATT_TEST_CHECKPOINT_FAILURE === 'confirm'
    ) {
      return true;
    }
    const result = await nativeDialog('checkpoint-failed', {
      type: 'warning',
      title: `${productName} couldn't save the latest Session state`,
      message: `${productName} couldn't save the latest Session state`,
      detail:
        'Quitting now may lose recent layout changes. Terminal history already checkpointed by the main process will remain.',
      buttons: ['Cancel', intent === 'quit' ? 'Quit Anyway' : 'Restart Anyway'],
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  }

  async function cleanupForExit(): Promise<void> {
    for (const step of deps.cleanup) await step();
  }

  async function reportShutdownFailure(error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    await nativeDialog('stop-failed', {
      type: 'error',
      title: `${productName} couldn't stop every Session`,
      message: `${productName} couldn't stop every Session`,
      detail: `${detail.slice(0, 400)}\n\n${productName} will remain open. Check the affected Session before quitting again.`,
      buttons: ['OK'],
      noLink: true,
    });
  }

  function coordinatorDependencies(runtime: {
    sessions: ShutdownSessions;
    shutdownCopy: typeof ShutdownCopy;
    markClean: () => Promise<void>;
  }): ShutdownDependencies {
    const ptySessions = runtime.sessions;

    async function confirmShutdown(
      intent: ShutdownIntent,
      counts: LiveProcessCounts
    ): Promise<boolean> {
      if (deps.env.EXAWATT_TEST === '1') {
        const response =
          deps.testQuitResponses.shift() ?? deps.env.EXAWATT_TEST_QUIT_RESPONSE;
        if (response === 'cancel') return false;
        return true;
      }
      const copy = runtime.shutdownCopy(intent, counts, productName);
      const result = await nativeDialog('confirm-quit', {
        type: 'warning',
        title: copy.title,
        message: copy.title,
        detail:
          intent === 'update'
            ? `${copy.detail} The downloaded update will then install and reopen ${productName}.`
            : intent === 'restart'
              ? `${copy.detail} ${productName} reopens automatically.`
              : copy.detail,
        buttons: [
          'Cancel',
          intent === 'quit' ? 'Quit and Stop' : 'Restart and Stop',
        ],
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    }

    /**
     * When no renderer owns mutable workspace state (quit from /settings or the
     * Fleet altitude, or a non-personal tenant Workspace has the shell
     * unmounted behind the ENG-027 scope gate), the persisted LAYOUT is
     * authoritative — but harness identities settled after the shell unmounted
     * still need to land. Merge them into the store in-process so stale harness
     * session ids cannot survive a quit that never reaches the renderer
     * checkpoint.
     */
    async function refreshPersistedHarnessIdentities(): Promise<boolean> {
      try {
        const live = new Map<string, string>();
        for (const session of ptySessions.list()) {
          if (session.harnessSessionId) {
            live.set(session.durableSessionId, session.harnessSessionId);
          }
        }
        if (live.size === 0) return true;
        const state = await deps.workspace.load();
        if (!deps.workspace.mergeHarnessIdentities(state, live)) return true;
        await deps.workspace.save(state);
        return true;
      } catch (error) {
        logError('[shutdown] harness identity refresh failed', error);
        return false;
      }
    }

    async function checkpointRenderer(
      intent: ShutdownIntent,
      stage: CheckpointStage
    ): Promise<boolean> {
      if (stage === 'pre-stop') await ptySessions.settleProviderIdentities();
      const win = deps.window();
      // Workspace state is mutable only while the workspace hook is mounted;
      // otherwise the store on disk holds the layout and main lands the
      // settled harness identities itself.
      if (!win || win.isDestroyed()) return refreshPersistedHarnessIdentities();
      if (!deps.checkpoints.owns(win.webContents.id)) {
        return refreshPersistedHarnessIdentities();
      }
      return await deps.checkpoints.request(win, intent, stage);
    }

    return {
      countLive: () => {
        const live = ptySessions.list().filter(session => !session.exited);
        return {
          agents: live.filter(session => session.harness !== 'shell').length,
          shells: live.filter(session => session.harness === 'shell').length,
        };
      },
      confirm: confirmShutdown,
      checkpoint: checkpointRenderer,
      confirmWithoutCheckpoint,
      pauseNewWork: () => ptySessions.pauseCreates(),
      resumeNewWork: () => ptySessions.resumeCreates(),
      flushHistory: () => ptySessions.flushHistory(),
      stopProcesses: () => ptySessions.stopAll(),
      markClean: runtime.markClean,
      cleanup: cleanupForExit,
      failure: reportShutdownFailure,
      finalize: deps.finalize,
      status: broadcastShutdown,
    };
  }

  return { coordinatorDependencies, promptWindowManagementRestart };
}

/**
 * `before-quit`. Before the command runtime exists there is no coordinator,
 * so a quit stops the renderer server and quits once; after it exists, every
 * quit goes through the coordinator, which lets the final exit through.
 */
export function createBeforeQuitHandler(deps: {
  /** Courtesy flushes that must never delay a quit. */
  disposeServices: () => void;
  coordinator: () => {
    readonly allowsFinalExit: boolean;
    request(intent: ShutdownIntent): Promise<boolean>;
  } | null;
  stopRendererServer: () => Promise<void>;
  quit: () => void;
  logError?: (message: string, error: unknown) => void;
}): (event: { preventDefault(): void }) => void {
  const logError =
    deps.logError ?? ((message, error) => console.error(message, error));
  let bootstrapExitInProgress = false;
  return event => {
    deps.disposeServices();
    const shutdownCoordinator = deps.coordinator();
    if (!shutdownCoordinator) {
      if (bootstrapExitInProgress) return;
      event.preventDefault();
      bootstrapExitInProgress = true;
      void deps
        .stopRendererServer()
        .catch(error => logError('[shutdown] renderer stop failed', error))
        .finally(() => deps.quit());
      return;
    }
    if (shutdownCoordinator.allowsFinalExit) return;
    event.preventDefault();
    void shutdownCoordinator.request('quit');
  };
}
