import { describe, expect, it } from 'vitest';
import { HERO_BOARD_CAPTURE } from './capture';
import {
  DELEGATION_ORBIT_GAIN,
  framingDistanceScale,
  heroBoardFramings,
  heroDelegationClearance,
  heroDelegationParents,
  heroDelegationPosition,
  HERO_DEFAULT_LADDER,
  type HeroAltitude,
} from './hero-board-framings';
import { BAND_ALTITUDE_DEPTH, pinnedAltitudeLadder } from '../bands/manifest';
import { bandById, heroCameraAnchors } from '../bands/manifest';

/**
 * THE CAMERA ONLY EVER CLOSES IN (ENG-031 W9).
 *
 * The operator's note on the assembled run: "I think the zoom is a little
 * bouncy, I like it when it goes only one direction smoothly across multiple
 * steps." `manifest.test.ts` asserts the DECLARED depth never decreases; this
 * file asserts the geometry agrees, so the manifest's claim cannot be true in
 * name while the framings do something else.
 *
 * It needs no WebGL context, and that is a property rather than a shortcut:
 * camera-controls fits a sphere at `radius / sin(fov / 2)`, which is strictly
 * proportional to the radius at a fixed viewport, so `framingDistanceScale()`
 * orders the framings exactly as the fitted distances do.
 */
describe('hero board framings', () => {
  const capture = HERO_BOARD_CAPTURE;
  /** The real ladder the page drives, fold included. */
  const ladder = heroCameraAnchors().map(
    anchor => anchor.altitude as HeroAltitude
  );

  it('resolves a framing for every altitude a band can declare', () => {
    const altitudes = Object.keys(BAND_ALTITUDE_DEPTH) as HeroAltitude[];
    const framings = heroBoardFramings(capture, altitudes);
    expect(framings).toHaveLength(altitudes.length);
    for (const framing of framings) {
      expect(framing.radius).toBeGreaterThan(0);
      expect(framing.tightness).toBeGreaterThan(0);
      expect(Number.isFinite(framing.center.x)).toBe(true);
    }
  });

  it('never moves the camera further out, on a wide frame or a phone', () => {
    for (const narrow of [false, true]) {
      const framings = heroBoardFramings(capture, ladder, narrow);
      const distances = framings.map(framing =>
        framingDistanceScale(framing, narrow)
      );
      for (let index = 1; index < distances.length; index += 1) {
        // LOG SPACE, because distance is a ratio and not a length (guide rule
        // 4c): the run spans more than an order of magnitude, and the rig
        // interpolates the logarithm of it.
        expect(
          Math.log(distances[index]!),
          `${ladder[index]} after ${ladder[index - 1]} (narrow=${narrow})`
        ).toBeLessThanOrEqual(Math.log(distances[index - 1]!) + 1e-9);
      }
      // And the run TRAVELS. A ladder that held one framing throughout would
      // satisfy the assertion above and say nothing.
      expect(distances.at(-1)!).toBeLessThan(distances[0]! / 2);
    }
  });

  it('agrees with the depth the manifest declares, rung for rung', () => {
    // Two orderings of the same fact live in two files on purpose: the
    // manifest's is what a band author reads, the geometry's is what the
    // camera does. This is the assertion that stops them drifting.
    const framings = heroBoardFramings(capture, ladder);
    for (let index = 1; index < ladder.length; index += 1) {
      const deeper =
        BAND_ALTITUDE_DEPTH[ladder[index]!] >
        BAND_ALTITUDE_DEPTH[ladder[index - 1]!];
      const closer =
        framingDistanceScale(framings[index]!) <
        framingDistanceScale(framings[index - 1]!);
      expect(closer, `${ladder[index - 1]} to ${ladder[index]}`).toBe(deeper);
    }
  });

  it('opens on the fold crop and ends on one agent', () => {
    expect(ladder[0]).toBe('cluster');
    expect(ladder.at(-1)).toBe('agent');
    expect(bandById(heroCameraAnchors()[0]!.id).headingRole).toBe('headline');
    // The pinned panels themselves start one rung IN from the fold's frame.
    expect(pinnedAltitudeLadder()[0]).toBe('cluster-in');
  });

  it('glides on the first scroll, by enough to see and little enough to keep the fold', () => {
    // THE MAGNITUDE THE OPERATOR ASKED FOR (ENG-031 W10: "I do want some sort
    // of camera change / zoom / animation on the first scroll section - right
    // now the scene is static").
    //
    // Two failure modes, one window. Too small and the first scroll reads as
    // the screenshot the note is about; too large and the fold's own crop,
    // which is tuned so three or four Project clusters fill a 58% column and a
    // single mark is still an individual, is gone by the second panel. Eight
    // to fifteen percent is the band, and the ladder sits at ten.
    for (const narrow of [false, true]) {
      const framings = heroBoardFramings(capture, ladder, narrow);
      const step =
        framingDistanceScale(framings[1]!, narrow) /
        framingDistanceScale(framings[0]!, narrow);
      expect(step, `narrow=${narrow}`).toBeLessThanOrEqual(0.92);
      expect(step, `narrow=${narrow}`).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('holds the fold crop on a phone, and crops the rest harder', () => {
    const framings = heroBoardFramings(capture, ladder, true);
    const byAltitude = new Map(
      ladder.map((altitude, index) => [altitude, framings[index]!])
    );
    // `cluster` is ALREADY a crop, so it opts out of the portrait crop rather
    // than being cropped twice and putting its own subject outside the frame.
    expect(byAltitude.get('cluster')!.narrowCrop).toBe(1);
    expect(byAltitude.get('cluster-in')!.narrowCrop).toBe(1);
    expect(byAltitude.get('cluster-close')!.narrowCrop).toBe(1);
    expect(byAltitude.get('agent')!.narrowCrop).toBeLessThan(1);
    // And a phone centres the opening crop on the Project the dive is heading
    // for, so its whole run is one straight line in.
    const wide = heroBoardFramings(capture, ['cluster', 'team'], false);
    const narrow = heroBoardFramings(capture, ['cluster', 'team'], true);
    expect(narrow[0]!.center.equals(narrow[1]!.center)).toBe(true);
    expect(wide[0]!.center.equals(wide[1]!.center)).toBe(false);
  });

  /**
   * THE CONSTELLATION IS LEGIBLE, AND THAT IS ARITHMETIC (ENG-031 W13).
   *
   * The operator on the delegation panel: children rendered as "a tight
   * scribble of overlapping white dots on top of their parents, with no
   * readable lineage". Three margins decide whether a rosette reads, and each
   * one is a number rather than a look, so each one is asserted here.
   */
  it('draws every delegated child clear of its parent, its siblings and the fleet', () => {
    const clearance = heroDelegationClearance(capture);
    // A spoke with no visible run carries nothing, which is the board model's
    // own reason for having an orbit at all.
    expect(clearance.parent).toBeGreaterThan(0.25);
    // Two children of one parent must not merge into one blob.
    expect(clearance.sibling).toBeGreaterThan(0.15);
    // And a constellation must stay inside its own slot rather than reaching
    // into the Agent next door.
    expect(clearance.neighbour).toBeGreaterThan(0.1);
  });

  it('keeps the drawn rosette on the model’s own slot angles', () => {
    // The gain moves each child STRAIGHT out along the slot the board model
    // chose. It may not rotate one, because the rosette order is the product's
    // and a marketing board that reordered it would be drawing a delegation
    // the product does not draw (ENG-023 D3c).
    expect(DELEGATION_ORBIT_GAIN).toBeGreaterThan(1);
    expect(heroDelegationParents(capture).size).toBeGreaterThan(0);
    capture.delegations.forEach((child, index) => {
      const parent = capture.units[child.parent]!;
      const drawn = heroDelegationPosition(capture, index);
      const packed = Math.atan2(child.y - parent.y, child.x - parent.x);
      const shown = Math.atan2(drawn.y - parent.y, drawn.x - parent.x);
      expect(shown).toBeCloseTo(packed, 9);
      expect(
        Math.hypot(drawn.x - parent.x, drawn.y - parent.y)
      ).toBeCloseTo(
        Math.hypot(child.x - parent.x, child.y - parent.y) *
          DELEGATION_ORBIT_GAIN,
        9
      );
    });
  });

  it('falls back to its own default ladder rather than to one keyframe', () => {
    // A single-entry ladder cannot be interpolated, so the rig would have no
    // journey at all. The default is the shape of the real one: crop, project,
    // agent, and it closes in the whole way.
    const framings = heroBoardFramings(capture, ['agent']);
    expect(framings).toHaveLength(HERO_DEFAULT_LADDER.length);
    const distances = framings.map(framing => framingDistanceScale(framing));
    for (let index = 1; index < distances.length; index += 1) {
      expect(distances[index]!).toBeLessThan(distances[index - 1]!);
    }
  });
});
