export const BROWN_SWITCH_SHOULDER_START_SECONDS = 0.052;
export const BROWN_SWITCH_SHOULDER_END_SECONDS = 0.112;
export const BROWN_SWITCH_PRESS_DURATION_SECONDS = 0.19;
export const BROWN_SWITCH_SHOULDER_START = 0.36;
export const BROWN_SWITCH_SHOULDER_END = 0.42;

function smoothStep(progress: number) {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

/**
 * A visual force curve with a brief upper-travel shoulder before actuation.
 * It cannot read real finger force, but it gives the cap a Brown-like tactile
 * break instead of moving through its full travel at one constant rate.
 */
export function sampleBrownSwitchPress(elapsed: number) {
  if (elapsed < BROWN_SWITCH_SHOULDER_START_SECONDS) {
    return (
      BROWN_SWITCH_SHOULDER_START *
      smoothStep(elapsed / BROWN_SWITCH_SHOULDER_START_SECONDS)
    );
  }
  if (elapsed < BROWN_SWITCH_SHOULDER_END_SECONDS) {
    return lerp(
      BROWN_SWITCH_SHOULDER_START,
      BROWN_SWITCH_SHOULDER_END,
      smoothStep(
        (elapsed - BROWN_SWITCH_SHOULDER_START_SECONDS) /
          (BROWN_SWITCH_SHOULDER_END_SECONDS -
            BROWN_SWITCH_SHOULDER_START_SECONDS)
      )
    );
  }
  if (elapsed < BROWN_SWITCH_PRESS_DURATION_SECONDS) {
    return lerp(
      BROWN_SWITCH_SHOULDER_END,
      1,
      smoothStep(
        (elapsed - BROWN_SWITCH_SHOULDER_END_SECONDS) /
          (BROWN_SWITCH_PRESS_DURATION_SECONDS -
            BROWN_SWITCH_SHOULDER_END_SECONDS)
      )
    );
  }
  return 1;
}
