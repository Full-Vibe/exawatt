/**
 * The hero board's measured budget and its motion constants (ENG-031 W2).
 *
 * The board has ONE behaviour: planted at rest, and the page scroll drives the
 * altitude pull from Fleet to Team to Agent. The operator chose it on
 * 2026-08-17 and the alternatives were deleted rather than left switchable —
 * the ambient orbit destroyed the readable layout that is the product's whole
 * claim, and a standalone planted option is just this board with nobody
 * scrolling.
 *
 * `projects/website-overhaul.md` -> "The hero board" owns the brief.
 */

/** Status changes per second across the whole board (brief: two to five). */
export const STATUS_CHANGES_PER_SECOND = 3.5;

/**
 * The measured idle budget, from 16 premium product sites
 * (`docs/research/market/2026-08-14-website-design-research.md`).
 * Reference points: GitHub 0.0%, Vercel 0.6%, Spline 1.4%, Lusion 46%.
 */
export const IDLE_BUDGET = {
  /** Mean absolute per-channel delta between two frames one second apart. */
  meanChannelDelta: 2,
  /** Share of pixels that change in one second. Above 10% reads as a screensaver. */
  changedPixelShare: 0.05,
  /** Device pixel ratio ceiling — the production median for a hero. */
  maxDpr: 1.5,
  /** Units are one InstancedMesh; zones and ground are one each. */
  maxDrawCalls: 4,
} as const;
