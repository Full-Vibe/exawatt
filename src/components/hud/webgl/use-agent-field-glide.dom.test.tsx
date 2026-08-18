// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentFieldGlide, type CameraGlideHandle } from './use-agent-field-glide';

/**
 * The glide used to treat EVERY keyup as a release -- and a release step ran
 * `nudge` even with nothing moving. So a hotkey that was never a camera key
 * ('2', 'n', an arrow) ended in a zero-nudge that told the camera the operator
 * had taken the wheel: it dropped the semantic flight into damp mode,
 * re-clamped the target, and suspended follow. Measured on the board as a
 * stray zoom step between a hotkey and its flight.
 */
describe('useAgentFieldGlide', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    vi.restoreAllMocks();
  });

  function harness() {
    let now = 0;
    const queue: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    };
    globalThis.cancelAnimationFrame = () => undefined;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const tick = (ms = 16) => {
      now += ms;
      const pending = queue.splice(0);
      for (const cb of pending) cb(now);
    };
    const nudge = vi.fn();
    const controller: { current: CameraGlideHandle | null } = { current: { nudge } };
    renderHook(() => useAgentFieldGlide(controller));
    const key = (type: 'keydown' | 'keyup', k: string) =>
      window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    return { nudge, tick, key };
  }

  it('does not touch the camera when a non-camera key is pressed and released', () => {
    const { nudge, tick, key } = harness();
    key('keydown', '2');
    key('keyup', '2');
    for (let i = 0; i < 20; i += 1) tick();
    expect(nudge).not.toHaveBeenCalled();
  });

  it('never nudges by zero, even while settling after a real glide', () => {
    const { nudge, tick, key } = harness();
    key('keydown', 'd');
    for (let i = 0; i < 6; i += 1) tick();
    key('keyup', 'd');
    for (let i = 0; i < 60; i += 1) tick();
    expect(nudge).toHaveBeenCalled();
    for (const call of nudge.mock.calls) {
      const [dx, dy, dolly, orbit] = call as number[];
      expect(Math.abs(dx) + Math.abs(dy) + Math.abs(dolly) + Math.abs(orbit)).toBeGreaterThan(0);
    }
  });

  it('still glides for a held camera key and decelerates after release', () => {
    const { nudge, tick, key } = harness();
    key('keydown', 'w');
    for (let i = 0; i < 10; i += 1) tick();
    const heldCalls = nudge.mock.calls.length;
    expect(heldCalls).toBeGreaterThan(5);
    key('keyup', 'w');
    for (let i = 0; i < 60; i += 1) tick();
    expect(nudge.mock.calls.length).toBeGreaterThan(heldCalls);
    // Deceleration: the last pan step is smaller than the first after release.
    const after = nudge.mock.calls.slice(heldCalls) as number[][];
    expect(Math.abs(after[after.length - 1]![1]!)).toBeLessThan(Math.abs(after[0]![1]!));
  });
});
