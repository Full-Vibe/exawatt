import { describe, expect, it } from 'vitest';
import {
  CAMERA_SPEED,
  cameraVelocitySettled,
  composeCameraTarget,
  createCameraVelocity,
  isCameraKey,
  stepCameraVelocity,
} from './agent-field-motion';

describe('AgentField camera input model', () => {
  it('recognizes only supported camera keys', () => {
    expect(isCameraKey('A')).toBe(true);
    expect(isCameraKey('ArrowLeft')).toBe(false);
    expect(isCameraKey('Q')).toBe(true);
    expect(isCameraKey('+')).toBe(true);
    expect(isCameraKey('n')).toBe(false);
  });

  it('normalizes diagonal pan speed', () => {
    const target = composeCameraTarget(
      new Set(['d', 's']),
      createCameraVelocity()
    );
    expect(Math.hypot(target.panX, target.panY)).toBeCloseTo(
      CAMERA_SPEED.pan,
      6
    );
  });

  it('accelerates over frames instead of applying an instantaneous tap kick', () => {
    const current = createCameraVelocity();
    const target = composeCameraTarget(new Set(['d']), createCameraVelocity());

    stepCameraVelocity(current, target, 1 / 60);
    expect(current.panX).toBeGreaterThan(0);
    expect(current.panX).toBeLessThan(target.panX);
  });

  it('decelerates monotonically after release and eventually parks', () => {
    const current = createCameraVelocity();
    current.panX = CAMERA_SPEED.pan;
    const zero = createCameraVelocity();
    let previous = current.panX;
    let moving = true;

    for (let i = 0; i < 180 && moving; i++) {
      moving = stepCameraVelocity(current, zero, 1 / 60);
      expect(current.panX).toBeLessThanOrEqual(previous);
      previous = current.panX;
    }

    expect(moving).toBe(false);
    expect(current.panX).toBe(0);
    expect(cameraVelocitySettled(current, zero)).toBe(true);
  });

  it('clamps long frame deltas before integration', () => {
    const target = composeCameraTarget(new Set(['q']), createCameraVelocity());
    const a = createCameraVelocity();
    const b = createCameraVelocity();
    stepCameraVelocity(a, target, 0.05);
    stepCameraVelocity(b, target, 2);
    expect(b.orbit).toBeCloseTo(a.orbit, 8);
  });
});
