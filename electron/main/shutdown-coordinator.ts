/** `restart` is an operator-initiated relaunch that is not carrying an update
 *  — today the remedy for incident 0001, where macOS stops vending Exawatt's
 *  accessibility element and window managers can no longer move the window.
 *  It takes the same checkpoint-and-rehydrate path as quit and update. */
export type ShutdownIntent = 'quit' | 'update' | 'restart';
export type ShutdownPhase =
  | 'idle'
  | 'confirming'
  | 'checkpointing'
  | 'stopping'
  | 'finalizing';

export interface LiveProcessCounts {
  agents: number;
  shells: number;
}

export interface ShutdownDependencies {
  countLive: () => LiveProcessCounts;
  confirm: (
    intent: ShutdownIntent,
    counts: LiveProcessCounts
  ) => Promise<boolean>;
  checkpoint: (
    intent: ShutdownIntent,
    stage: 'pre-stop' | 'stopped'
  ) => Promise<boolean>;
  confirmWithoutCheckpoint: (intent: ShutdownIntent) => Promise<boolean>;
  pauseNewWork: () => void;
  resumeNewWork: () => void;
  flushHistory: () => Promise<void>;
  stopProcesses: () => Promise<void>;
  markClean: () => Promise<void>;
  cleanup: () => Promise<void> | void;
  finalize: (intent: ShutdownIntent) => void;
  failure?: (error: unknown) => Promise<void> | void;
  status?: (phase: ShutdownPhase, counts: LiveProcessCounts) => void;
}

/** One idempotent state machine for Cmd-Q, Dock Quit, and update restart. */
export class ShutdownCoordinator {
  private active: Promise<boolean> | null = null;
  private _phase: ShutdownPhase = 'idle';
  private _allowsFinalExit = false;

  constructor(private readonly deps: ShutdownDependencies) {}

  get phase(): ShutdownPhase {
    return this._phase;
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
          this.setPhase('idle', this.deps.countLive());
        }
        this.active = null;
      });
    return this.active;
  }

  private setPhase(phase: ShutdownPhase, counts: LiveProcessCounts): void {
    this._phase = phase;
    this.deps.status?.(phase, counts);
  }

  private async run(intent: ShutdownIntent): Promise<boolean> {
    const counts = this.deps.countLive();
    if (counts.agents + counts.shells > 0) {
      this.setPhase('confirming', counts);
      if (!(await this.deps.confirm(intent, counts))) return false;
    }

    this.deps.pauseNewWork();
    this.setPhase('checkpointing', counts);
    const checkpointed = await this.deps.checkpoint(intent, 'pre-stop');
    if (!checkpointed && !(await this.deps.confirmWithoutCheckpoint(intent))) {
      return false;
    }

    await this.deps.flushHistory();
    this.setPhase('stopping', counts);
    await this.deps.stopProcesses();
    await this.deps.flushHistory();
    // Persist stopped-clean only after process-group verification succeeds. If
    // this commit fails, leave the run marker unclean so recovery is honest.
    const cleanCheckpointed = await this.deps.checkpoint(intent, 'stopped');
    if (cleanCheckpointed) await this.deps.markClean();

    this.setPhase('finalizing', counts);
    await this.deps.cleanup();
    this._allowsFinalExit = true;
    this.deps.finalize(intent);
    return true;
  }
}

export function shutdownCopy(
  intent: ShutdownIntent,
  counts: LiveProcessCounts
): { title: string; detail: string } {
  const action =
    intent === 'quit' ? 'Quit Exawatt and stop' : 'Restart Exawatt and stop';
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
      ? 'Their sessions and terminal history will be saved. You can resume the agents after reopening Exawatt.'
      : 'Terminal history will be saved. Shells reopen as new processes in the same directories.';
  return {
    title: `${action} ${subject}?`,
    detail: `${base}${shellSuffix}`,
  };
}
