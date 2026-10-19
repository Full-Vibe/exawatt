import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { replaceJsonFileAtomicAsync } from './atomic-json-file';
import type {
  HeldOperatorState,
  ShutdownIntent,
} from '@exawatt/core/desktop-bridge';

/**
 * The run record: whether the previous run ended cleanly, and how. It is the
 * lifecycle owner's one record of "the app went away" (BUG-260, BUG-286):
 * the intent of a clean exit, what the operator was holding when a restart
 * or update took the app away, and why an install failed after everything
 * had stopped. The next launch reads it once in `begin()`.
 *
 * Size class (decision 0039): one record, overwritten by every run. Held
 * state is capped at `MAX_HELD_STATE_BYTES` where it enters main.
 */

export interface InstallFailure {
  fromVersion: string;
  toVersion: string | null;
  reason: string;
}

interface StoredRunState {
  v: 1;
  runId: string;
  pid: number;
  startedAt: number;
  clean: boolean;
  /** How a clean run ended. Written with `clean`. */
  exit?: ShutdownIntent;
  /** Saved while a restart or update was checkpointing. */
  held?: HeldOperatorState;
  installFailure?: InstallFailure;
}

/** What the previous run left for this launch. */
export interface PreviousRun {
  previousRunInterrupted: boolean;
  /** Only after a clean restart or update: a quit restores no position. */
  heldState: HeldOperatorState | null;
  installFailure: InstallFailure | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function installFailureOf(value: unknown): InstallFailure | null {
  if (!isRecord(value)) return null;
  const { fromVersion, toVersion, reason } = value;
  if (typeof fromVersion !== 'string' || typeof reason !== 'string') {
    return null;
  }
  return {
    fromVersion,
    toVersion: typeof toVersion === 'string' ? toVersion : null,
    reason,
  };
}

export class RunStateStore {
  private current: StoredRunState | null = null;

  constructor(private readonly file: string) {}

  async begin(): Promise<PreviousRun> {
    let previous: Partial<StoredRunState> | null = null;
    let previousRunInterrupted = false;
    try {
      const parsed: unknown = JSON.parse(
        await fs.promises.readFile(this.file, 'utf8')
      );
      previous = isRecord(parsed) ? (parsed as Partial<StoredRunState>) : null;
      previousRunInterrupted = previous?.v !== 1 || previous.clean !== true;
    } catch (error) {
      // Missing is a first run. Anything else is a run whose ending cannot
      // be known, which recovery must treat as interrupted.
      previousRunInterrupted =
        (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    const restarted =
      !previousRunInterrupted &&
      (previous?.exit === 'restart' || previous?.exit === 'update');
    const result: PreviousRun = {
      previousRunInterrupted,
      heldState: restarted && isRecord(previous?.held) ? previous.held : null,
      installFailure: installFailureOf(previous?.installFailure),
    };
    this.current = {
      v: 1,
      runId: randomUUID(),
      pid: process.pid,
      startedAt: Date.now(),
      clean: false,
    };
    await this.write(this.current);
    return result;
  }

  /** Saved while a restart or update checkpoints; honoured only if that
   *  shutdown then ends cleanly as a restart or update. */
  async recordHeldState(held: HeldOperatorState | null): Promise<void> {
    if (!this.current) return;
    const next: StoredRunState = { ...this.current };
    delete next.held;
    if (held) next.held = held;
    this.current = next;
    await this.write(this.current);
  }

  async markClean(exit: ShutdownIntent): Promise<void> {
    if (!this.current) return;
    this.current = { ...this.current, clean: true, exit };
    await this.write(this.current);
  }

  /** The install failed after everything stopped; the next launch says so. */
  async recordInstallFailure(failure: InstallFailure): Promise<void> {
    if (!this.current) return;
    this.current = { ...this.current, installFailure: failure };
    await this.write(this.current);
  }

  private async write(state: StoredRunState): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), {
      recursive: true,
      mode: 0o700,
    });
    await replaceJsonFileAtomicAsync(this.file, state);
  }
}
