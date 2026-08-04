/**
 * Pure camera-input model for AgentField.
 *
 * Keyboard state produces a target velocity; the current velocity approaches
 * it exponentially and decays after release. Keeping this independent of React
 * and CameraControls makes the feel deterministic and unit-testable.
 */

export interface CameraVelocity {
  panX: number;
  panY: number;
  dolly: number;
  orbit: number;
}

export const CAMERA_SPEED = {
  /** field-radius fractions per second */
  pan: 0.42,
  /** dolly steps per second (Rig converts steps to field units) */
  dolly: 0.72,
  /** radians per second */
  orbit: 0.3,
} as const;

export const CAMERA_ACCEL_LAMBDA = 12;
export const CAMERA_DECEL_LAMBDA = 8;
export const CAMERA_VELOCITY_EPSILON = 0.0008;

const ZERO_AXIS: CameraVelocity = { panX: 0, panY: 0, dolly: 0, orbit: 0 };
const AXES: Record<string, CameraVelocity> = {
  a: { panX: -1, panY: 0, dolly: 0, orbit: 0 },
  d: { panX: 1, panY: 0, dolly: 0, orbit: 0 },
  w: { panX: 0, panY: -1, dolly: 0, orbit: 0 },
  s: { panX: 0, panY: 1, dolly: 0, orbit: 0 },
  '+': { panX: 0, panY: 0, dolly: 1, orbit: 0 },
  '=': { panX: 0, panY: 0, dolly: 1, orbit: 0 },
  '-': { panX: 0, panY: 0, dolly: -1, orbit: 0 },
  _: { panX: 0, panY: 0, dolly: -1, orbit: 0 },
  q: { panX: 0, panY: 0, dolly: 0, orbit: 1 },
  e: { panX: 0, panY: 0, dolly: 0, orbit: -1 },
};

export function normalizeCameraKey(key: string): string {
  return key.toLowerCase();
}

export function isCameraKey(key: string): boolean {
  return AXES[normalizeCameraKey(key)] !== undefined;
}

/** Compose pressed keys into a speed-scaled target without allocating. */
export function composeCameraTarget(
  pressed: ReadonlySet<string>,
  out: CameraVelocity
): CameraVelocity {
  out.panX = ZERO_AXIS.panX;
  out.panY = ZERO_AXIS.panY;
  out.dolly = ZERO_AXIS.dolly;
  out.orbit = ZERO_AXIS.orbit;

  for (const key of pressed) {
    const axis = AXES[key];
    if (!axis) continue;
    out.panX += axis.panX;
    out.panY += axis.panY;
    out.dolly += axis.dolly;
    out.orbit += axis.orbit;
  }

  // Diagonal panning should not be sqrt(2) faster than cardinal movement.
  const panLength = Math.hypot(out.panX, out.panY);
  if (panLength > 1) {
    out.panX /= panLength;
    out.panY /= panLength;
  }
  out.panX *= CAMERA_SPEED.pan;
  out.panY *= CAMERA_SPEED.pan;
  out.dolly = Math.max(-1, Math.min(1, out.dolly)) * CAMERA_SPEED.dolly;
  out.orbit = Math.max(-1, Math.min(1, out.orbit)) * CAMERA_SPEED.orbit;
  return out;
}

function damp(current: number, target: number, lambda: number, delta: number) {
  return target + (current - target) * Math.exp(-lambda * delta);
}

/** Mutates current and reports whether more settling frames are required. */
export function stepCameraVelocity(
  current: CameraVelocity,
  target: CameraVelocity,
  delta: number,
  reducedMotion = false
): boolean {
  const dt = Math.min(Math.max(delta, 0), 0.05);
  if (reducedMotion) {
    current.panX = target.panX;
    current.panY = target.panY;
    current.dolly = target.dolly;
    current.orbit = target.orbit;
  } else {
    const lambda =
      target.panX || target.panY || target.dolly || target.orbit
        ? CAMERA_ACCEL_LAMBDA
        : CAMERA_DECEL_LAMBDA;
    current.panX = damp(current.panX, target.panX, lambda, dt);
    current.panY = damp(current.panY, target.panY, lambda, dt);
    current.dolly = damp(current.dolly, target.dolly, lambda, dt);
    current.orbit = damp(current.orbit, target.orbit, lambda, dt);
  }

  if (cameraVelocitySettled(current, target)) {
    current.panX = target.panX;
    current.panY = target.panY;
    current.dolly = target.dolly;
    current.orbit = target.orbit;
    return false;
  }
  return true;
}

export function cameraVelocitySettled(
  current: CameraVelocity,
  target: CameraVelocity
): boolean {
  return (
    Math.abs(current.panX - target.panX) < CAMERA_VELOCITY_EPSILON &&
    Math.abs(current.panY - target.panY) < CAMERA_VELOCITY_EPSILON &&
    Math.abs(current.dolly - target.dolly) < CAMERA_VELOCITY_EPSILON &&
    Math.abs(current.orbit - target.orbit) < CAMERA_VELOCITY_EPSILON
  );
}

export function createCameraVelocity(): CameraVelocity {
  return { panX: 0, panY: 0, dolly: 0, orbit: 0 };
}
