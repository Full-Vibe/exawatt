import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '@exawatt/core';
import { buildRoadmapLens, type RoadmapLensSessionInput } from './roadmap-lens';
import {
  deriveFleetRoadmapBlocked,
  isProjectStarving,
  pinRoadmapBlockedSince,
  type RoadmapAttentionProject,
  type RoadmapAttentionSession,
} from './roadmap-attention';

const A = '/a';
const B = '/b';

function doc(dir: string, md: string) {
  return parseRoadmap(md, { projectDir: dir, file: 'roadmap.md' });
}

const session = (
  id: string,
  overrides: Partial<RoadmapAttentionSession> = {}
): RoadmapAttentionSession => ({
  sessionId: id,
  tabId: `tab-${id}`,
  title: `session ${id}`,
  cwd: A,
  contextSummary: null,
  initialTask: null,
  declaredItemId: null,
  ...overrides,
});

const project = (
  dir: string,
  md: string | null,
  sessions: RoadmapAttentionSession[]
): RoadmapAttentionProject => ({
  dir,
  read: md === null ? { status: 'absent' } : { status: 'ok', doc: doc(dir, md) },
  sessions,
});

const BLOCKED_NOW = `## Now

### B-1 Stuck first

Status: blocked

### B-2 Fine

Status: now

## Next

### B-3 Stuck later

Status: blocked
`;

const CLEAN = `## Now

### A-1 Fine

Status: now
`;

describe('deriveFleetRoadmapBlocked', () => {
  it('flags sessions on blocked now/next items in EVERY Project (BUG-026)', () => {
    const fleet = deriveFleetRoadmapBlocked([
      project(A, CLEAN, [session('a1', { declaredItemId: 'A-1' })]),
      project(B, BLOCKED_NOW, [
        session('b1', { cwd: B, declaredItemId: 'B-1' }),
        session('b2', { cwd: B, declaredItemId: 'B-2' }),
        session('b3', { cwd: B, declaredItemId: 'B-3' }),
      ]),
    ]);
    expect(fleet.blocked.map(entry => `${entry.sessionId}:${entry.itemId}`)).toEqual(
      ['b1:B-1', 'b3:B-3']
    );
    expect(fleet.blocked[0].projectDir).toBe(B);
    expect(fleet.blocked[0].reason).toBe('B-1 is blocked');
    expect(fleet.pending).toEqual([]);
  });

  it('gives the same answer whichever Project the operator stands in', () => {
    // There is no "active Project" argument to give — which is the fix.
    const projects = [
      project(A, CLEAN, [session('a1', { declaredItemId: 'A-1' })]),
      project(B, BLOCKED_NOW, [session('b1', { cwd: B, declaredItemId: 'B-1' })]),
    ];
    const forward = deriveFleetRoadmapBlocked(projects);
    const reversed = deriveFleetRoadmapBlocked([...projects].reverse());
    expect(forward.blocked.map(entry => entry.sessionId)).toEqual(['b1']);
    expect(reversed.blocked.map(entry => entry.sessionId)).toEqual(['b1']);
  });

  it('links without git: worktree path, title, context and task', () => {
    const fleet = deriveFleetRoadmapBlocked([
      project(B, BLOCKED_NOW, [
        session('w', { cwd: '/work/b-1-fix' }),
        session('t', { cwd: B, title: 'B-3 later work' }),
        session('u', { cwd: B, title: 'unrelated' }),
      ]),
    ]);
    expect(fleet.blocked.map(entry => entry.sessionId).sort()).toEqual(['t', 'w']);
  });

  it('ignores blocked items with nothing attached, and unblocked ones', () => {
    const fleet = deriveFleetRoadmapBlocked([
      project(B, BLOCKED_NOW, [session('b2', { cwd: B, declaredItemId: 'B-2' })]),
    ]);
    expect(fleet.blocked).toEqual([]);
  });

  it('reports a Project whose roadmap has not answered yet as pending', () => {
    const fleet = deriveFleetRoadmapBlocked([
      { dir: B, read: { status: 'pending' }, sessions: [session('b1', { cwd: B })] },
    ]);
    expect(fleet.blocked).toEqual([]);
    expect(fleet.pending).toEqual(['b1']);
  });
});

describe('pinRoadmapBlockedSince', () => {
  const fleetWith = (ids: string[], pending: string[] = []) => ({
    blocked: ids.map(sessionId => ({
      sessionId,
      tabId: null,
      projectDir: B,
      itemId: 'B-1',
      reason: 'B-1 is blocked',
    })),
    pending,
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
