import type {
  ShutdownIntent,
  ShutdownPhase,
  ShutdownStatus,
  ShutdownWait,
} from '@exawatt/core/desktop-bridge';

/**
 * The one owner of "the app is going away": Cmd-Q, Dock Quit, an operator
 * restart, Restart to Update, and the relaunch that recovers a failed
 * install. Nothing else in main quits, relaunches or installs.
 *
 * The phases run in one order, and every wait inside them is bounded,
 * visible and, while nothing has stopped yet, cancellable:
 *
 *   1. confirming     the operator agrees to stop what is running
 *   2. preparing      (update) the installer accepts the update first
 *   3. checkpointing  new Sessions are refused, starting ones settle, then
 *                     the layout and what the operator was holding are saved
 *   4. stopping       Sessions stop and their history is flushed
 *   5. finalizing     services close, then the handoff: quit, relaunch, or
 *                     the installer
 *
 * BUG-286 was this lifecycle without an owner for its waits: each step's
 * deadline (or lack of one) lived in the module that did the work, so a
 * closing step that never settled left the window on "Closing Exawatt…" for
 * good. Every wait now goes through `wait()`, whose policy is the table
 * below and nowhere else.
 */

interface WaitPolicy {
  /** A wait shorter than this is not worth naming on screen. */
  visibleAfterMs: number;
  deadlineMs: number;
  /** Only while nothing has stopped: cancelling leaves the app as it was. */
  cancellable: boolean;
}

export const SHUTDOWN_WAITS: Readonly<Record<ShutdownWait, WaitPolicy>> = {
  // Squirrel fetches the zip from localhost, unzips and verifies it. A 150 MB
  // update takes seconds; three minutes is a hung helper.
  'update-staging': {
    visibleAfterMs: 0,
    deadlineMs: 180_000,
    cancellable: true,
  },
  'agents-starting': {
    visibleAfterMs: 1_000,
    deadlineMs: 30_000,
    cancellable: true,
  },
  // The renderer answers its own checkpoint within three seconds or refuses
  // (`createCheckpointBroker`); this bounds main's side of the same step.
  'window-saving': {
    visibleAfterMs: 1_000,
    deadlineMs: 15_000,
    cancellable: true,
  },
  'processes-stopping': {
    visibleAfterMs: 2_000,
    deadlineMs: 60_000,
    cancellable: false,
  },
  // Per closing step. Closing is a courtesy: a step past its deadline is
  // recorded and skipped, never waited on.
  'services-closing': {
    visibleAfterMs: 2_000,
    deadlineMs: 10_000,
    cancellable: false,
  },
  // After a staged install starts, the app should be gone within seconds.
  installer: { visibleAfterMs: 2_000, deadlineMs: 30_000, cancellable: false },
};

export interface LiveProcessCounts {
  agents: number;
  shells: number;
}

export interface ClosingStep {
  /** Named in diagnostics when it fails or passes its deadline. */
  name: string;
  run: () => Promise<void> | void;
}

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

export interface ShutdownDependencies {
  countLive: () => LiveProcessCounts;
  confirm: (
    intent: ShutdownIntent,
    counts: LiveProcessCounts
  ) => Promise<boolean>;
  /** Hands the update to the installer before anything stops. Resolves null
   *  once it is accepted, or with the installer's reason for refusing. */
  prepareUpdate: () => Promise<string | null>;
  /** The update did not go ahead; the notice shows why (BUG-286). */
  updateRefused: (reason: string) => void;
  pauseNewWork: () => void;
  resumeNewWork: () => void;
  /** Resolves once no Session is part-way through starting. */
  settleStarts: () => Promise<void>;
  /** Saves what the operator was holding outside the layout (BUG-260). */
  captureHeldState: (intent: ShutdownIntent) => Promise<void>;
  checkpoint: (
    intent: ShutdownIntent,
    stage: 'pre-stop' | 'stopped'
  ) => Promise<boolean>;
  confirmWithoutCheckpoint: (intent: ShutdownIntent) => Promise<boolean>;
  flushHistory: () => Promise<void>;
  stopProcesses: () => Promise<void>;
  /** Records the run as ended cleanly, and how. */
  markClean: (intent: ShutdownIntent) => Promise<void>;
  /** Released in order once every Session has stopped. */
  closing: ReadonlyArray<ClosingStep>;
  /**
   * The last step. A quit or restart ends the process. An update resolves
   * only if the install fails, with the reason.
   */
  handOff: (intent: ShutdownIntent) => Promise<string | null>;
  /** The install failed after everything stopped: keep the reason for the
   *  next launch and come back on the current version. */
  relaunchAfterFailedInstall: (reason: string) => Promise<void>;
  failure?: (error: unknown) => Promise<void> | void;
  status?: (status: ShutdownStatus) => void;
  record?: (event: string, fields: Record<string, unknown>) => void;
  timers?: Timers;
}

type WaitOutcome<T> =
  | { kind: 'done'; value: T }
  | { kind: 'timed-out' }
  | { kind: 'cancelled' };

const IDLE_COUNTS: LiveProcessCounts = { agents: 0, shells: 0 };

export class ShutdownCoordinator {
  private active: Promise<boolean> | null = null;
  private _status: ShutdownStatus = {
    phase: 'idle',
    ...IDLE_COUNTS,
    intent: null,
    waitingOn: null,
    cancellable: false,
  };
  private _allowsFinalExit = false;
  private cancelCurrentWait: (() => void) | null = null;
  private readonly timers: Timers;
  private readonly record: (
    event: string,
    fields: Record<string, unknown>
  ) => void;

  constructor(private readonly deps: ShutdownDependencies) {
    this.timers = deps.timers ?? realTimers;
    this.record = deps.record ?? (() => {});
  }

  get phase(): ShutdownPhase {
    return this._status.phase;
  }

  get status(): ShutdownStatus {
    return this._status;
  }

  get allowsFinalExit(): boolean {
    return this._allowsFinalExit;
  }

  request(intent: ShutdownIntent): Promise<boolean> {
    if (this.active) return this.active;
    this.active = this.run(intent)
      .catch(async error => {
        await this.deps.failure?.(error);
        return false;
      })
      .finally(() => {
        if (!this._allowsFinalExit) {
          this.deps.resumeNewWork();
          this.publish({
            phase: 'idle',
            ...this.deps.countLive(),
            intent: null,
            waitingOn: null,
            cancellable: false,
          });
        }
        this.active = null;
      });
    return this.active;
  }

  /**
   * The operator's Cancel. Honoured only while the current wait is
   * cancellable, which is only before anything has stopped.
   */
  cancel(): boolean {
    if (!this.cancelCurrentWait) return false;
    this.cancelCurrentWait();
    return true;
  }

  private publish(status: ShutdownStatus): void {
    this._status = status;
    this.deps.status?.(status);
  }

  private setPhase(
    phase: ShutdownPhase,
    intent: ShutdownIntent,
    counts: LiveProcessCounts
  ): void {
    this.publish({
      phase,
      ...counts,
      intent,
      waitingOn: null,
      cancellable: false,
    });
  }

  /**
   * Every wait in the lifecycle: named on screen once it outlasts its
   * `visibleAfterMs`, ended at its deadline, and cancellable when its policy
   * says nothing has stopped.
   */
  private wait<T>(
    name: ShutdownWait,
    work: Promise<T>
  ): Promise<WaitOutcome<T>> {
    const policy = SHUTDOWN_WAITS[name];
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = () => {
        if (settled) return false;
        settled = true;
        if (visible !== null) this.timers.clearTimeout(visible);
        this.timers.clearTimeout(deadline);
        this.cancelCurrentWait = null;
        if (this._status.waitingOn !== null || this._status.cancellable) {
          this.publish({
            ...this._status,
            waitingOn: null,
            cancellable: false,
          });
        }
        return true;
      };
      const finish = (outcome: WaitOutcome<T>) => {
        if (settle()) resolve(outcome);
      };
      if (policy.cancellable) {
        this.cancelCurrentWait = () => {
          this.record('shutdown.cancelled', { waitingOn: name });
          finish({ kind: 'cancelled' });
        };
      }
      const show = () =>
        this.publish({
          ...this._status,
          waitingOn: name,
          cancellable: policy.cancellable,
        });
      let visible: unknown = null;
      if (policy.visibleAfterMs === 0) show();
      else visible = this.timers.setTimeout(show, policy.visibleAfterMs);
      const deadline = this.timers.setTimeout(() => {
        this.record('shutdown.wait-timed-out', {
          waitingOn: name,
          deadlineMs: policy.deadlineMs,
        });
        finish({ kind: 'timed-out' });
      }, policy.deadlineMs);
      // A failing step is its caller's to report; the wait only bounds it.
      work.then(
        value => finish({ kind: 'done', value }),
        error => {
          if (settle()) reject(error);
        }
      );
    });
  }

  private async run(intent: ShutdownIntent): Promise<boolean> {
    const counts = this.deps.countLive();
    if (counts.agents + counts.shells > 0) {
      this.setPhase('confirming', intent, counts);
      if (!(await this.deps.confirm(intent, counts))) return false;
    }

    if (intent === 'update') {
      this.setPhase('preparing', intent, counts);
      const staged = await this.wait(
        'update-staging',
        this.deps.prepareUpdate()
      );
      if (staged.kind === 'cancelled') return false;
      const refusal =
        staged.kind === 'timed-out'
          ? `Preparing the update did not finish within ${Math.round(SHUTDOWN_WAITS['update-staging'].deadlineMs / 1000)} seconds.`
          : staged.value;
      if (refusal !== null) {
        this.deps.updateRefused(refusal);
        return false;
      }
    }

    // Stop accepting new work, then let what had already started settle, so
    // the checkpoint below sees every Session that will exist.
    this.deps.pauseNewWork();
    this.setPhase('checkpointing', intent, counts);
    const starts = await this.wait('agents-starting', this.deps.settleStarts());
    if (starts.kind === 'cancelled') return false;
    if (starts.kind === 'timed-out') {
      throw new Error(
        'An agent was still starting, so nothing was stopped. Check it, then try again.'
      );
    }

    if (intent !== 'quit') {
      const held = await this.wait(
        'window-saving',
        this.deps.captureHeldState(intent).catch(error => {
          // The layout below is the contract; held state is what it cannot
          // carry. Losing it costs the operator his place, not his work.
          this.record('shutdown.held-state-failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        })
      );
      if (held.kind === 'cancelled') return false;
    }

    const saved = await this.wait(
      'window-saving',
      this.deps.checkpoint(intent, 'pre-stop')
    );
    if (saved.kind === 'cancelled') return false;
    const checkpointed = saved.kind === 'done' && saved.value;
    if (!checkpointed && !(await this.deps.confirmWithoutCheckpoint(intent))) {
      return false;
    }

    await this.deps.flushHistory();
    this.setPhase('stopping', intent, counts);
    const stopped = await this.wait(
      'processes-stopping',
      this.deps.stopProcesses()
    );
    if (stopped.kind !== 'done') {
      throw new Error(
        'Some Sessions did not stop in time. Check them before quitting again.'
      );
    }
    await this.deps.flushHistory();
    // Persist stopped-clean only after process-group verification succeeds. If
    // this commit fails, leave the run marker unclean so recovery is honest.
    const cleanCheckpointed = await this.deps.checkpoint(intent, 'stopped');
    if (cleanCheckpointed) await this.deps.markClean(intent);

    this.setPhase('finalizing', intent, counts);
    for (const step of this.deps.closing) {
      try {
        const closed = await this.wait(
          'services-closing',
          Promise.resolve().then(step.run)
        );
        if (closed.kind !== 'done') {
          this.record('shutdown.step-skipped', { step: step.name });
        }
      } catch (error) {
        this.record('shutdown.step-failed', {
          step: step.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this._allowsFinalExit = true;
    const installed = await this.wait('installer', this.deps.handOff(intent));
    const failure =
      installed.kind === 'timed-out'
        ? `Installing the update did not finish within ${Math.round(SHUTDOWN_WAITS.installer.deadlineMs / 1000)} seconds.`
        : installed.kind === 'done'
          ? installed.value
          : null;
    if (failure !== null) {
      this.record('shutdown.install-failed', { reason: failure });
      await this.deps.relaunchAfterFailedInstall(failure);
    }
    return true;
  }
}

export function shutdownCopy(
  intent: ShutdownIntent,
  counts: LiveProcessCounts,
  appName = 'Exawatt'
): { title: string; detail: string } {
  const action =
    intent === 'quit'
      ? `Quit ${appName} and stop`
      : `Restart ${appName} and stop`;
  const subject =
    counts.agents > 0
      ? `${counts.agents} ${counts.agents === 1 ? 'agent' : 'agents'}`
      : `${counts.shells} ${counts.shells === 1 ? 'shell' : 'shells'}`;
  const shellSuffix =
    counts.agents > 0 && counts.shells > 0
      ? ` ${counts.shells} ${counts.shells === 1 ? 'shell will' : 'shells will'} also stop.`
      : '';
  const base =
    counts.agents > 0
      ? 'Tabs, purpose, read status, unanswered requests and terminal history will be saved. Agents reopen paused; you choose when to resume.'
      : 'Terminal history will be saved. Shells reopen as new processes in the same directories.';
  return {
    title: `${action} ${subject}?`,
    detail: `${base}${shellSuffix}`,
  };
}
