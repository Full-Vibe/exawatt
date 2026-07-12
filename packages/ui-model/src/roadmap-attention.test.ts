import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '@exawatt/core';
import type { SessionLink } from '@exawatt/core';
import { buildRoadmapLens, type RoadmapLensSessionInput } from './roadmap-lens';
import {
  deriveRoadmapBlockedSessions,
  isProjectStarving,
  orderedRoadmapJumpTargets,
} from './roadmap-attention';

const DIR = '/p';

function lens(md: string, sessions: RoadmapLensSessionInput[] = [], links: SessionLink[] = []) {
  const doc = parseRoadmap(md, { projectDir: DIR, file: 'roadmap.md' });
  return buildRoadmapLens({ read: { status: 'ok', doc, mtimeMs: 1 }, sessions, links });
}

const session = (n: number): RoadmapLensSessionInput => ({
  sessionId: `s${n}`,
  tabId: `t${n}`,
  title: `session ${n}`,
  harness: 'claude',
  needsAttention: false,
});

const link = (n: number, itemId: string): SessionLink => ({
  sessionId: `s${n}`,
  tabId: `t${n}`,
  projectDir: DIR,
  itemId,
  method: 'declared',
  confidence: 'high',
  evidence: [{ kind: 'declared', excerpt: 'declared at launch' }],
  evaluatedAt: 0,
});

describe('deriveRoadmapBlockedSessions', () => {
  it('flags sessions attached to blocked now/next items, in queue order', () => {
    const view = lens(
      `## Now

### A-1 Stuck first

Status: blocked

### A-2 Fine

Status: now

## Next

### A-3 Stuck later

Status: blocked
`,
      [session(1), session(2), session(3)],
      [link(1, 'A-1'), link(2, 'A-2'), link(3, 'A-3')]
    );
    const blocked = deriveRoadmapBlockedSessions(view);
    expect(blocked.map(b => `${b.sessionId}:${b.itemId}`)).toEqual([
      's1:A-1',
      's3:A-3',
    ]);
    expect(blocked[0].reason).toBe('A-1 is blocked');
  });

  it('ignores blocked items with nothing attached', () => {
    const view = lens(`## Now

### A-1 Stuck alone

Status: blocked
`);
    expect(deriveRoadmapBlockedSessions(view)).toEqual([]);
  });
});

describe('isProjectStarving', () => {
  const empty = lens(`## Shipped

### A-1 Done

Status: shipped
`);
  it('true only when the queue is empty AND agents run', () => {
    expect(isProjectStarving(empty, 2)).toBe(true);
    expect(isProjectStarving(empty, 0)).toBe(false);
  });
});

describe('orderedRoadmapJumpTargets', () => {
  it('orders oldest-blocked first and excludes the active session', () => {
    const map = {
      's1': { since: 300 },
      's2': { since: 100 },
      's3': { since: 200 },
    };
    expect(orderedRoadmapJumpTargets(map, null)).toEqual(['s2', 's3', 's1']);
    expect(orderedRoadmapJumpTargets(map, 's2')).toEqual(['s3', 's1']);
  });
  it('is empty when the only blocked session is already active', () => {
    expect(orderedRoadmapJumpTargets({ 's1': { since: 1 } }, 's1')).toEqual([]);
  });
});
