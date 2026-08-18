import { describe, expect, it } from 'vitest';
import { BOARD_TRANSITION_MS } from './operations-board-transition';
import { EMERGENCE_ARRIVAL_FROM, createEmergenceTracker } from './operations-board-emergence';

describe('piece emergence', () => {
  it('treats the initial set as settled, so mount never animates', () => {
    const tracker = createEmergenceTracker(['a', 'b']);
    expect(tracker.scaleOf('a', 0)).toBe(1);
    expect(tracker.active(0)).toBe(false);
  });

  it('scales a new piece in from a fraction over the transition duration', () => {
    const tracker = createEmergenceTracker(['a']);
    tracker.reconcile(['a', 'b'], 1000);
    expect(tracker.scaleOf('b', 1000)).toBeCloseTo(EMERGENCE_ARRIVAL_FROM, 6);
    expect(tracker.scaleOf('b', 1000 + BOARD_TRANSITION_MS / 2)).toBeGreaterThan(EMERGENCE_ARRIVAL_FROM);
    expect(tracker.scaleOf('b', 1000 + BOARD_TRANSITION_MS / 2)).toBeLessThan(1);
    expect(tracker.scaleOf('b', 1000 + BOARD_TRANSITION_MS)).toBe(1);
    expect(tracker.scaleOf('a', 1000)).toBe(1);
  });

  it('keeps a departing piece renderable while it scales out', () => {
    const tracker = createEmergenceTracker(['a', 'b']);
    tracker.reconcile(['a'], 1000);
    expect(tracker.retiring(1000)).toEqual(['b']);
    expect(tracker.scaleOf('b', 1000)).toBe(1);
    expect(tracker.scaleOf('b', 1000 + BOARD_TRANSITION_MS / 2)).toBeLessThan(1);
    expect(tracker.scaleOf('b', 1000 + BOARD_TRANSITION_MS)).toBe(0);
    expect(tracker.retiring(1000 + BOARD_TRANSITION_MS)).toEqual([]);
    tracker.prune(1000 + BOARD_TRANSITION_MS);
    expect(tracker.active(1000 + BOARD_TRANSITION_MS)).toBe(false);
  });

  it('turns a piece around without a jump when it comes back mid-departure', () => {
    // Press 2 then 1 quickly: a zone's pieces start leaving and are asked back.
    const tracker = createEmergenceTracker(['a']);
    tracker.reconcile([], 1000);
    const midway = 1000 + BOARD_TRANSITION_MS * 0.4;
    const before = tracker.scaleOf('a', midway);
    tracker.reconcile(['a'], midway);
    const after = tracker.scaleOf('a', midway);
    expect(after).toBeCloseTo(before, 3);
    expect(tracker.scaleOf('a', midway + BOARD_TRANSITION_MS)).toBe(1);
  });

  it('turns a piece around without a jump when it leaves mid-arrival', () => {
    const tracker = createEmergenceTracker([]);
    tracker.reconcile(['a'], 1000);
    const midway = 1000 + BOARD_TRANSITION_MS * 0.3;
    const before = tracker.scaleOf('a', midway);
    tracker.reconcile([], midway);
    expect(tracker.scaleOf('a', midway)).toBeCloseTo(before, 3);
    expect(tracker.retiring(midway)).toEqual(['a']);
  });

  it('snaps when given no duration, for reduced motion', () => {
    const tracker = createEmergenceTracker(['a'], 0);
    tracker.reconcile(['a', 'b'], 1000);
    expect(tracker.scaleOf('b', 1000)).toBe(1);
    tracker.reconcile(['b'], 1000);
    expect(tracker.retiring(1000)).toEqual([]);
    expect(tracker.active(1000)).toBe(false);
  });
});
