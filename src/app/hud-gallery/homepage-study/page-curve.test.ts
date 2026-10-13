import { describe, expect, it } from 'vitest';
import {
  easeInOutCubic,
  invSmoothstep,
  pagedProgress,
  railMove,
} from './page-curve';
import { RAIL_DWELL, stageBlend, STAGES } from './stages';

const LAST = STAGES.length - 1;

describe('invSmoothstep', () => {
  it('undoes smoothstep', () => {
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const y = u * u * (3 - 2 * u);
      expect(invSmoothstep(y)).toBeCloseTo(Math.min(1, u), 6);
    }
  });
});

describe('a paged move', () => {
  const moves: [string, number, number][] = [
    ['forward from the first', 0, 1],
    ['forward in the middle', 2, 3],
    ['forward into the last', LAST - 1, LAST],
    ['back from the last', LAST, LAST - 1],
    ['back in the middle', 3, 2],
    ['back into the first', 1, 0],
  ];

  it.each(moves)('%s starts and ends where it should', (_, from, to) => {
    const move = railMove(from, to, LAST);
    expect(pagedProgress(0, move)).toBeCloseTo(move.from, 9);
    expect(pagedProgress(1, move)).toBeCloseTo(move.to, 9);
  });

  it.each(moves)('%s moves one way, never back', (_, from, to) => {
    const move = railMove(from, to, LAST);
    const sign = Math.sign(move.to - move.from);
    let last = pagedProgress(0, move);
    for (let i = 1; i <= 400; i += 1) {
      const p = pagedProgress(i / 400, move);
      expect((p - last) * sign).toBeGreaterThanOrEqual(-1e-12);
      last = p;
    }
  });

  it.each(moves)('%s is continuous: no jump anywhere', (_, from, to) => {
    const move = railMove(from, to, LAST);
    const span = Math.abs(move.to - move.from);
    let last = pagedProgress(0, move);
    let biggest = 0;
    for (let i = 1; i <= 880; i += 1) {
      const p = pagedProgress(i / 880, move);
      biggest = Math.max(biggest, Math.abs(p - last));
      last = p;
    }
    // no single millisecond covers more than a fifth of the move, even
    // through the quick dwell crossings at the ends
    expect(biggest).toBeLessThan(span * 0.2);
  });

  it('puts the camera on the easing curve through the window', () => {
    // the camera's parameter, read off the rail the way the rig reads it,
    // follows the S-curve, which is the point of the move
    const move = railMove(2, 3, LAST);
    for (let m = 0.05; m <= 0.95; m += 0.05) {
      // map the middle of the move back to its tau
      const tau = 0.05 + m * 0.9;
      const progress = pagedProgress(tau, move);
      const t = stageBlend(progress).t;
      expect(t).toBeCloseTo(easeInOutCubic(m), 3);
    }
  });

  it('spends most of its time with the camera moving', () => {
    const move = railMove(2, 3, LAST);
    let moving = 0;
    const steps = 880;
    for (let i = 0; i <= steps; i += 1) {
      const t = stageBlend(pagedProgress(i / steps, move)).t;
      if (t > 0.002 && t < 0.998) moving += 1;
    }
    // a plain ease on the scroll would leave the camera moving for a fifth
    expect(moving / steps).toBeGreaterThan(0.75);
  });

  it('crosses the dwell at either end without moving the camera', () => {
    const move = railMove(2, 3, LAST);
    expect(stageBlend(pagedProgress(0.02, move)).t).toBe(0);
    expect(stageBlend(pagedProgress(0.98, move)).t).toBe(1);
    expect(RAIL_DWELL).toBeGreaterThan(0);
  });

  it('has no lead where the move starts at its window, and no tail where it ends', () => {
    const first = railMove(0, 1, LAST);
    // the first frame rests at the window's edge already
    expect(first.from).toBeCloseTo(first.near, 9);
    const camera = stageBlend(pagedProgress(0.04, first)).t;
    expect(camera).toBeGreaterThan(0);
    const into = railMove(LAST - 1, LAST, LAST);
    expect(into.to).toBeCloseTo(into.far, 9);
  });
});
