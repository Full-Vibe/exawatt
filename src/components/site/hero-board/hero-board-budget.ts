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

/**
 * Status changes per second across the whole board.
 *
 * The brief's original band was two to five, chosen so the board reads as
 * telemetry rather than as decoration. RAISED 2026-08-17 (ENG-031 W9,
 * operator: "show more activity"): the impression a stranger should take from
 * this board is a fleet WORKING, and at 3.5 a second across 173 marks a
 * visitor watching one Project for five seconds could easily see nothing turn
 * in it.
 *
 * It is raised against the MEASURED budget rather than against the old band:
 * the whole at-rest allowance is 2 of 255 mean delta and 5% of pixels a
 * second, the board measured 0.159 and 0.32% at 3.5, and status turns are
 * where essentially all of that goes. Nine a second is well inside the budget
 * and `pnpm eval:hero-board` gates it on every landing, so this number cannot
 * be raised past what the page can afford without the gate saying so.
 */
export const STATUS_CHANGES_PER_SECOND = 9;

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
