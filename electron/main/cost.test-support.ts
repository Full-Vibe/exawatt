/**
 * Assert the invariant, not the duration (BUG-057).
 *
 * Several tests in this tree guard an algorithmic property: replay costs the
 * journal's BYTES rather than its records times the retained window; appending
 * costs the delta rather than the transcript; rendering a transcript costs its
 * length rather than its square. Each of them originally expressed that
 * property as a millisecond budget, which measures the host as much as the
 * code. With several agent worktrees compiling and testing at once the host
 * loses, so the suite failed on load and passed on rerun, and the signal the
 * budget existed to carry was lost in the noise.
 *
 * Transient allocation carries the same signal and does not move with CPU
 * contention: every rebuilt window becomes garbage the moment the next record
 * rebuilds it, so the volume the collector reclaims is a direct reading of how
 * much work per unit of input the implementation does. It is the instrument
 * `scripts/transcript-replay-probe.mjs` used to diagnose incident 0008 in the
 * first place; this is the same measurement, kept as a gate.
 */
import { GCProfiler, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

export interface TransientAllocation<T> {
  value: T;
  /** Bytes the collector reclaimed while the measured work ran. */
  bytes: number;
}

function reclaimed(profiler: GCProfiler): number {
  const events = profiler.stop().statistics ?? [];
  return events.reduce(
    (total, event) =>
      total +
      Math.max(
        0,
        (event.beforeGC?.heapStatistics?.usedHeapSize ?? 0) -
          (event.afterGC?.heapStatistics?.usedHeapSize ?? 0)
      ),
    0
  );
}

/**
 * `GCProfiler` reports everything reclaimed while it is active, including
 * garbage an earlier test left behind. Collect that older generation before
 * starting the profiler so the result belongs to `work`, not to whichever
 * file happened to share this Vitest worker first.
 *
 * Node does not expose `gc` by default. V8 supports enabling it at runtime;
 * keep the function (and its VM context) alive for the process so creating the
 * measurement boundary cannot itself become garbage inside the measurement.
 */
const collectBeforeMeasurement: () => void = (() => {
  const exposed = (globalThis as { gc?: () => void }).gc;
  if (exposed) return exposed;

  setFlagsFromString('--expose_gc');
  try {
    return runInNewContext('gc') as () => void;
  } finally {
    setFlagsFromString('--no-expose_gc');
  }
})();

/** Run `work` and report how many bytes of garbage it produced. */
export function transientAllocation<T>(work: () => T): TransientAllocation<T> {
  collectBeforeMeasurement();
  const profiler = new GCProfiler();
  profiler.start();
  const value = work();
  return { value, bytes: reclaimed(profiler) };
}

/** The awaited form, for stores that replay from disk. */
export async function transientAllocationAsync<T>(
  work: () => Promise<T>
): Promise<TransientAllocation<T>> {
  collectBeforeMeasurement();
  const profiler = new GCProfiler();
  profiler.start();
  const value = await work();
  return { value, bytes: reclaimed(profiler) };
}
