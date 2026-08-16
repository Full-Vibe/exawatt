import { describe, expect, it } from 'vitest';
import {
  BOARD_FIELD_IDENTITY,
  BOARD_FIELD_SCALE_LIMITS,
  BOARD_TRANSITION_MS,
  beginBoardTransition,
  boardFieldPoseAt,
  boardFieldPoseMoved,
  boardTransitionEase,
  boardTransitionProgress,
  carryBoardFieldPose,
  createBoardTransitionClock,
  dampBoardZoom,
  isBoardTransitionActive,
  mixBoardZoom,
  settleBoardTransition,
} from './operations-board-transition';

describe('board transition clock', () => {
  it('reads as arrived while idle, so resting layers hold still', () => {
    const clock = createBoardTransitionClock();
    expect(boardTransitionProgress(clock, 1000)).toBe(1);
    expect(isBoardTransitionActive(clock, 1000)).toBe(false);
  });

  it('runs from 0 to 1 across its duration and then stays there', () => {
    const clock = createBoardTransitionClock();
    beginBoardTransition(clock, 1000);
    expect(boardTransitionProgress(clock, 1000)).toBe(0);
    expect(boardTransitionProgress(clock, 1000 + BOARD_TRANSITION_MS / 2)).toBe(
      0.5
    );
    expect(boardTransitionProgress(clock, 1000 + BOARD_TRANSITION_MS)).toBe(1);
    expect(boardTransitionProgress(clock, 99999)).toBe(1);
  });

  it('gives every layer the same progress at the same instant', () => {
    // The whole point: one clock, many samplers, no divergence.
    const clock = createBoardTransitionClock();
    beginBoardTransition(clock, 0);
    const samples = [0, 1, 2, 3].map(() => boardTransitionProgress(clock, 120));
    expect(new Set(samples).size).toBe(1);
  });

  it('settles only once it is actually over', () => {
    const clock = createBoardTransitionClock();
    beginBoardTransition(clock, 0);
    settleBoardTransition(clock, BOARD_TRANSITION_MS - 1);
    expect(clock.startedAt).not.toBeNull();
    settleBoardTransition(clock, BOARD_TRANSITION_MS);
    expect(clock.startedAt).toBeNull();
  });
});

describe('board transition ease', () => {
  it('leaves and arrives at rest, which damping cannot do', () => {
    // Velocity at the endpoints is what reads as a jerk. Sample the slope just
    // inside each end and require it to be far below the mid-flight slope.
    const step = 1e-4;
    const startSlope = (boardTransitionEase(step) - boardTransitionEase(0)) / step;
    const endSlope = (boardTransitionEase(1) - boardTransitionEase(1 - step)) / step;
    const midSlope =
      (boardTransitionEase(0.5 + step) - boardTransitionEase(0.5 - step)) /
      (2 * step);
    expect(startSlope).toBeLessThan(midSlope * 0.01);
    expect(endSlope).toBeLessThan(midSlope * 0.01);
  });

  it('is pinned at both ends and symmetric about the middle', () => {
    expect(boardTransitionEase(0)).toBe(0);
    expect(boardTransitionEase(1)).toBe(1);
    expect(boardTransitionEase(0.5)).toBeCloseTo(0.5, 6);
    expect(boardTransitionEase(0.25) + boardTransitionEase(0.75)).toBeCloseTo(
      1,
      6
    );
  });

  it('clamps rather than overshooting out-of-range progress', () => {
    expect(boardTransitionEase(-1)).toBe(0);
    expect(boardTransitionEase(2)).toBe(1);
  });

  it('never runs backwards', () => {
    let previous = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const value = boardTransitionEase(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('zoom mixing', () => {
  it('treats zooming in and out as mirror images', () => {
    // Linear mixing puts 1 -> 4 at 66% perceived progress halfway through and
    // 4 -> 1 at 34%, which is why the two directions used to feel different.
    const inHalf = mixBoardZoom(1, 4, 0.5);
    const outHalf = mixBoardZoom(4, 1, 0.5);
    expect(inHalf).toBeCloseTo(2, 6);
    expect(outHalf).toBeCloseTo(2, 6);
    expect(inHalf).toBeCloseTo(outHalf, 6);
  });

  it('holds the endpoints exactly', () => {
    expect(mixBoardZoom(0.4, 6.2, 0)).toBeCloseTo(0.4, 6);
    expect(mixBoardZoom(0.4, 6.2, 1)).toBeCloseTo(6.2, 6);
  });

  it('covers equal ratios in equal steps', () => {
    // Each quarter of the journey from 1 to 16 should multiply zoom by 2.
    const quarters = [0, 0.25, 0.5, 0.75, 1].map(t => mixBoardZoom(1, 16, t));
    for (let i = 1; i < quarters.length; i += 1) {
      expect(quarters[i] / quarters[i - 1]).toBeCloseTo(2, 6);
    }
  });

  it('damps toward the target frame-rate independently', () => {
    const oneBigStep = dampBoardZoom(1, 4, 5.5, 0.1);
    let stepped = 1;
    for (let i = 0; i < 10; i += 1) stepped = dampBoardZoom(stepped, 4, 5.5, 0.01);
    expect(stepped).toBeCloseTo(oneBigStep, 6);
  });

  it('survives a zero or negative zoom without producing NaN', () => {
    expect(Number.isFinite(mixBoardZoom(0, 4, 0.5))).toBe(true);
    expect(Number.isFinite(mixBoardZoom(4, 0, 0.5))).toBe(true);
  });
});

describe('field carry pose', () => {
  const previous = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 10, y: 0 }],
    ['c', { x: 0, y: 10 }],
  ]);

  it('renders the new layout exactly where the old one is drawn', () => {
    // The new layout is the old one scaled by 2 about the origin. The carry
    // must undo that, so the operator sees no jump on the first frame.
    const next = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 20, y: 0 },
      { id: 'c', x: 0, y: 20 },
    ];
    const carry = carryBoardFieldPose(previous, next)!;
    expect(carry.scale).toBeCloseTo(0.5, 6);
    for (const point of next) {
      const prior = previous.get(point.id)!;
      expect(carry.x + carry.scale * point.x).toBeCloseTo(prior.x, 6);
      expect(carry.y + carry.scale * point.y).toBeCloseTo(prior.y, 6);
    }
  });

  it('recovers a pure translation with no phantom scale', () => {
    const next = [
      { id: 'a', x: 5, y: 7 },
      { id: 'b', x: 15, y: 7 },
      { id: 'c', x: 5, y: 17 },
    ];
    const carry = carryBoardFieldPose(previous, next)!;
    expect(carry.scale).toBeCloseTo(1, 6);
    expect(carry.x).toBeCloseTo(-5, 6);
    expect(carry.y).toBeCloseTo(-7, 6);
  });

  it('resolves an unchanged layout to identity', () => {
    const next = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'c', x: 0, y: 10 },
    ];
    const carry = carryBoardFieldPose(previous, next)!;
    expect(carry.x).toBeCloseTo(0, 6);
    expect(carry.y).toBeCloseTo(0, 6);
    expect(carry.scale).toBeCloseTo(1, 6);
    expect(boardFieldPoseMoved(carry)).toBe(false);
  });

  it('continues from where the field is actually drawn, not from identity', () => {
    // An altitude change arriving mid-transition must not snap back.
    const next = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'c', x: 0, y: 10 },
    ];
    const actual = { x: 3, y: -4, scale: 1.5 };
    const carry = carryBoardFieldPose(previous, next, actual)!;
    for (const point of next) {
      const prior = previous.get(point.id)!;
      expect(carry.x + carry.scale * point.x).toBeCloseTo(
        actual.x + actual.scale * prior.x,
        6
      );
      expect(carry.y + carry.scale * point.y).toBeCloseTo(
        actual.y + actual.scale * prior.y,
        6
      );
    }
  });

  it('ignores pieces that only exist on one side', () => {
    const next = [
      { id: 'a', x: 5, y: 7 },
      { id: 'b', x: 15, y: 7 },
      { id: 'c', x: 5, y: 17 },
      { id: 'brand-new', x: 900, y: 900 },
    ];
    const carry = carryBoardFieldPose(previous, next)!;
    expect(carry.scale).toBeCloseTo(1, 6);
    expect(carry.x).toBeCloseTo(-5, 6);
  });

  it('reports no continuity when the layouts share nothing', () => {
    expect(
      carryBoardFieldPose(previous, [{ id: 'z', x: 1, y: 1 }])
    ).toBeNull();
    expect(carryBoardFieldPose(new Map(), [{ id: 'a', x: 0, y: 0 }])).toBeNull();
  });

  it('falls back to translation when a single piece carries no scale', () => {
    const carry = carryBoardFieldPose(previous, [{ id: 'a', x: 4, y: 4 }])!;
    expect(carry.scale).toBe(1);
    expect(carry.x).toBeCloseTo(-4, 6);
    expect(carry.y).toBeCloseTo(-4, 6);
  });

  it('bounds the scale so a degenerate fit cannot fling the board', () => {
    const huge = carryBoardFieldPose(previous, [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0.001, y: 0 },
      { id: 'c', x: 0, y: 0.001 },
    ])!;
    expect(huge.scale).toBeLessThanOrEqual(BOARD_FIELD_SCALE_LIMITS.max);
    expect(huge.scale).toBeGreaterThanOrEqual(BOARD_FIELD_SCALE_LIMITS.min);
  });
});

describe('field pose sampling', () => {
  const carry = { x: 8, y: -6, scale: 0.5 };

  it('starts on the carry and ends at rest', () => {
    const start = boardFieldPoseAt(carry, 0);
    expect(start.x).toBeCloseTo(carry.x, 6);
    expect(start.y).toBeCloseTo(carry.y, 6);
    expect(start.scale).toBeCloseTo(carry.scale, 6);

    const end = boardFieldPoseAt(carry, 1);
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(0, 6);
    expect(end.scale).toBeCloseTo(1, 6);
    expect(boardFieldPoseMoved(end)).toBe(false);
  });

  it('moves monotonically home', () => {
    let previousDistance = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const pose = boardFieldPoseAt(carry, t);
      const distance = Math.hypot(pose.x, pose.y);
      expect(distance).toBeLessThanOrEqual(previousDistance + 1e-9);
      previousDistance = distance;
    }
  });

  it('holds identity when there is nothing to carry', () => {
    const pose = boardFieldPoseAt(BOARD_FIELD_IDENTITY, 0.5);
    expect(boardFieldPoseMoved(pose)).toBe(false);
  });
});
