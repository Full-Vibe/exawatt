import { describe, expect, it } from 'vitest';
import {
  activePanel,
  boardProgressAt,
  panelAnchors,
  panelPresence,
  pinnedTravelScreens,
} from './pinned-scroll';
import { pinnedBoardBands } from './manifest';

/**
 * The pinned sequence's geometry (ENG-031 W4).
 *
 * Every rule here is a constraint the brief states, asserted on the pure
 * function rather than trusted to a component: the board lands exactly on each
 * panel's altitude, the mapping is monotonic so nothing snaps backwards, and it
 * is symmetric so scrolling up reads the same as scrolling down.
 */
describe('pinned scroll geometry', () => {
  const screens = [1.4, 1.2, 1.2];

  it('pins for the sequence minus the pinned element itself', () => {
    expect(pinnedTravelScreens(screens)).toBeCloseTo(2.8, 6);
    expect(pinnedTravelScreens(screens, 0.95)).toBeCloseTo(2.85, 6);
    // Never zero, so nothing downstream divides by it.
    expect(pinnedTravelScreens([1], 1)).toBeGreaterThan(0);
  });

  it('lands the board exactly on each panel altitude', () => {
    const anchors = panelAnchors(screens);
    expect(anchors).toHaveLength(3);
    expect(boardProgressAt(anchors[0]!, anchors)).toBeCloseTo(0, 6);
    expect(boardProgressAt(anchors[1]!, anchors)).toBeCloseTo(0.5, 6);
    expect(boardProgressAt(anchors[2]!, anchors)).toBeCloseTo(1, 6);
  });

  it('holds the ends rather than overshooting them', () => {
    const anchors = panelAnchors(screens);
    expect(boardProgressAt(0, anchors)).toBe(0);
    expect(boardProgressAt(1, anchors)).toBe(1);
    expect(boardProgressAt(-5, anchors)).toBe(0);
    expect(boardProgressAt(9, anchors)).toBe(1);
  });

  it('never moves the board backwards as the page moves forwards', () => {
    const anchors = panelAnchors(screens);
    let previous = -1;
    for (let step = 0; step <= 200; step += 1) {
      const value = boardProgressAt(step / 200, anchors);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBe(1);
  });

  it('reads identically going up, because position is the only input', () => {
    const anchors = panelAnchors(screens);
    const down: number[] = [];
    for (let step = 0; step <= 100; step += 1) {
      down.push(boardProgressAt(step / 100, anchors));
    }
    const up: number[] = [];
    for (let step = 100; step >= 0; step -= 1) {
      up.unshift(boardProgressAt(step / 100, anchors));
    }
    expect(up).toEqual(down);
  });

  it('gives each panel full presence at its own anchor and none at its edges', () => {
    const anchors = panelAnchors(screens);
    screens.forEach((_, index) => {
      expect(
        panelPresence(anchors[index]!, screens, anchors, index),
        `panel ${index}`
      ).toBeCloseTo(1, 6);
    });
    // A panel two screens away has left.
    expect(panelPresence(anchors[2]!, screens, anchors, 0)).toBe(0);
    expect(panelPresence(anchors[0]!, screens, anchors, 2)).toBe(0);
  });

  it('hands the board to the nearest panel, in both directions', () => {
    const anchors = panelAnchors(screens);
    expect(activePanel(0, anchors)).toBe(0);
    expect(activePanel(anchors[1]!, anchors)).toBe(1);
    expect(activePanel(1, anchors)).toBe(2);
    expect(activePanel(-1, anchors)).toBe(0);
  });

  it('is insensitive to how tall the panels are, only to their order', () => {
    // A 1.4-screen panel holds its altitude longer without dragging the
    // keyframe off centre, which is the whole reason the two are decoupled.
    const even = panelAnchors([1.2, 1.2, 1.2]);
    const uneven = panelAnchors([1.4, 1.2, 1.2]);
    expect(boardProgressAt(even[1]!, even)).toBeCloseTo(0.5, 6);
    expect(boardProgressAt(uneven[1]!, uneven)).toBeCloseTo(0.5, 6);
  });

  it('runs the real manifest sequence from fleet to agent', () => {
    const bands = pinnedBoardBands();
    const anchors = panelAnchors(bands.map(band => band.screens));
    expect(bands.map(band => band.altitudeAnchor)).toEqual([
      'fleet',
      'team',
      'agent',
    ]);
    expect(boardProgressAt(anchors[0]!, anchors)).toBeCloseTo(0, 6);
    expect(boardProgressAt(anchors[anchors.length - 1]!, anchors)).toBeCloseTo(
      1,
      6
    );
  });
});
