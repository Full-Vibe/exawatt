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
 *                     the layout, what the operator was holding and the
 *                     terminal history are saved
 *   4. stopping       Sessions stop, history is flushed again, and the run
 *                     is recorded as ended cleanly
 *   5. finalizing     services close, then the handoff: quit, relaunch, or
 *                     the installer
 *
 * BUG-286 was this lifecycle without an owner for its waits: each step's
 * deadline (or lack of one) lived in the module that did the work, so a
 * closing step that never settled left the window on "Closing Exawatt…" for
 * good. The 0.1.22 review found the same class four more times: steps
 * awaited beside the waits table rather than through it.
 *
 * So the order of the phases (`runShutdown`) is a script with no handle on
 * any step. It reaches a step only by naming it to `ShutdownScript.step`,
 * which runs it inside the step's wait (`STEP_WAITS`, then `SHUTDOWN_WAITS`)
 * and hands the step an `AbortSignal` that aborts when its wait is cancelled
 * or reaches its deadline, so the step stops its own work instead of
 * running on behind a wait that has already ended. A step can be added only
 * by naming its wait, and awaited only through it.
 *
 * The operator's own answers (the confirmations) are questions, not waits:
 * they end when he answers.
 */

interface WaitPolicy {
  /** A wait shorter than this is not worth naming on screen. */
  visibleAfterMs: number;
  deadlineMs: number;
  /** Cancelling leaves the app as it was. Honoured only while nothing has
   *  stopped, whatever the wait. */
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
  // A flush is a few appends per Session; fifteen seconds is a wedged disk.
  'history-saving': {
    visibleAfterMs: 1_000,
    deadlineMs: 15_000,
    cancellable: true,
  },
  'processes-stopping': {
    visibleAfterMs: 2_000,
    deadlineMs: 60_000,
    cancellable: false,
  },
  // One small file. Past the deadline the run stays recorded as unclean,
  // which is what recovery should then believe.
  'run-recording': {
    visibleAfterMs: 1_000,
    deadlineMs: 10_000,
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
  relaunching: {
    visibleAfterMs: 2_000,
    deadlineMs: 10_000,
    cancellable: false,
  },
};

export interface LiveProcessCounts {
  agents: number;
  shells: number;
}

export interface ClosingStep {
  /** Named in diagnostics when it fails or passes its deadline. */
  name: string;
  /** `signal` aborts at the step's deadline. */
  run: (signal: AbortSignal) => Promise<void> | void;
}

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * The lifecycle's steps. Each takes the `AbortSignal` of its wait last and
 * stops its own work when it aborts: a step that polls, listens or asks
 * another process must honour it; a single write may finish. Only
 * `ShutdownScript.step` calls them.
 */
interface ShutdownSteps {
  /** Hands the update to the installer before anything stops. Resolves null
   *  once it is accepted, or with the installer's reason for refusing. */
  prepareUpdate: (signal: AbortSignal) => Promise<string | null>;
  /** Resolves once no Session is part-way through starting. */
  settleStarts: (signal: AbortSignal) => Promise<void>;
  /** Saves what the operator was holding outside the layout (BUG-260). */
  captureHeldState: (
    intent: ShutdownIntent,
    signal: AbortSignal
  ) => Promise<void>;
  checkpoint: (
    intent: ShutdownIntent,
    stage: 'pre-stop' | 'stopped',
    signal: AbortSignal
  ) => Promise<boolean>;
  flushHistory: (signal: AbortSignal) => Promise<void>;
  stopProcesses: (signal: AbortSignal) => Promise<void>;
  /** Records the run as ended cleanly, and how. */
  markClean: (intent: ShutdownIntent, signal: AbortSignal) => Promise<void>;
  /**
   * The last step. A quit or restart ends the process. An update resolves
   * only if the install fails, with the reason.
   */
  handOff: (
    intent: ShutdownIntent,
    signal: AbortSignal
  ) => Promise<string | null>;
  /** The install failed after everything stopped: keep the reason for the
   *  next launch and come back on the current version. */
  relaunchAfterFailedInstall: (
    reason: string,
    signal: AbortSignal
  ) => Promise<void>;
}

type StepName = keyof ShutdownSteps;
type StepArgs<K extends StepName> = ShutdownSteps[K] extends (
  ...args: [...infer A, AbortSignal]
) => unknown
  ? A
  : never;
type StepResult<K extends StepName> = Awaited<ReturnType<ShutdownSteps[K]>>;

/** Which wait bounds each step. A step without one does not compile. */
const STEP_WAITS: Readonly<Record<StepName, ShutdownWait>> = {
  prepareUpdate: 'update-staging',
  settleStarts: 'agents-starting',
  captureHeldState: 'window-saving',
  checkpoint: 'window-saving',
  flushHistory: 'history-saving',
  stopProcesses: 'processes-stopping',
  markClean: 'run-recording',
  handOff: 'installer',
  relaunchAfterFailedInstall: 'relaunching',
};

export interface ShutdownDependencies extends ShutdownSteps {
  countLive: () => LiveProcessCounts;
  confirm: (
    intent: ShutdownIntent,
    counts: LiveProcessCounts
  ) => Promise<boolean>;
  confirmWithoutCheckpoint: (intent: ShutdownIntent) => Promise<boolean>;
  /** The update did not go ahead; the notice shows why (BUG-286). */
  updateRefused: (reason: string) => void;
  pauseNewWork: () => void;
  resumeNewWork: () => void;
  /** Released in order once every Session has stopped. */
  closing: ReadonlyArray<ClosingStep>;
  failure?: (error: unknown) => Promise<void> | void;
  status?: (status: ShutdownStatus) => void;
  record?: (event: string, fields: Record<string, unknown>) => void;
  timers?: Timers;
}

type WaitOutcome<T> =
  | { kind: 'done'; value: T }
  | { kind: 'failed'; error: unknown }
  | { kind: 'timed-out' }
  | { kind: 'cancelled' };

/** Why a step's signal aborted: its wait ended without it. */
class ShutdownWaitEnded extends Error {
  constructor(
    readonly waitingOn: ShutdownWait,
    readonly outcome: 'timed-out' | 'cancelled'
  ) {
    super(`The shutdown stopped waiting on ${waitingOn} (${outcome}).`);
    this.name = 'AbortError';
  }
}

/** Everything the phase order may do. It holds no step. */
interface ShutdownScript {
  countLive(): LiveProcessCounts;
  confirm(intent: ShutdownIntent, counts: LiveProcessCounts): Promise<boolean>;
  confirmWithoutCheckpoint(intent: ShutdownIntent): Promise<boolean>;
  step<K extends StepName>(
    name: K,
    ...args: StepArgs<K>
  ): Promise<WaitOutcome<StepResult<K>>>;
  closing(): ReadonlyArray<{
    name: string;
    close(): Promise<WaitOutcome<void>>;
  }>;
  setPhase(
    phase: ShutdownPhase,
    intent: ShutdownIntent,
    counts: LiveProcessCounts
  ): void;
  pauseNewWork(): void;
  updateRefused(reason: string): void;
  allowFinalExit(): void;
  record(event: string, fields: Record<string, unknown>): void;
}

const IDLE_COUNTS: LiveProcessCounts = { agents: 0, shells: 0 };

/** Phases in which nothing has stopped, so a Cancel leaves the app whole. */
const NOTHING_STOPPED: ReadonlySet<ShutdownPhase> = new Set([
  'confirming',
  'preparing',
  'checkpointing',
]);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const seconds = (wait: ShutdownWait) =>
  Math.round(SHUTDOWN_WAITS[wait].deadlineMs / 1000);

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
  private readonly script: ShutdownScript;
  private readonly publishStatus: (status: ShutdownStatus) => void;
  private readonly reportFailure: (error: unknown) => Promise<void>;
  private readonly returnToIdle: () => void;

  constructor(deps: ShutdownDependencies) {
    this.timers = deps.timers ?? realTimers;
    this.record = deps.record ?? (() => {});
    this.publishStatus = deps.status ?? (() => {});
    this.reportFailure = async error => await deps.failure?.(error);
    this.returnToIdle = () => {
      deps.resumeNewWork();
      this.publish({
        phase: 'idle',
        ...deps.countLive(),
        intent: null,
        waitingOn: null,
        cancellable: false,
      });
    };
    // The only place a step is called: inside its wait.
    const runStep = <K extends StepName>(
      name: K,
      args: StepArgs<K>,
      signal: AbortSignal
    ): Promise<StepResult<K>> =>
      (
        deps[name] as unknown as (
          ...stepArgs: [...StepArgs<K>, AbortSignal]
        ) => Promise<StepResult<K>>
      )(...args, signal);
    this.script = {
      countLive: () => deps.countLive(),
      confirm: (intent, counts) => deps.confirm(intent, counts),
      confirmWithoutCheckpoint: intent => deps.confirmWithoutCheckpoint(intent),
      step: (name, ...args) =>
        this.wait(STEP_WAITS[name], signal => runStep(name, args, signal)),
      closing: () =>
        deps.closing.map(step => ({
          name: step.name,
          close: () =>
            this.wait('services-closing', signal => step.run(signal)),
        })),
      setPhase: (phase, intent, counts) =>
        this.publish({
          phase,
          ...counts,
          intent,
          waitingOn: null,
          cancellable: false,
        }),
      pauseNewWork: () => deps.pauseNewWork(),
      updateRefused: reason => deps.updateRefused(reason),
      allowFinalExit: () => {
        this._allowsFinalExit = true;
      },
      record: (event, fields) => this.record(event, fields),
    };
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
    this.active = runShutdown(intent, this.script)
      .catch(async error => {
        await this.reportFailure(error);
        return false;
      })
      .finally(() => {
        if (!this._allowsFinalExit) this.returnToIdle();
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
    this.publishStatus(status);
  }

  /**
   * Every wait in the lifecycle: named on screen once it outlasts its
   * `visibleAfterMs`, ended at its deadline, and cancellable when its policy
   * allows and nothing has stopped. Ending a wait aborts its work's signal.
   * A step that throws is a `failed` outcome, its caller's to judge.
   */
  private wait<T>(
    name: ShutdownWait,
    work: (signal: AbortSignal) => Promise<T> | T
  ): Promise<WaitOutcome<T>> {
    const policy = SHUTDOWN_WAITS[name];
    const cancellable =
      policy.cancellable && NOTHING_STOPPED.has(this._status.phase);
    const controller = new AbortController();
    return new Promise(resolve => {
      let settled = false;
      const finish = (outcome: WaitOutcome<T>) => {
        if (settled) return;
        settled = true;
        if (visible !== null) this.timers.clearTimeout(visible);
        this.timers.clearTimeout(deadline);
        this.cancelCurrentWait = null;
        if (outcome.kind === 'timed-out' || outcome.kind === 'cancelled') {
          controller.abort(new ShutdownWaitEnded(name, outcome.kind));
        }
        if (this._status.waitingOn !== null || this._status.cancellable) {
          this.publish({
            ...this._status,
            waitingOn: null,
            cancellable: false,
          });
        }
        resolve(outcome);
      };
      if (cancellable) {
        this.cancelCurrentWait = () => {
          this.record('shutdown.cancelled', { waitingOn: name });
          finish({ kind: 'cancelled' });
        };
      }
      const show = () =>
        this.publish({ ...this._status, waitingOn: name, cancellable });
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
      // A synchronous throw is a failure like a rejection.
      Promise.resolve()
        .then(() => work(controller.signal))
        .then(
          value => finish({ kind: 'done', value }),
          error => finish({ kind: 'failed', error })
        );
    });
  }
}

/** The phases in order. It reaches a step only through `io.step`. */
async function runShutdown(
  intent: ShutdownIntent,
  io: ShutdownScript
): Promise<boolean> {
  const counts = io.countLive();
  if (counts.agents + counts.shells > 0) {
    io.setPhase('confirming', intent, counts);
    if (!(await io.confirm(intent, counts))) return false;
  }

  if (intent === 'update') {
    io.setPhase('preparing', intent, counts);
    const staged = await io.step('prepareUpdate');
    if (staged.kind === 'cancelled') return false;
    if (staged.kind === 'failed') throw staged.error;
    const refusal =
      staged.kind === 'timed-out'
        ? `Preparing the update did not finish within ${seconds('update-staging')} seconds.`
        : staged.value;
    if (refusal !== null) {
      io.updateRefused(refusal);
      return false;
    }
  }

  // Stop accepting new work, then let what had already started settle, so
  // the checkpoint below sees every Session that will exist.
  io.pauseNewWork();
  io.setPhase('checkpointing', intent, counts);
  const starts = await io.step('settleStarts');
  if (starts.kind === 'cancelled') return false;
  if (starts.kind === 'failed') throw starts.error;
  if (starts.kind === 'timed-out') {
    throw new Error(
      'An agent was still starting, so nothing was stopped. Check it, then try again.'
    );
  }

  if (intent !== 'quit') {
    const held = await io.step('captureHeldState', intent);
    if (held.kind === 'cancelled') return false;
    // The layout below is the contract; held state is what it cannot
    // carry. Losing it costs the operator his place, not his work.
    if (held.kind === 'failed') {
      io.record('shutdown.held-state-failed', {
        message: messageOf(held.error),
      });
    }
  }

  const saved = await io.step('checkpoint', intent, 'pre-stop');
  if (saved.kind === 'cancelled') return false;
  if (saved.kind === 'failed') {
    io.record('shutdown.checkpoint-failed', {
      stage: 'pre-stop',
      message: messageOf(saved.error),
    });
  }
  const checkpointed = saved.kind === 'done' && saved.value;
  if (!checkpointed && !(await io.confirmWithoutCheckpoint(intent))) {
    return false;
  }

  const flushed = await io.step('flushHistory');
  if (flushed.kind === 'cancelled') return false;
  if (flushed.kind === 'failed') throw flushed.error;
  if (flushed.kind === 'timed-out') {
    throw new Error(
      `Terminal history did not finish saving within ${seconds('history-saving')} seconds, so nothing was stopped.`
    );
  }

  io.setPhase('stopping', intent, counts);
  const stopped = await io.step('stopProcesses');
  if (stopped.kind === 'failed') throw stopped.error;
  if (stopped.kind !== 'done') {
    throw new Error(
      'Some Sessions did not stop in time. Check them before quitting again.'
    );
  }
  // Every Session has stopped. What remains is recorded, never waited on
  // past its deadline: the app stays open only when history would be lost.
  const reflushed = await io.step('flushHistory');
  if (reflushed.kind === 'failed') throw reflushed.error;
  if (reflushed.kind !== 'done') {
    throw new Error(
      `Terminal history did not finish saving within ${seconds('history-saving')} seconds. Quit again to retry.`
    );
  }
  // Persist stopped-clean only after process-group verification succeeds. If
  // this commit fails, leave the run marker unclean so recovery is honest.
  const committed = await io.step('checkpoint', intent, 'stopped');
  if (committed.kind === 'failed') {
    io.record('shutdown.checkpoint-failed', {
      stage: 'stopped',
      message: messageOf(committed.error),
    });
  }
  if (committed.kind === 'done' && committed.value) {
    const clean = await io.step('markClean', intent);
    if (clean.kind === 'failed') {
      io.record('shutdown.mark-clean-failed', {
        message: messageOf(clean.error),
      });
    }
  }

  io.setPhase('finalizing', intent, counts);
  for (const step of io.closing()) {
    const closed = await step.close();
    if (closed.kind === 'failed') {
      io.record('shutdown.step-failed', {
        step: step.name,
        message: messageOf(closed.error),
      });
    } else if (closed.kind !== 'done') {
      io.record('shutdown.step-skipped', { step: step.name });
    }
  }

  io.allowFinalExit();
  const installed = await io.step('handOff', intent);
  const failure =
    installed.kind === 'timed-out'
      ? `Installing the update did not finish within ${seconds('installer')} seconds.`
      : installed.kind === 'failed'
        ? messageOf(installed.error) || 'No reason was reported.'
        : installed.kind === 'done'
          ? installed.value
          : null;
  if (failure !== null) {
    io.record('shutdown.install-failed', { reason: failure });
    const relaunched = await io.step('relaunchAfterFailedInstall', failure);
    if (relaunched.kind === 'failed') {
      io.record('shutdown.relaunch-failed', {
        message: messageOf(relaunched.error),
      });
    }
  }
  return true;
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
