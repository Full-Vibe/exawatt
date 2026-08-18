/**
 * The bridge between the WebGL board and its DOM annotation layer
 * (ENG-031 W2, operator review 2026-08-17).
 *
 * The operator's verdict on the first study was that the board "is just a pile
 * of rotating icons": it renders beautifully and explains nothing. The fix is
 * not more copy on the page, it is naming the things on the board. Decision
 * `0003` already says where names live: WebGL renders the world, and ALL text
 * and ALL interactivity live in a pixel-aligned DOM overlay, so labels stay
 * crisp at any DPR and stay in the accessibility tree. Cloudflare's /network/
 * annotation cards are the reference.
 *
 * This module is the seam. The scene PROJECTS world anchors into CSS pixels
 * once per rendered frame and writes them here; the overlay READS them and
 * mutates `style.transform` on nodes it already owns. Nothing in this path
 * renders React at frame rate (guide rule 14): React state carries semantic
 * identity only — which unit is hovered, which is selected, which units are
 * close enough to deserve a DOM node at all.
 */

/** One projected anchor, in CSS pixels relative to the board frame. */
export interface HeroAnchor {
  x: number;
  y: number;
  /** On-screen radius of the thing being anchored, in CSS pixels. */
  radius: number;
  /** False when behind the camera or outside the padded frame. */
  onScreen: boolean;
}

export interface HeroAnnotationBridge {
  /** Index-aligned with `capture.zones`. */
  zones: HeroAnchor[];
  /** Index-aligned with `capture.units`. */
  units: HeroAnchor[];
  /**
   * Live status ordinal per unit. The scheduler owns it; the card and the
   * per-Project active count read it.
   *
   * SEEDED FROM THE CAPTURE AT CREATION (ENG-031 W9). It used to be born as
   * zeros and filled in by an effect inside the unit field, and zero is
   * `blocked`, so for the frames before that effect ran every Agent on the
   * board read as waiting on a human. Nothing consumed it that early until the
   * "N active" count did, and on the frozen poster path, where no status ever
   * turns, the wrong answer was the only answer: the poster shipped with every
   * Project claiming 100% of its Agents active while grey idle marks sat
   * inside it. A live array whose default is a lie has no safe first frame.
   */
  statuses: Uint8Array;
  /** Damped altitude progress: 0 Fleet, 0.5 Team, 1 Agent. */
  progress: number;
  /**
   * Highlight emphasis, 1 leads and 0 recedes, index-aligned with the capture.
   * Resolved once per highlight by `hero-board-highlight.ts`, then kept
   * truthful by the scene for status-derived highlights. The overlay reads it
   * per frame to dim the labels that are not the subject, so the DOM and the
   * WebGL layers recede together.
   */
  zoneFocus: Float32Array;
  unitFocus: Float32Array;
  /** Frame size in CSS pixels. */
  width: number;
  height: number;
  /** Unit indices that currently own a DOM node. The projector measures an
   *  exact on-screen radius for these and only a centre for the rest. */
  tracked: number[];
  /** Called by the projector at the end of every rendered frame. */
  onProject: (() => void) | null;
  /** Called when the scheduler moves one unit to a new status. */
  onStatusChange: ((index: number) => void) | null;
  /**
   * Where the mouse is over the board, in -1..1 from the frame centre
   * (ENG-031 W9, operator: "allow some minor (constrained) mouse interaction
   * ... just to show that it's a real thing, not like a gif").
   *
   * It travels through the bridge for the same reason every other per-frame
   * value does: a pointer that re-rendered React would render React at pointer
   * frequency, which guide rule 14 forbids by name. `active` is false when the
   * pointer leaves, and the rig damps the offset back to exactly zero, so a
   * board with nobody's hand on it measures the same as it always did.
   *
   * MOUSE ONLY. A touch is how a phone scrolls the page, so a finger never
   * writes here.
   */
  pointer: { x: number; y: number; active: boolean };
}

/**
 * How the bridge travels. It is mutable per-frame state, so it is never passed
 * as a prop object: React's compiler forbids mutating props, and it is right to
 * — a component that writes into its own props has no way to tell React what
 * changed. Owners pass this accessor instead and every reader and writer takes
 * a local reference from it, which is what the mutation actually is.
 */
export type HeroBridgeAccess = () => HeroAnnotationBridge;

export function createHeroAnnotationBridge(
  zoneCount: number,
  unitCount: number,
  /** The capture's own status per unit. See `statuses`: without it the first
   *  frames claim every Agent is blocked. */
  initialStatuses?: ArrayLike<number>
): HeroAnnotationBridge {
  const anchor = (): HeroAnchor => ({
    x: 0,
    y: 0,
    radius: 0,
    onScreen: false,
  });
  return {
    zones: Array.from({ length: zoneCount }, anchor),
    units: Array.from({ length: unitCount }, anchor),
    statuses: (() => {
      const statuses = new Uint8Array(unitCount);
      if (initialStatuses) statuses.set(Array.from(initialStatuses));
      return statuses;
    })(),
    progress: 0,
    zoneFocus: new Float32Array(zoneCount).fill(1),
    unitFocus: new Float32Array(unitCount).fill(1),
    width: 0,
    height: 0,
    tracked: [],
    onProject: null,
    onStatusChange: null,
    pointer: { x: 0, y: 0, active: false },
  };
}

/**
 * Below this altitude progress a mark is population rather than an individual.
 *
 * AMENDED 2026-08-17 (W9, operator: "mouseover effects on the agents just to
 * show that it's a real thing"). It no longer decides whether a mark can be
 * POINTED AT: hit targets now exist at every altitude, so the board answers a
 * mouse wherever the reader is on the page. What is still gated is the CARD,
 * and it is gated on the mark's own projected radius rather than on this
 * number, because "is this mark an individual" is a question about pixels and
 * not about scroll position. This constant survives as the point past which a
 * hovered mark is worth SELECTING, which is a semantic act rather than a
 * glance.
 */
export const AGENT_AFFORDANCE_PROGRESS = 0.3;

/** How many units may own a DOM hit target at once. The cap is what keeps the
 *  overlay's per-frame transform writes bounded regardless of altitude. Raised
 *  from 20 with W9's every-altitude hover: the fold's crop puts far more marks
 *  on screen than the closest framing does, and a hover affordance that only
 *  covered the middle fifth of them would read as broken rather than as
 *  bounded. Still a hard cap, still a bounded write pass. */
export const AGENT_TRACK_LIMIT = 36;

/** Hit targets and their labels are re-chosen at this interval, not per frame.
 *  Positions still follow the camera every frame; only the SET is throttled. */
export const AGENT_TRACK_INTERVAL_MS = 150;

/**
 * The on-screen radius at which a mark stops being population and becomes an
 * individual, in CSS pixels.
 *
 * ONE number decides two things, because they are the same question (W9).
 * Below it, hit targets are invisible until pointed at and a hover gets a
 * target ring plus its Project's name lifted to full strength: that is the
 * honest amount of detail a mark this size can carry, and three dozen visible
 * hairline rings over the fold would be the "pile of icons" verdict returning
 * as chrome. At or above it the rings are the aimable affordance they always
 * were and the card opens with the Agent's name, its Project, its contract and
 * its live status.
 *
 * MEASURED, not guessed. At 1440x900 the run projects marks at radius 12 for
 * the fold and the attention beat, 14 to 15 for the two lens panels, 20 at the
 * delegation framing and 41 at the dive; at 390x844 it is 11, 11, 15 and 18.
 * Seventeen separates "a dot in a fleet" from "a thing you are looking at" on
 * both, with every mark in a given frame on the same side of it, so the board
 * never offers two different affordances in one picture.
 */
export const AGENT_TRACK_MIN_RADIUS_PX = 17;

/**
 * How far the camera may lean towards the pointer (ENG-031 W9).
 *
 * The operator asked for interaction that reads as liveness, not for a control
 * surface: "allow some minor (constrained) mouse interaction - perhaps panning
 * / camera angle / subtle mouseover effects". So it is a LEAN and not a
 * navigation. Three degrees of azimuth and one and a half of polar is enough
 * for the parallax to be unmistakable when the mouse crosses the board and far
 * too small to change what is in frame, to reach the rig's own polar clamps,
 * or to make a screenshot of the hero look different from the hero.
 *
 * It composes ON TOP of whatever framing the scroll has reached. It never
 * touches distance, so it cannot make the run's monotonic zoom reverse, and it
 * never touches progress, so it cannot change which step the reader is on.
 */
export const POINTER_LEAN_AZIMUTH_DEG = 3;
export const POINTER_LEAN_POLAR_DEG = 1.5;
/** Damping rate for the lean, and the floor it settles to EXACTLY. A camera
 *  that chased zero forever would spend the idle budget on nobody's mouse. */
export const POINTER_LEAN_LAMBDA = 5;
export const POINTER_LEAN_SETTLE = 1e-4;
