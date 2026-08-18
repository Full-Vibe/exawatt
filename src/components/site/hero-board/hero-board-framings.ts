/**
 * Where the hero board's camera sits at each altitude (ENG-031 W2, extracted
 * and made monotonic in W9).
 *
 * Pure geometry over the frozen capture: no R3F, no hooks, no canvas. It lives
 * apart from `hero-board-scene.tsx` so the ONE property the whole sequence now
 * depends on can be asserted by a test instead of watched for by eye.
 *
 * THE PATH ONLY EVER GOES IN (operator, 2026-08-17): "I think the zoom is a
 * little bouncy, I like it when it goes only one direction smoothly across
 * multiple steps." Until W9 the run opened on the fold's crop, pulled OUT to
 * the whole fleet, dove IN to one agent, and pulled OUT again for the last
 * three panels. Three reversals in six panels is what read as bounce, and no
 * amount of easing fixes a path that turns around: each reversal is a real
 * change of direction the eye is right to notice.
 *
 * So every rung of the ladder either HOLDS or CLOSES IN, and the fitted
 * distance across the run is monotonically non-increasing. The board's own
 * argument is a dive that ends on one agent, which is also where the page
 * hands off to its call to action.
 *
 * THE ASSERTION IS ON A PROXY, AND THE PROXY IS EXACT. The rig fits each
 * framing with camera-controls' `getDistanceToFitSphere(radius)`, which is
 * `radius / sin(fov / 2)` for a perspective camera: strictly proportional to
 * the radius for a fixed viewport. So `radius * tightness * crop` orders the
 * framings exactly as the fitted distances do, at every viewport, without a
 * WebGL context in the test. `framingDistanceScale()` is that number, and the
 * zoom floor the rig applies afterwards is a `Math.max` with one constant,
 * which preserves order.
 */
import * as THREE from 'three';
import type { HeroBoardCapture } from './capture-types';
import { heroBoardSubjects } from './hero-board-subjects';

/** How tightly each altitude frames its bounding sphere. Below 1 crops in.
 *  Fleet opened out from 0.66 once the Projects were named (2026-08-17): a
 *  crop that carries scale is worth having, a crop that cuts two Project
 *  labels off the bottom edge is not. */
export const FRAMING_TIGHTNESS = {
  fleet: 0.74,
  team: 0.86,
  agent: 0.95,
  /** The fold's crop, as a share of the fleet's own bounding sphere. Tuned so
   *  three to four Project clusters fill a 58%-width column and a single mark
   *  is still an individual rather than a pixel. */
  clusterRadius: 0.5,
  /**
   * THE FIRST SCROLL MOVES THE CAMERA (ENG-031 W10, operator: "I do want some
   * sort of camera change / zoom / animation on the first scroll section -
   * right now the scene is static").
   *
   * W9 held the fold's crop through the attention panel, on the reasoning that
   * a still camera over a changing board is the beat a competitor cannot
   * screenshot. Read from the top of the page that reasoning inverts: the
   * reader's FIRST scroll is where they find out whether the picture is alive,
   * and a board that answers it by holding still reads as a screenshot no
   * matter what the marks are doing. So the attention panel takes its own rung
   * ten percent in from the fold.
   *
   * Ten percent, not thirty: the crop is the fold's own composition and the
   * panel beside it is about what the COLOURS mean, so the move has to be
   * unmistakable as travel and small enough to leave the frame recognisable.
   * The pointer lean composes on top of it, so a reader with a mouse on the
   * board sees the glide and the parallax together.
   */
  clusterInRadius: 0.45,
  /**
   * One step closer again, on the same centre (ENG-031 W9).
   *
   * The lens panels are where the picture changes meaning rather than place,
   * so the camera may not make a journey of them. But it may not sit still for
   * two whole panels either: the run's promise is that it travels in one
   * direction, and a camera that stops for a third of the page reads as a
   * stall rather than as a hold. Eleven percent is enough to feel like forward
   * travel and small enough that the lens is still the event.
   */
  clusterCloseRadius: 0.4,
} as const;

/**
 * How much harder a PORTRAIT viewport crops (ENG-031 W5, operator: the phone
 * is a demo surface, not a fallback).
 *
 * Fitting a wide board into a tall frame is the wrong instinct: it satisfies
 * the geometry and produces a postage stamp with two thirds of the screen
 * empty, which is exactly the "just a pile of icons" failure at a smaller
 * size. The brief already states the correct rule for conveying scale, and it
 * is the opposite one: density and crop carry scale, and Palantir's board
 * bleeds past all four edges of its frame. So on a phone the board fills the
 * width and runs off the top and bottom, and the marks stay the size a thumb
 * can actually resolve.
 *
 * KEYED ON A NARROW FRAME, NOT ON `height > width` (ENG-031 W6c). The phone's
 * board is a fixed card of `44svh + 2rem`, which at 390x844 is 403px tall: it
 * cleared the portrait test by thirteen pixels, and on a shorter phone, in
 * landscape, or after any change to the card's height it would have failed it
 * and silently served the desktop framing to a 390px frame. The condition the
 * crop is actually about is that the frame is NARROW relative to the board's
 * own spread, so that is what it now tests, with the aspect test kept for a
 * genuinely tall frame at any width.
 */
export const PORTRAIT_CROP = 0.62;

/** A frame this narrow gets the phone's crop whatever its aspect. Matches the
 *  overlay's own `COMPACT_FRAME_PX`, which decides how many Projects a frame
 *  that size can name. */
export const NARROW_FRAME_PX = 560;

/** Mark size multiplier, shared by the unit field and the zoom cap. */
export const MARK_SCALE = 1.7;

export interface HeroBoardFraming {
  center: THREE.Vector3;
  radius: number;
  tightness: number;
  /**
   * How this altitude answers a NARROW frame (ENG-031 W6c).
   *
   * The phone crops rather than fits, but `cluster` is ALREADY the fleet
   * framing cropped, and multiplying the two put the fold's own Project half
   * outside a 390px frame with its name faded out beside it. A board whose
   * circles carry no names is the "pile of rotating icons" verdict returning
   * at a smaller size, so the altitude that exists to be a crop opts out of
   * the second one and says so here rather than in a branch at the call site.
   */
  narrowCrop: number;
}

/**
 * The altitudes the board can hold. Spelled locally rather than imported from
 * the band manifest so the scene never depends on the site.
 *
 * `cluster` is the FLEET framing cropped, on the same centre (ENG-031 W6b). It
 * is not a product altitude and it does not pretend to be one: it exists so
 * the fold can open on a board whose individual marks are legible inside a
 * column that is 58% of the viewport, and it is the widest thing the reader is
 * ever shown.
 *
 * `cluster-in` is that crop one step in (W10), and it exists so the reader's
 * FIRST scroll produces a real camera move. `cluster-close` is one step in
 * again (W9), for the panels whose subject is the MEANING of the marks rather
 * than their place.
 */
export type HeroAltitude =
  | 'fleet'
  | 'cluster'
  | 'cluster-in'
  | 'cluster-close'
  | 'team'
  | 'agent';

/**
 * The default ladder, used only when a caller supplies none: the fold's crop,
 * one real Project, one Agent inside it that needs a human.
 *
 * The PAGE overrides it (ENG-031 W5). The pinned run declares its own ordered
 * altitudes in `manifest.ts`, and the property that matters is invisible
 * unless the camera is derived from that list rather than hardcoded here: two
 * consecutive panels may share an altitude, which makes the camera hold while
 * the board itself makes the argument.
 */
export const HERO_DEFAULT_LADDER: HeroAltitude[] = ['cluster', 'team', 'agent'];

/** Board-model coordinates centred on the origin and laid into world XZ, so
 *  camera-controls' Y-up spherical maths applies without any hand-derived
 *  rotation of our own. */
export function boardCenter(capture: HeroBoardCapture) {
  return {
    x: capture.bounds.x + capture.bounds.width / 2,
    y: capture.bounds.y + capture.bounds.height / 2,
  };
}

export function heroBoardFramings(
  capture: HeroBoardCapture,
  ladder: readonly HeroAltitude[] = HERO_DEFAULT_LADDER,
  /**
   * A phone-width frame. It changes exactly one thing: what the fold's crop is
   * centred on (ENG-031 W6c).
   *
   * On a wide frame `cluster` is the fleet framing cropped on the fleet's own
   * centre, and whichever Projects happen to fall in the column are the ones
   * the fold shows. In a 390px frame that lottery put the ONE Project the fold
   * emphasizes into the top-left corner, half outside the frame, so its name
   * faded out and the phone's first screen was a board with nothing named on
   * it. The fold's crop is now centred on the Project the fold is actually
   * pointing at, which is the same subject `hero-board-subjects.ts` gives the
   * highlight and the copy, and it is also the Project the dive is heading
   * for, so the phone's whole run is one straight line in.
   */
  narrow = false
): HeroBoardFraming[] {
  const center = boardCenter(capture);
  const fleet = new THREE.Vector3(0, 0, 0);
  const fleetRadius =
    Math.hypot(capture.bounds.width, capture.bounds.height) / 2;

  // The Project and the Agent the camera flies to are the SAME two the panels
  // name and the highlight emphasizes, so the copy and the camera cannot
  // disagree. One decision, in `hero-board-subjects.ts`.
  const subjects = heroBoardSubjects(capture);
  const zone = capture.zones[subjects.teamZone]!;
  const team = new THREE.Vector3(zone.x - center.x, 0, zone.y - center.y);

  const agentUnit = capture.units[subjects.agentUnit]!;
  const agent = new THREE.Vector3(
    agentUnit.x - center.x,
    0,
    agentUnit.y - center.y
  );

  const byAltitude: Record<HeroAltitude, HeroBoardFraming> = {
    fleet: {
      center: fleet,
      radius: fleetRadius,
      tightness: FRAMING_TIGHTNESS.fleet,
      narrowCrop: PORTRAIT_CROP,
    },
    cluster: {
      center: narrow ? team : fleet,
      radius: fleetRadius * FRAMING_TIGHTNESS.clusterRadius,
      tightness: FRAMING_TIGHTNESS.fleet,
      narrowCrop: 1,
    },
    'cluster-in': {
      center: narrow ? team : fleet,
      radius: fleetRadius * FRAMING_TIGHTNESS.clusterInRadius,
      tightness: FRAMING_TIGHTNESS.fleet,
      narrowCrop: 1,
    },
    'cluster-close': {
      center: narrow ? team : fleet,
      radius: fleetRadius * FRAMING_TIGHTNESS.clusterCloseRadius,
      tightness: FRAMING_TIGHTNESS.fleet,
      narrowCrop: 1,
    },
    team: {
      center: team,
      radius: zone.radius * 1.5,
      tightness: FRAMING_TIGHTNESS.team,
      narrowCrop: PORTRAIT_CROP,
    },
    agent: {
      center: agent,
      radius: 4.4,
      tightness: FRAMING_TIGHTNESS.agent,
      narrowCrop: PORTRAIT_CROP,
    },
  };

  const resolved = (ladder.length > 1 ? ladder : HERO_DEFAULT_LADDER).map(
    altitude => byAltitude[altitude]
  );
  // Vectors are shared between repeated altitudes on purpose: the rig reads
  // each framing into its own keyframe and never mutates the framing.
  return resolved;
}

/**
 * A framing's fitted camera distance, up to one positive constant.
 *
 * `getDistanceToFitSphere(radius)` is `radius / sin(fov / 2)`, so the constant
 * is the same for every framing at a given viewport and cancels out of any
 * comparison. This is what the monotonicity test asserts on, and it is why
 * that test needs no WebGL context.
 */
export function framingDistanceScale(
  framing: HeroBoardFraming,
  narrow = false
): number {
  return framing.radius * framing.tightness * (narrow ? framing.narrowCrop : 1);
}
