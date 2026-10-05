/**
 * Ambient motion policy for the board's demand loop.
 *
 * The working rotors and the selection ring are the board's only continuous
 * motion, and they keep the demand loop alive by requesting the next frame
 * from inside `useFrame`. This module decides how often that request may
 * paint. Power is a cadence, never a state (BUG-263): on AC the display's
 * refresh is the cadence; on battery, or on weak hardware, ambient frames
 * arrive on a bounded timer so a Working mark still turns while the GPU does
 * a fraction of the work; only an operator preference (reduced motion) or a
 * board nobody can see (hidden tab, locked screen, suspended host) parks the
 * loop. Resolution is a display fact and is never traded for power here.
 *
 * The 2026-09-25 battery fix routed the host's battery fact into the
 * weak-hardware low-power path, which also caps `dpr` at 1.25 and drops bloom.
 * On a 2x laptop display that painted the whole board soft and froze every
 * rotor at once: the "frozen and blurry" report of 2026-09-30.
 */

export type AmbientCadence = 'display' | 'economy' | 'parked';

/** Economy frames arrive this far apart (plus one display refresh while R3F
 * schedules the paint). A 2.4 s rotor turns about 7 degrees per frame: still
 * motion, at a fifth of a 120 Hz display's work. */
export const ECONOMY_AMBIENT_FRAME_MS = 40;

/** Per-frame delta a continuous rotor may consume. Admits an economy frame
 * whole (so the rotor's speed does not depend on the power source) and still
 * caps the jump after a stall at 15 degrees of a 2.4 s turn. */
export const AMBIENT_FRAME_DELTA_CAP_S = 0.1;

export function resolveAmbientCadence({
  reduced,
  visible,
  lowPower,
  onBattery,
}: {
  /** `prefers-reduced-motion: reduce`. */
  reduced: boolean;
  /** The page is visible and the host is unlocked and awake. */
  visible: boolean;
  /** Weak hardware (the shared `lowPowerLikely` heuristic). */
  lowPower: boolean;
  /** The host runs on battery. */
  onBattery: boolean;
}): AmbientCadence {
  if (reduced || !visible) return 'parked';
  return lowPower || onBattery ? 'economy' : 'display';
}

/** What a continuous animation holds: the cadence it is under and the one
 * way it asks for its next frame. Stable per cadence so memo boundaries hold. */
export interface AmbientMotion {
  cadence: AmbientCadence;
  /** Request the next ambient frame. Under `display` this paints on the next
   * refresh; under `economy` one shared timer coalesces every request into
   * one paint; under `parked` nothing is requested. */
  requestFrame(invalidate: () => void): void;
}

/** A specimen that never turns: for static rigs and galleries that show the
 * marks without owning a demand loop. */
export const PARKED_AMBIENT: AmbientMotion = Object.freeze({
  cadence: 'parked',
  requestFrame() {},
});

interface AmbientFrameScheduler {
  request(cadence: AmbientCadence, invalidate: () => void): void;
  /** Drops a pending economy frame. Call on unmount. */
  dispose(): void;
}

/** One scheduler per canvas: the rotors and the selection ring share it, so
 * economy mode paints once per interval however many animations are live. */
export function createAmbientFrameScheduler(
  setTimer: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout> = setTimeout,
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout
): AmbientFrameScheduler {
  let pending: ReturnType<typeof setTimeout> | null = null;
  let latest: (() => void) | null = null;
  return {
    request(cadence, invalidate) {
      if (cadence === 'parked') return;
      if (cadence === 'display') {
        invalidate();
        return;
      }
      latest = invalidate;
      if (pending !== null) return;
      pending = setTimer(() => {
        pending = null;
        const paint = latest;
        latest = null;
        paint?.();
      }, ECONOMY_AMBIENT_FRAME_MS);
    },
    dispose() {
      if (pending !== null) clearTimer(pending);
      pending = null;
      latest = null;
    },
  };
}
