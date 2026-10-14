import { describe, expect, it } from 'vitest';
import {
  frameCoord,
  frameProgress,
  frameReached,
  isAtOrPast,
  REACHED,
  isBeyond,
  isPinned,
  nearestFrame,
  pinnedAt,
  pinnedFor,
  progressAt,
  scrollIntent,
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

  it('answers a scroll into the hold around a frame from its first pixel', () => {
    const frame = frameProgress(2, LAST);
    expect(scrollIntent(frame, 2, LAST)).toBe(0);
    // a few pixels in either direction already register, in proportion
    expect(scrollIntent(frame + 0.01, 2, LAST)).toBeCloseTo(
      0.01 / RAIL_DWELL,
      6
    );
    expect(scrollIntent(frame - 0.01, 2, LAST)).toBeCloseTo(
      -0.01 / RAIL_DWELL,
      6
    );
    // at the edge of the hold it is whole, and stays whole into the move
    expect(scrollIntent(frame + RAIL_DWELL, 2, LAST)).toBe(1);
    expect(scrollIntent(frame + 0.4, 2, LAST)).toBe(1);
    // the first and last frames rest at the ends of the scroll
    expect(scrollIntent(frameProgress(0, LAST), 0, LAST)).toBe(0);
    expect(scrollIntent(frameProgress(LAST, LAST), LAST, LAST)).toBe(0);
  });

  it('never turns round in the middle of a move', () => {
    // a move from scene 1 to 2 leans toward 2 all the way, through the
    // middle of the move where the nearest frame changes
    // (at most a rounding short of arriving, where it is nothing to see)
    let previous = 1;
    for (let p = 1; p <= 2; p += 0.001) {
      const from = frameReached(previous, p, LAST) === 2 ? 2 : 1;
      expect(scrollIntent(p, from, LAST)).toBeGreaterThanOrEqual(
        -REACHED / RAIL_DWELL
      );
      previous = p;
    }
    // and back from 2 it leans toward 1
    expect(scrollIntent(1.6, 2, LAST)).toBe(-1);
  });
});

describe('the frame a scroll set out from', () => {
  it('is the frame it arrived at or came within a few pixels of', () => {
    expect(frameReached(1.5, 2, LAST)).toBe(2);
    expect(frameReached(1.5, 1.998, LAST)).toBe(2);
    expect(frameReached(1.5, 1.99, LAST)).toBe(-1);
  });

  it('is a frame a flick passed between two readings', () => {
    expect(frameReached(1.7, 2.3, LAST)).toBe(2);
    expect(frameReached(2.3, 1.7, LAST)).toBe(2);
    // across two frames, the later one
    expect(frameReached(0.6, 2.2, LAST)).toBe(2);
    expect(frameReached(2.2, 0.6, LAST)).toBe(1);
  });

  it('includes the ends of the story, where the frames rest a dwell in', () => {
    expect(frameReached(0.5, frameProgress(0, LAST), LAST)).toBe(0);
    expect(frameReached(3.5, frameProgress(LAST, LAST), LAST)).toBe(LAST);
  });
});

describe('the scroll in scenes', () => {
  it('is a whole scene at each frame and linear between them', () => {
    for (let i = 0; i <= LAST; i += 1)
      expect(frameCoord(frameProgress(i, LAST), LAST)).toBeCloseTo(i, 9);
    expect(frameCoord(1.5, LAST)).toBeCloseTo(1.5, 9);
    // the first gap is shorter in progress (the first frame rests a dwell
    // in), and still reads from 0 to 1
    const mid = (frameProgress(0, LAST) + frameProgress(1, LAST)) / 2;
    expect(frameCoord(mid, LAST)).toBeCloseTo(0.5, 9);
  });

  it('only ever moves the way the scroll moves', () => {
    let previous = -1;
    for (let p = 0; p <= LAST; p += 0.005) {
      const coord = frameCoord(p, LAST);
      expect(coord).toBeGreaterThanOrEqual(previous);
      previous = coord;
    }
  });
});
