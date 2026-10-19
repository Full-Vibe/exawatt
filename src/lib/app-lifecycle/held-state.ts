import type { HeldOperatorState } from '@exawatt/core/desktop-bridge';

/**
 * What the operator is holding that the workspace layout does not carry
 * (BUG-260): where he is standing, and unsent text Exawatt owns. The layout
 * already restores Projects, tabs, selection, purpose, attention and drafts
 * of new Agents; this is the rest.
 *
 * A surface that holds such state registers a holder. When a restart or an
 * update takes the app away, the lifecycle owner asks the window once, every
 * holder captures, and main keeps the result in the run record. The next
 * launch hands it back once: each holder parses its own value (it is data
 * from disk, never trusted) and restores it. A holder that registers after
 * the hand-back still receives its value, so mount order does not matter.
 *
 * Not held, deliberately: the inside of a running provider's terminal (its
 * unsent input, its scroll position). Agents reopen paused, and a resumed
 * provider restores its own input; Exawatt must not replay terminal bytes.
 *
 * Restoring never throws (the 0.1.22 review: a refused `sessionStorage`
 * write took the window down after a restart). A holder that throws costs
 * only its own value, a holder restores entry by entry and names each entry
 * it could not put back, and every failure goes to the reporter the
 * hand-back was given.
 */
export interface HeldStateHolder<T> {
  /** Null when there is nothing worth holding. */
  capture(): T | null;
  /** Rejects anything that is not this holder's shape. */
  parse(value: unknown): T | null;
  /** Restores what it can; `failed` names each entry it could not. */
  restore(value: T, failed: (entry: string, error: unknown) => void): void;
}

export interface HeldStateRestoreFailure {
  holder: string;
  /** The holder's own entry, or null when the holder itself failed. */
  entry: string | null;
  error: unknown;
}

type RestoreReporter = (failure: HeldStateRestoreFailure) => void;

interface RegisteredHolder {
  capture(): unknown;
  restoreUnknown(value: unknown, report: RestoreReporter): void;
}

const holders = new Map<string, RegisteredHolder>();
let pending: HeldOperatorState = {};
/** The reporter of the hand-back whose values are still pending. */
let pendingReport: RestoreReporter = () => {};

export function registerHeldState<T>(
  id: string,
  holder: HeldStateHolder<T>
): () => void {
  const registered: RegisteredHolder = {
    capture: () => holder.capture(),
    restoreUnknown: (value, report) => {
      try {
        const parsed = holder.parse(value);
        if (parsed === null) return;
        holder.restore(parsed, (entry, error) =>
          report({ holder: id, entry, error })
        );
      } catch (error) {
        report({ holder: id, entry: null, error });
      }
    },
  };
  holders.set(id, registered);
  if (id in pending) {
    const value = pending[id];
    delete pending[id];
    registered.restoreUnknown(value, pendingReport);
  }
  return () => {
    if (holders.get(id) === registered) holders.delete(id);
  };
}

/** Every holder's capture; a holder that throws holds nothing. */
export function captureHeldState(): HeldOperatorState | null {
  const held: HeldOperatorState = {};
  for (const [id, holder] of holders) {
    try {
      const value = holder.capture();
      if (value !== null && value !== undefined) held[id] = value;
    } catch {
      // One holder's failure costs only its own value.
    }
  }
  return Object.keys(held).length > 0 ? held : null;
}

/**
 * The previous run's held state: restored now or on registration, holder by
 * holder. Never throws; each failure goes to `report`.
 */
export function restoreHeldState(
  held: HeldOperatorState,
  report: RestoreReporter = () => {}
): void {
  pendingReport = report;
  for (const [id, value] of Object.entries(held)) {
    const holder = holders.get(id);
    if (holder) holder.restoreUnknown(value, report);
    else pending[id] = value;
  }
}

/** Tests only: the registry is module state. */
export function resetHeldStateForTest(): void {
  holders.clear();
  pending = {};
  pendingReport = () => {};
}
