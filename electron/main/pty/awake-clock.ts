/**
 * The awake clock: milliseconds the machine has been awake, for every
 * measurement of a Session's silence (ENG-002, review front 2026-11-05).
 *
 * The attention monitor reclaims a reported turn after enough silence, and
 * session liveness names a harness that stopped writing. Both measured
 * silence on the wall clock, so a Mac that slept through a turn woke to a
 * "silence" as long as the sleep: a turn reclaimed as abandoned and a
 * `liveness.stall` blaming the harness, with `silentMs` equal to the sleep
 * (the "412 s stall = 414 s sleep" pattern). Suspended time is not silence.
 *
 * Fed by the host power observer (`host-power.ts`, Electron's
 * `powerMonitor`): `suspend` freezes the clock and `resume` lets it run on
 * from where it stopped. On wake, a timer can fire before `resume` arrives;
 * the clock is still frozen then, so that sweep sees no sleep either.
 *
 * Pure Node. Record timestamps (`since`, log lines) stay on the wall clock:
 * this clock is only ever subtracted from itself.
 */
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';

export interface AwakeClock {
  /** Awake milliseconds, comparable only with another reading of this clock. */
  now(): number;
  suspended(): void;
  resumed(): void;
}

export function createAwakeClock(wall: () => number = Date.now): AwakeClock {
  /** wall time spent suspended, over every completed sleep */
  let slept = 0;
  /** wall time the current sleep began, while suspended */
  let suspendedAt: number | null = null;
  return {
    now: () => (suspendedAt ?? wall()) - slept,
    suspended() {
      if (suspendedAt === null) suspendedAt = wall();
    },
    resumed() {
      if (suspendedAt === null) return;
      slept += Math.max(0, wall() - suspendedAt);
      suspendedAt = null;
    },
  };
}

/** The power facts the clock needs: the host power observer's surface. */
interface PowerSnapshots {
  getSnapshot(): Pick<HostPowerSnapshot, 'systemSleep'>;
  subscribe(listener: (snapshot: HostPowerSnapshot) => void): () => void;
}

/** Drive `clock` from the host's sleep state. Returns the unsubscribe. */
export function feedAwakeClock(
  clock: AwakeClock,
  power: PowerSnapshots
): () => void {
  const apply = (sleep: HostPowerSnapshot['systemSleep']) =>
    sleep === 'suspended' ? clock.suspended() : clock.resumed();
  apply(power.getSnapshot().systemSleep);
  return power.subscribe(snapshot => apply(snapshot.systemSleep));
}

/** The app's one awake clock. */
export const awakeClock = createAwakeClock();
