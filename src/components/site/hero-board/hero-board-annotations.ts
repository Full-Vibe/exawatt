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
  /** Live status ordinal per unit. The scheduler owns it; the card reads it. */
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
  unitCount: number
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
    statuses: new Uint8Array(unitCount),
    progress: 0,
    zoneFocus: new Float32Array(zoneCount).fill(1),
    unitFocus: new Float32Array(unitCount).fill(1),
    width: 0,
    height: 0,
    tracked: [],
    onProject: null,
    onStatusChange: null,
  };
}

/**
 * Below this altitude progress the units are population, not individuals: the
 * Fleet read is "these are projects, those are the agents inside them", and a
 * hover target on every one of 173 marks would be noise. Past it the marks are
 * large enough to aim at, so the affordance appears.
 */
export const AGENT_AFFORDANCE_PROGRESS = 0.3;

/** How many units may own a DOM hit target at once. The cap is what keeps the
 *  overlay's per-frame transform writes bounded regardless of altitude. */
export const AGENT_TRACK_LIMIT = 20;

/** Hit targets and their labels are re-chosen at this interval, not per frame.
 *  Positions still follow the camera every frame; only the SET is throttled. */
export const AGENT_TRACK_INTERVAL_MS = 150;

/** A unit needs at least this on-screen radius before it earns a hit target. */
export const AGENT_TRACK_MIN_RADIUS_PX = 7;
