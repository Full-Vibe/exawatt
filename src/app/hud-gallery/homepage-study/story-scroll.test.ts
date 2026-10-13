import { describe, expect, it } from 'vitest';
import {
  frameProgress,
  isAtOrPast,
  isBeyond,
  isPinned,
  nearestFrame,
  pinnedAt,
  pinnedFor,
  progressAt,
  storyTravel,
} from './story-scroll';
import { RAIL_DWELL, STAGES } from './stages';

const LAST = STAGES.length - 1;

describe('the story scroll', () => {
  const travel = storyTravel(STAGES.length * 800, 800);

  it('travels the section less one stage', () => {
    expect(travel).toBe((STAGES.length - 1) * 800);
    expect(storyTravel(100, 800)).toBe(1);
  });

  it('starts and ends the story a dwell inside the first and last stage', () => {
    expect(progressAt(0, travel, LAST)).toBeCloseTo(RAIL_DWELL, 9);
    expect(progressAt(travel, travel, LAST)).toBeCloseTo(LAST - RAIL_DWELL, 9);
  });

  it('round-trips progress and pinned distance', () => {
    for (let p = RAIL_DWELL; p <= LAST - RAIL_DWELL; p += 0.173) {
      const pinned = pinnedFor(p, travel, LAST);
      expect(progressAt(pinned, travel, LAST)).toBeCloseTo(p, 6);
    }
  });

  it('rests the first and last frames at the ends of the scroll', () => {
    expect(pinnedFor(frameProgress(0, LAST), travel, LAST)).toBe(0);
    expect(pinnedFor(frameProgress(LAST, LAST), travel, LAST)).toBe(travel);
    expect(frameProgress(2, LAST)).toBe(2);
  });

  it('names the nearest frame, and never one that is not there', () => {
    expect(nearestFrame(RAIL_DWELL, LAST)).toBe(0);
    expect(nearestFrame(LAST - RAIL_DWELL, LAST)).toBe(LAST);
    expect(nearestFrame(2.4, LAST)).toBe(2);
    expect(nearestFrame(2.6, LAST)).toBe(3);
    expect(nearestFrame(-5, LAST)).toBe(0);
    expect(nearestFrame(99, LAST)).toBe(LAST);
  });

  it('pins from the header and unpins at the end of the travel', () => {
    expect(pinnedAt(48, travel)).toBe(0);
    expect(pinnedAt(-100, travel)).toBe(148);
    expect(pinnedAt(-1e6, travel)).toBe(travel);
    expect(pinnedAt(500, travel)).toBe(0);
    expect(isPinned(48, travel)).toBe(true);
    expect(isPinned(48 - travel, travel)).toBe(true);
    expect(isPinned(48 - travel - 50, travel)).toBe(false);
    expect(isPinned(300, travel)).toBe(false);
  });

  it('controls the story and the page below it, not the page above it', () => {
    expect(isAtOrPast(48)).toBe(true);
    expect(isAtOrPast(48 - travel)).toBe(true);
    expect(isAtOrPast(48 - travel - 400)).toBe(true);
    expect(isAtOrPast(300)).toBe(false);
  });

  it('knows when the page is below the story', () => {
    expect(isBeyond(48, travel)).toBe(false);
    expect(isBeyond(48 - travel, travel)).toBe(false);
    expect(isBeyond(48 - travel - 2, travel)).toBe(true);
    expect(isBeyond(48 - travel - 400, travel)).toBe(true);
  });
});
