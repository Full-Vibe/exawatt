/**
 * Board transition motion (ENG-004, decision `0024`).
 *
 * **Why this module exists.** The board used to have four independent motion
 * owners for one semantic event. Changing altitude re-laid-out the board, and
 * then: zone plates and edges jumped straight to their new coordinates, agent
 * pieces eased toward theirs at one rate, the camera flew at another, and every
 * HTML label ran its own third. The operator sees one board, so four timings
 * read as the pieces sliding against their own zones.
 *
 * **Damping is the wrong tool for a semantic transition.** `MathUtils.damp` is
 * excellent when the target keeps moving — following a selection, absorbing a
 * pan, relaxing a clamp — because it re-aims every frame and never has to know
 * where it is going. But it starts at maximum velocity: the instant the target
 * changes, speed steps from zero to `lambda x distance`. A step change in
 * velocity is a discontinuity in acceleration, which is exactly what reads as a
 * jerk. Damping also has no duration, so two damped things at different rates
 * arrive at different times and nothing can promise the board ever settles.
 *
 * So the board splits motion by kind, which is the part worth keeping:
 *
 * - **Semantic transitions** (altitude change, reframe) run off one shared
 *   clock with a real duration and an ease that leaves and arrives at rest.
 *   Every layer samples the same progress, so the field moves as one object.
 * - **Continuous motion** (pan, nudge, follow, hover lift, clamp rubber-band)
 *   keeps damping, because the target is still moving and there is nothing to
 *   arrive at.
 *
 * Everything here is pure so the feel can be tested without a GPU or a canvas.
 */

/**
 * One semantic transition, long enough to read as travel and short enough to
 * stay out of the way of the next input.
 */
export const BOARD_TRANSITION_MS = 460;

export interface BoardTransitionClock {
  /** `performance.now()` when the current transition began; null when idle. */
  startedAt: number | null;
  durationMs: number;
}

export function createBoardTransitionClock(): BoardTransitionClock {
  return { startedAt: null, durationMs: BOARD_TRANSITION_MS };
}

export function beginBoardTransition(
  clock: BoardTransitionClock,
  nowMs: number,
  durationMs: number = BOARD_TRANSITION_MS
): void {
  clock.startedAt = nowMs;
  clock.durationMs = Math.max(1, durationMs);
}

/**
 * Progress through the current transition, 0 at the start and 1 once it is
 * over. An idle clock reads 1: layers that sample it while nothing is happening
 * see "already arrived" and hold their resting pose.
 */
export function boardTransitionProgress(
  clock: BoardTransitionClock,
  nowMs: number
): number {
  if (clock.startedAt === null) return 1;
  const elapsed = nowMs - clock.startedAt;
  if (elapsed <= 0) return 0;
  if (elapsed >= clock.durationMs) return 1;
  return elapsed / clock.durationMs;
}

export function isBoardTransitionActive(
  clock: BoardTransitionClock,
  nowMs: number
): boolean {
  return clock.startedAt !== null && boardTransitionProgress(clock, nowMs) < 1;
}

/**
 * Abandon a transition wherever it is.
 *
 * Reduced motion can be switched on mid-flight, and a transition that is no
 * longer allowed to run must not be left half-applied.
 */
export function cancelBoardTransition(clock: BoardTransitionClock): void {
  clock.startedAt = null;
}

/** Mark a finished transition as idle so later frames stop sampling it. */
export function settleBoardTransition(
  clock: BoardTransitionClock,
  nowMs: number
): void {
  if (clock.startedAt !== null && boardTransitionProgress(clock, nowMs) >= 1) {
    clock.startedAt = null;
  }
}

/**
 * Ease with zero velocity at both ends, so a transition neither starts nor
 * stops with a snap. This is the property damping cannot offer.
 */
export function boardTransitionEase(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * Interpolate a camera zoom in log space.
 *
 * Zoom is multiplicative: 1 -> 2 and 2 -> 4 are the same visual change, so
 * mixing it linearly makes zooming in front-load and zooming out back-load the
 * same journey. Halfway through a linear 1 -> 4 the operator has already seen
 * two thirds of the change; halfway through 4 -> 1 they have seen a third.
 * Mixing in log space makes the perceived rate constant and the two directions
 * mirror images of each other.
 */
export function mixBoardZoom(from: number, to: number, t: number): number {
  const a = Math.max(from, 1e-6);
  const b = Math.max(to, 1e-6);
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
}

/** Frame-rate-independent zoom damping, also in log space. */
export function dampBoardZoom(
  current: number,
  target: number,
  lambda: number,
  deltaSeconds: number
): number {
  return mixBoardZoom(current, target, 1 - Math.exp(-lambda * deltaSeconds));
}

/**
 * The pose of the board field: a uniform-scale similarity transform applied to
 * every layer at once.
 */
export interface BoardFieldPose {
  x: number;
  y: number;
  scale: number;
}

export const BOARD_FIELD_IDENTITY: BoardFieldPose = { x: 0, y: 0, scale: 1 };

export interface BoardFieldPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * Bounds on the carry scale. A layout change that moves pieces very little can
 * produce an extreme least-squares fit, and an unbounded one would fling the
 * whole board.
 */
export const BOARD_FIELD_SCALE_LIMITS = { min: 0.35, max: 2.85 } as const;

/**
 * Find the pose that makes the NEW layout appear exactly where the old one is
 * currently drawn.
 *
 * On an altitude change the board re-lays-out from scratch, so without this the
 * pieces the operator was looking at teleport through the new origin. Fitting a
 * translation and uniform scale across the pieces present in both layouts lets
 * the board start the transition looking untouched, then relax to identity —
 * so what the operator was watching stays under their eye and the whole field
 * moves as one object rather than each layer rediscovering its own coordinates.
 *
 * `actual` is the pose the field is drawn at right now, not identity, so a
 * transition interrupted mid-flight continues from where it visibly is.
 *
 * Returns null when the layouts share no pieces, which is the caller's signal
 * that there is no continuity to preserve and the board should simply cut.
 */
export function carryBoardFieldPose(
  previous: ReadonlyMap<string, { x: number; y: number }>,
  next: readonly BoardFieldPoint[],
  actual: BoardFieldPose = BOARD_FIELD_IDENTITY
): BoardFieldPose | null {
  const common: { priorX: number; priorY: number; x: number; y: number }[] = [];
  for (const point of next) {
    const prior = previous.get(point.id);
    if (!prior) continue;
    common.push({
      priorX: actual.x + actual.scale * prior.x,
      priorY: actual.y + actual.scale * prior.y,
      x: point.x,
      y: point.y,
    });
  }
  if (common.length === 0) return null;

  let nextX = 0;
  let nextY = 0;
  let priorX = 0;
  let priorY = 0;
  for (const pair of common) {
    nextX += pair.x;
    nextY += pair.y;
    priorX += pair.priorX;
    priorY += pair.priorY;
  }
  nextX /= common.length;
  nextY /= common.length;
  priorX /= common.length;
  priorY /= common.length;

  // Least-squares uniform scale about the shared centroid.
  let numerator = 0;
  let denominator = 0;
  for (const pair of common) {
    const dx = pair.x - nextX;
    const dy = pair.y - nextY;
    numerator += dx * (pair.priorX - priorX) + dy * (pair.priorY - priorY);
    denominator += dx * dx + dy * dy;
  }
  // A single common piece, or pieces that all land on one point, carry no scale
  // information at all; translation alone is the honest answer.
  const scale =
    denominator > 0.0001
      ? Math.min(
          BOARD_FIELD_SCALE_LIMITS.max,
          Math.max(BOARD_FIELD_SCALE_LIMITS.min, numerator / denominator)
        )
      : 1;

  return {
    x: priorX - scale * nextX,
    y: priorY - scale * nextY,
    scale,
  };
}

/** Sample the field pose partway home, easing from `carry` toward identity. */
export function boardFieldPoseAt(
  carry: BoardFieldPose,
  progress: number
): BoardFieldPose {
  const eased = boardTransitionEase(progress);
  return {
    x: carry.x + (0 - carry.x) * eased,
    y: carry.y + (0 - carry.y) * eased,
    // Scale is multiplicative like zoom, for the same reason.
    scale: mixBoardZoom(carry.scale, 1, eased),
  };
}

/** Is this pose visibly different from resting? */
export function boardFieldPoseMoved(pose: BoardFieldPose): boolean {
  return (
    Math.abs(pose.x) > 0.001 ||
    Math.abs(pose.y) > 0.001 ||
    Math.abs(pose.scale - 1) > 0.0005
  );
}
