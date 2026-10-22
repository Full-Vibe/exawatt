import { describe, expect, it } from 'vitest';
import { HERO_BOARD_CAPTURE } from './capture';
import {
  DELEGATION_OVERFLOW_SCALE,
  DELEGATION_ORBIT_GAIN,
  framingDistanceScale,
  heroBoardFramings,
  heroDelegationClearance,
  heroDelegationParents,
  heroDelegationPosition,
  heroDelegationRenderGeometry,
  HERO_DEFAULT_LADDER,
  MARK_GLYPH_RADIUS,
  MARK_SCALE,
  type HeroAltitude,
} from './hero-board-framings';

/**
 * Every altitude the board can hold, widest first. The camera only ever
 * closes in along this order (ENG-031 W9), and the geometry has to agree.
 *
 * It needs no WebGL context, and that is a property rather than a shortcut:
 * camera-controls fits a sphere at `radius / sin(fov / 2)`, which is strictly
 * proportional to the radius at a fixed viewport, so `framingDistanceScale()`
 * orders the framings exactly as the fitted distances do.
 */
const BY_DEPTH: HeroAltitude[] = [
  'fleet',
  'cluster',
  'cluster-in',
  'cluster-close',
  'team',
  'agent',
];

describe('hero board framings', () => {
  const capture = HERO_BOARD_CAPTURE;

  it('resolves a framing for every altitude', () => {
    const framings = heroBoardFramings(capture, BY_DEPTH);
    expect(framings).toHaveLength(BY_DEPTH.length);
    for (const framing of framings) {
      expect(framing.radius).toBeGreaterThan(0);
      expect(framing.tightness).toBeGreaterThan(0);
      expect(Number.isFinite(framing.center.x)).toBe(true);
    }
  });

  it('moves the camera closer at every deeper altitude, on a wide frame or a phone', () => {
    for (const narrow of [false, true]) {
      const framings = heroBoardFramings(capture, BY_DEPTH, narrow);
      const distances = framings.map(framing =>
        framingDistanceScale(framing, narrow)
      );
      for (let index = 1; index < distances.length; index += 1) {
        // LOG SPACE, because distance is a ratio and not a length (guide rule
        // 4c): the run spans more than an order of magnitude, and the rig
        // interpolates the logarithm of it.
        expect(
          Math.log(distances[index]!),
          `${BY_DEPTH[index]} after ${BY_DEPTH[index - 1]} (narrow=${narrow})`
        ).toBeLessThan(Math.log(distances[index - 1]!));
      }
    }
  });

  it('crops the close altitudes on a phone, and never crops a crop twice', () => {
    const framings = heroBoardFramings(capture, BY_DEPTH, true);
    const byAltitude = new Map(
      BY_DEPTH.map((altitude, index) => [altitude, framings[index]!])
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
      expect(Math.hypot(drawn.x - parent.x, drawn.y - parent.y)).toBeCloseTo(
        Math.hypot(child.x - parent.x, child.y - parent.y) *
          DELEGATION_ORBIT_GAIN,
        9
      );
    });
  });

  it('connects every lineage tether to its parent through the rotated shader quad', () => {
    capture.delegations.forEach((child, index) => {
      const owner = capture.units[child.parent]!;
      const render = heroDelegationRenderGeometry(capture, index);
      const run = Math.hypot(owner.x - render.slot.x, owner.y - render.slot.y);
      const towardParent = {
        x: (owner.x - render.slot.x) / run,
        y: (owner.y - render.slot.y) / run,
      };
      const overflowScale = child.overflow > 0 ? DELEGATION_OVERFLOW_SCALE : 1;
      const childRadius =
        MARK_GLYPH_RADIUS * child.size * MARK_SCALE * overflowScale;
      const parentRadius = MARK_GLYPH_RADIUS * owner.size * MARK_SCALE;

      // The plane is rotated -90 degrees onto XZ, so UV +Y reconstructs as
      // board -Y. This is the sign the live bug lost: both marks were placed
      // correctly while every tether pointed to the mirror of its parent.
      const fromUv = ({ x, y }: { x: number; y: number }) => ({
        x: render.slot.x + x * render.quadWorldSize,
        y: render.slot.y - y * render.quadWorldSize,
      });
      const childEnd = fromUv(render.childEdgeUv);
      const parentEnd = fromUv(render.parentEdgeUv);

      expect(childEnd.x).toBeCloseTo(
        render.slot.x + towardParent.x * childRadius,
        9
      );
      expect(childEnd.y).toBeCloseTo(
        render.slot.y + towardParent.y * childRadius,
        9
      );
      expect(parentEnd.x).toBeCloseTo(
        owner.x - towardParent.x * parentRadius,
        9
      );
      expect(parentEnd.y).toBeCloseTo(
        owner.y - towardParent.y * parentRadius,
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
