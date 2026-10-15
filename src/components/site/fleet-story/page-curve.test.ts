import { describe, expect, it } from 'vitest';
import {
  columnFollow,
  easeInOutCubic,
  followColumn,
  invSmoothstep,
  pagedProgress,
  railMove,
  shownProgress,
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

// The type that follows the scroll shows a paged move on one ease (W15p): the
// scroll slows almost to a stop at the window's edge and crosses the hold
// beyond it in a blink, and the column, which follows the scroll through the
// hold, covered the last of its way in three frames.
describe('the reading column through a paged move', () => {
  const moves: [string, number, number][] = [
    ['forward from the first', 0, 1],
    ['forward in the middle', 2, 3],
    ['back into the first', 1, 0],
  ];

  it.each(moves)('%s starts and ends where the scroll does', (_, from, to) => {
    const move = railMove(from, to, LAST);
    expect(shownProgress(0, move)).toBeCloseTo(move.from, 9);
    expect(shownProgress(1, move)).toBeCloseTo(move.to, 9);
  });

  it.each(moves)(
    '%s glides the last of the way in, where the scroll sprints',
    (_, from, to) => {
      const move = railMove(from, to, LAST);
      const span = Math.abs(move.to - move.from);
      // the share of the move covered in its last twentieth
      const shown = Math.abs(
        shownProgress(1, move) - shownProgress(0.95, move)
      );
      expect(shown).toBeLessThan(span * 0.001);
      // where the move ends past its window, the scroll crosses the hold
      // there in that twentieth
      if (Math.abs(move.to - move.far) > 1e-6)
        expect(
          Math.abs(pagedProgress(1, move) - pagedProgress(0.95, move))
        ).toBeGreaterThan(span * 0.2);
    }
  );

  it.each(moves)('%s moves one way, at rest at both ends', (_, from, to) => {
    const move = railMove(from, to, LAST);
    const span = Math.abs(move.to - move.from);
    const sign = Math.sign(move.to - move.from);
    const steps = 880;
    let last = shownProgress(0, move);
    let biggest = 0;
    for (let i = 1; i <= steps; i += 1) {
      const p = shownProgress(i / steps, move);
      expect((p - last) * sign).toBeGreaterThanOrEqual(0);
      biggest = Math.max(biggest, Math.abs(p - last));
      last = p;
    }
    // no millisecond carries more than one ease's steepest share
    expect(biggest).toBeLessThan((span * 1.51) / (steps / 2));
    // and the first and last milliseconds barely move
    expect(Math.abs(shownProgress(1 / steps, move) - move.from)).toBeLessThan(
      span * 1e-6
    );
    expect(Math.abs(move.to - shownProgress(1 - 1 / steps, move))).toBeLessThan(
      span * 1e-6
    );
  });

  const DT = 1 / 60;

  it('is the scroll itself outside a move', () => {
    const state = columnFollow();
    for (const raw of [0.25, 0.3, 0.71, 1.4, 1.39]) {
      expect(followColumn(state, raw, undefined, DT)).toBe(raw);
    }
  });

  it('shows the move, then lands with the scroll and stays with it', () => {
    const move = railMove(1, 2, LAST);
    const state = columnFollow();
    for (let i = 0; i <= 53; i += 1) {
      const paged = shownProgress(i / 53, move);
      // the scroll is wherever its own curve has it
      expect(followColumn(state, pagedProgress(i / 53, move), paged, DT)).toBe(
        paged
      );
    }
    // landed: the scroll is on the frame, and the column is the scroll's
    expect(followColumn(state, move.to, undefined, DT)).toBeCloseTo(move.to, 9);
    for (const raw of [move.to + 0.01, move.to + 0.05, move.to + 0.2])
      expect(followColumn(state, raw, undefined, DT)).toBeCloseTo(raw, 9);
  });

  it('ends a move cut short where it was, and closes on the scroll smoothly', () => {
    const move = railMove(1, 2, LAST);
    const state = columnFollow();
    for (let i = 0; i <= 10; i += 1)
      followColumn(
        state,
        pagedProgress(i / 53, move),
        shownProgress(i / 53, move),
        DT
      );
    const at = state.shown;
    // a finger catches the move: the scroll stops where it is
    const raw = pagedProgress(10 / 53, move);
    expect(Math.abs(raw - at)).toBeGreaterThan(0.05);
    // no jump: the first frame is where the column was
    expect(followColumn(state, raw, undefined, DT)).toBeCloseTo(at, 9);
    let gap = Math.abs(at - raw);
    let frames = 0;
    while (state.shown !== raw) {
      const shown = followColumn(state, raw, undefined, DT);
      const next = Math.abs(shown - raw);
      // closing, never by more than a quarter of what is left in a frame
      expect(next).toBeLessThan(gap);
      expect(next).toBeGreaterThan(gap * 0.75 - 1e-4);
      gap = next;
      frames += 1;
      expect(frames).toBeLessThan(60);
    }
    // then the scroll's, exactly, wherever a finger takes it
    for (const r of [raw + 0.03, raw - 0.1])
      expect(followColumn(state, r, undefined, DT)).toBe(r);
  });
});
