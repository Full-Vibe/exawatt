import type { IpcMainEvent, MessageBoxOptions } from 'electron';
import type { TrustedChannels } from './ipc-table';
import type { PtySessionManager } from './pty/session-manager';
import type {
  ClosingStep,
  LiveProcessCounts,
  ShutdownDependencies,
  shutdownCopy as ShutdownCopy,
} from './shutdown-coordinator';
import { broadcastToWindows, pushToRenderer } from './window-broadcast';
import type {
  HeldOperatorState,
  ShutdownIntent,
  ShutdownStatus,
} from '@exawatt/core/desktop-bridge';

/**
 * What quit, restart and update-restart DO, step by step. The order of
 * operations and every deadline are `ShutdownCoordinator`'s
 * (`shutdown-coordinator.ts`); this module supplies each step: the
 * confirmations, the checkpoint handshake with the renderer that owns
 * workspace state, the held-state capture any window answers, the closing
 * steps, the handoff, the failure report, the lifecycle's IPC, and the
 * pre-bootstrap quit that has no coordinator yet.
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

interface CheckpointBroker {
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
  /** Asks a window for what its holders captured (BUG-260); null on no
   *  answer in time, or an answer too large to keep. */
  requestHeld(win: CheckpointWindow): Promise<HeldOperatorState | null>;
  channels: TrustedChannels;
}

/** Held state is a position and a draft or two, never a document. */
export const MAX_HELD_STATE_BYTES = 64 * 1024;

function heldStateOf(value: unknown): HeldOperatorState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value).length <= MAX_HELD_STATE_BYTES
      ? (value as HeldOperatorState)
      : null;
  } catch {
    return null;
  }
}

export function createCheckpointBroker(deps: {
  randomUUID: () => string;
  timeoutMs?: number;
}): CheckpointBroker {
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const pendingCheckpoints = new Map<string, (ok: boolean) => void>();
  const pendingHeld = new Map<
    string,
    (held: HeldOperatorState | null) => void
  >();
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
        pushToRenderer(win.webContents, 'app:checkpoint-request', {
          requestId,
          reason: intent,
          stage,
        });
      });
    },
    requestHeld(win) {
      const requestId = deps.randomUUID();
      return new Promise(resolve => {
        const timeout = setTimeout(() => finish(null), timeoutMs);
        const finish = (held: HeldOperatorState | null) => {
          clearTimeout(timeout);
          pendingHeld.delete(requestId);
          resolve(held);
        };
        pendingHeld.set(requestId, finish);
        pushToRenderer(win.webContents, 'app:held-state-request', {
          requestId,
        });
      });
    },
    channels: {
      'app:complete-held-state': (_event, requestId: string, held: unknown) => {
        if (typeof requestId !== 'string') return;
        pendingHeld.get(requestId)?.(heldStateOf(held));
      },
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
  | 'settleStarts'
  | 'flushHistory'
  | 'stopAll'
>;

export interface ShutdownSequenceDependencies {
  productName: string;
  /** Automation reads its quit answers here (EXAWATT_TEST_QUIT_RESPONSES). */
  env: NodeJS.ProcessEnv;
  /** Shows a native message box over the main window when there is one. */
  showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>;
  window: () => CheckpointWindow | null;
  allWindows: () => BroadcastWindow[];
  /**
   * A shutdown that had begun returned to idle without exiting: the operator
   * cancelled it, or a step failed. Processes that died while shutdown owned
   * them were left down, and the app is staying open.
   */
  shutdownCancelled?: () => void;
  checkpoints: CheckpointBroker;
  workspace: {
    load(): Promise<unknown | null>;
    mergeHarnessIdentities(
      state: unknown,
      harnessIds: ReadonlyMap<string, string>
    ): boolean;
    save(state: unknown): Promise<void>;
  };
  /** Released in this order once every Session has stopped; each one is
   *  bounded by the lifecycle owner and skipped past its deadline. */
  closing: ReadonlyArray<ClosingStep>;
  /** An update restart's first step after the confirmation (BUG-286):
   *  null once the installer accepts the update, else its reason. */
  prepareUpdate: () => Promise<string | null>;
  /** Shows why an update did not go ahead. */
  updateRefused: (reason: string) => void;
  /** The last step. `installUpdate` resolves only if the install fails. */
  handOff: {
    installUpdate(): Promise<string>;
    relaunch(): void;
    quit(): void;
  };
  /** The run record (`run-state.ts`): held state for the next launch, and a
   *  failed install's reason. */
  runRecord: {
    saveHeldState(held: HeldOperatorState | null): Promise<void>;
    /** What the previous run held, handed to the renderer once. */
    previousHeldState(): HeldOperatorState | null;
    saveInstallFailure(reason: string): Promise<void>;
  };
  record?: (event: string, fields: Record<string, unknown>) => void;
  /** For the window-management restart, which is a normal restart. */
  /** Refuses a sender outside the trusted renderer origin. */
  assertTrustedSender: (event: IpcMainEvent) => void;
  coordinator: () => {
    request(intent: ShutdownIntent): Promise<boolean>;
    cancel(): boolean;
    readonly status: ShutdownStatus;
  } | null;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

export interface ShutdownSequence {
  /** Everything `ShutdownCoordinator` needs, once the Session runtime exists. */
  coordinatorDependencies(runtime: {
    sessions: ShutdownSessions;
    shutdownCopy: typeof ShutdownCopy;
    markClean: (intent: ShutdownIntent) => Promise<void>;
  }): ShutdownDependencies;
  promptWindowManagementRestart(): Promise<void>;
  /** The lifecycle's own channels: status and Cancel. */
  channels: TrustedChannels;
  /** The synchronous held-state hand-back (BUG-260). */
  registerSync(
    onSync: (
      channel: 'app:take-held-state',
      listener: (event: IpcMainEvent) => void
    ) => void
  ): void;
}

export function createShutdownSequence(
  deps: ShutdownSequenceDependencies
): ShutdownSequence {
  const productName = deps.productName;
  /** Automation answers for the quit confirmation, consumed in order. */
  const testQuitResponses =
    deps.env.EXAWATT_TEST === '1'
      ? (deps.env.EXAWATT_TEST_QUIT_RESPONSES ?? '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
      : [];
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

  function broadcastShutdown(status: ShutdownStatus): void {
    broadcastToWindows(deps.allWindows(), 'app:shutdown-status', status);
    if (status.phase === 'idle') deps.shutdownCancelled?.();
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
    if (deps.env.EXAWATT_TEST === '1') {
      const answer = deps.env.EXAWATT_TEST_CHECKPOINT_FAILURE;
      if (answer === 'confirm') return true;
      if (answer === 'cancel') return false;
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

  async function reportShutdownFailure(error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    await nativeDialog('stop-failed', {
      type: 'error',
      title: `${productName} stayed open`,
      message: `${productName} stayed open`,
      detail: `${detail.slice(0, 400)}\n\n${productName} will remain open.`,
      buttons: ['OK'],
      noLink: true,
    });
  }

  function coordinatorDependencies(runtime: {
    sessions: ShutdownSessions;
    shutdownCopy: typeof ShutdownCopy;
    markClean: (intent: ShutdownIntent) => Promise<void>;
  }): ShutdownDependencies {
    const ptySessions = runtime.sessions;

    async function confirmShutdown(
      intent: ShutdownIntent,
      counts: LiveProcessCounts
    ): Promise<boolean> {
      if (deps.env.EXAWATT_TEST === '1') {
        const response =
          testQuitResponses.shift() ?? deps.env.EXAWATT_TEST_QUIT_RESPONSE;
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

    /** Any window answers: held state is not workspace state, and the
     *  operator is as likely to be standing in Fleet or Settings. */
    async function captureHeldState(): Promise<void> {
      const win = deps.window();
      const held =
        win && !win.isDestroyed()
          ? await deps.checkpoints.requestHeld(win)
          : null;
      await deps.runRecord.saveHeldState(held);
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
      prepareUpdate: deps.prepareUpdate,
      updateRefused: deps.updateRefused,
      pauseNewWork: () => ptySessions.pauseCreates(),
      resumeNewWork: () => ptySessions.resumeCreates(),
      settleStarts: () => ptySessions.settleStarts(),
      captureHeldState,
      checkpoint: checkpointRenderer,
      confirmWithoutCheckpoint,
      flushHistory: () => ptySessions.flushHistory(),
      stopProcesses: () => ptySessions.stopAll(),
      markClean: runtime.markClean,
      closing: deps.closing,
      handOff: async intent => {
        if (intent === 'update') return await deps.handOff.installUpdate();
        // A restart must come back on its own; a quit must not.
        if (intent === 'restart') deps.handOff.relaunch();
        deps.handOff.quit();
        return null;
      },
      relaunchAfterFailedInstall: async reason => {
        try {
          await deps.runRecord.saveInstallFailure(reason);
        } catch (error) {
          logError('[shutdown] install failure was not saved', error);
        }
        deps.handOff.relaunch();
        deps.handOff.quit();
      },
      failure: reportShutdownFailure,
      status: broadcastShutdown,
      ...(deps.record ? { record: deps.record } : {}),
    };
  }

  const channels: TrustedChannels = {
    'app:cancel-shutdown': () => deps.coordinator()?.cancel() ?? false,
    'app:shutdown-status': () =>
      deps.coordinator()?.status ?? {
        phase: 'idle',
        agents: 0,
        shells: 0,
        intent: null,
        waitingOn: null,
        cancellable: false,
      },
  };

  let heldStateTaken = false;
  function registerSync(
    onSync: (
      channel: 'app:take-held-state',
      listener: (event: IpcMainEvent) => void
    ) => void
  ): void {
    onSync('app:take-held-state', event => {
      // A throw from a plain ipcMain.on listener is an uncaught main-process
      // exception: refuse by answering null, as the appearance read does.
      try {
        deps.assertTrustedSender(event);
      } catch {
        event.returnValue = null;
        return;
      }
      // Once per launch: a reload must not walk the operator back to where
      // he stood before the restart.
      event.returnValue = heldStateTaken
        ? null
        : deps.runRecord.previousHeldState();
      heldStateTaken = true;
    });
  }

  return {
    coordinatorDependencies,
    promptWindowManagementRestart,
    channels,
    registerSync,
  };
}

/**
 * `before-quit`. Before the command runtime exists there is no coordinator,
 * so a quit stops the renderer server and quits once; after it exists, every
 * quit goes through the coordinator, which lets the final exit through.
 */
export function createBeforeQuitHandler(deps: {
  /** Courtesy flushes that must never delay a quit. Only the bootstrap exit
   *  runs them here; after bootstrap they are the coordinator's final
   *  cleanup, because a quit the operator cancels must keep them alive. */
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
    const shutdownCoordinator = deps.coordinator();
    if (!shutdownCoordinator) {
      if (bootstrapExitInProgress) return;
      event.preventDefault();
      bootstrapExitInProgress = true;
      deps.disposeServices();
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
