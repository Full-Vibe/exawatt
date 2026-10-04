import { describe, it, expect } from 'vitest';
import {
  parseRoadmap,
  deriveFleetRoadmapBlocked as coreJoin,
} from '@exawatt/core';
import { buildRoadmapLens, type RoadmapLensSessionInput } from './roadmap-lens';
import {
  deriveFleetRoadmapBlocked,
  isProjectStarving,
  pinRoadmapBlockedSince,
} from './roadmap-attention';

const A = '/a';
const B = '/b';

function doc(dir: string, md: string) {
  return parseRoadmap(md, { projectDir: dir, file: 'roadmap.md' });
}

it('reexports the source-neutral join rather than owning a second algorithm', () => {
  expect(deriveFleetRoadmapBlocked).toBe(coreJoin);
});

describe('pinRoadmapBlockedSince', () => {
  it('holds a pin while that Project cannot be read', () => {
    const previous = new Map([['sb', 5]]);
    const pinned = pinRoadmapBlockedSince(
      previous,
      { blocked: [], pending: [], unread: ['sb'] },
      99
    );
    expect(pinned.get('sb')).toBe(5);
  });

  const fleetWith = (ids: string[], pending: string[] = []) => ({
    blocked: ids.map(sessionId => ({
      sessionId,
      tabId: null,
      projectDir: B,
      itemId: 'B-1',
      reason: 'B-1 is blocked',
    })),
    pending,
    unread: [],
  });

  it('survives a Project round trip instead of re-stamping (BUG-026)', () => {
    // Standing in B: the block is first seen at 1000.
    let pins = pinRoadmapBlockedSince(new Map(), fleetWith(['b1']), 1000);
    expect(pins.get('b1')).toBe(1000);
    // Stand in A for a while. The fleet producer still sees B.
    pins = pinRoadmapBlockedSince(pins, fleetWith(['b1']), 5000);
    // Come back. `since` is when the block started, not when we looked.
    pins = pinRoadmapBlockedSince(pins, fleetWith(['b1']), 9000);
    expect(pins.get('b1')).toBe(1000);
  });

  it('drops the pin when the block clears', () => {
    const pins = pinRoadmapBlockedSince(
      new Map([['b1', 1000]]),
      fleetWith([]),
      9000
    );
    expect(pins.has('b1')).toBe(false);
  });

  it('holds a pin while that Project is still being read', () => {
    const pins = pinRoadmapBlockedSince(
      new Map([['b1', 1000]]),
      fleetWith([], ['b1']),
      9000
    );
    // Unknown is not "clear": a pending read must not restart the clock.
    expect(pins.get('b1')).toBe(1000);
  });
});

describe('isProjectStarving', () => {
  const empty = buildRoadmapLens({
    read: {
      status: 'ok',
      doc: doc(
        A,
        `## Shipped

### A-1 Done

Status: shipped
`
      ),
      mtimeMs: 1,
    },
    sessions: [] as RoadmapLensSessionInput[],
  });
  it('true only when the queue is empty AND agents run', () => {
    expect(isProjectStarving(empty, 2)).toBe(true);
    expect(isProjectStarving(empty, 0)).toBe(false);
  });
});
