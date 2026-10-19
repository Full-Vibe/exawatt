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
 */
export interface HeldStateHolder<T> {
  /** Null when there is nothing worth holding. */
  capture(): T | null;
  /** Rejects anything that is not this holder's shape. */
  parse(value: unknown): T | null;
  restore(value: T): void;
}

interface RegisteredHolder {
  capture(): unknown;
  restoreUnknown(value: unknown): void;
}

const holders = new Map<string, RegisteredHolder>();
let pending: HeldOperatorState = {};

export function registerHeldState<T>(
  id: string,
  holder: HeldStateHolder<T>
): () => void {
  const registered: RegisteredHolder = {
    capture: () => holder.capture(),
    restoreUnknown: value => {
      const parsed = holder.parse(value);
      if (parsed !== null) holder.restore(parsed);
    },
  };
  holders.set(id, registered);
  if (id in pending) {
    const value = pending[id];
    delete pending[id];
    registered.restoreUnknown(value);
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

/** The previous run's held state: restored now or on registration. */
export function restoreHeldState(held: HeldOperatorState): void {
  for (const [id, value] of Object.entries(held)) {
    const holder = holders.get(id);
    if (holder) holder.restoreUnknown(value);
    else pending[id] = value;
  }
}

/** Tests only: the registry is module state. */
export function resetHeldStateForTest(): void {
  holders.clear();
  pending = {};
}
