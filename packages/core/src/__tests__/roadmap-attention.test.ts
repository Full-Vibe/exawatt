import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '../roadmap/parse';
import {
  deriveFleetRoadmapBlocked,
  type RoadmapAttentionProject,
  type RoadmapAttentionSession,
} from '../roadmap/attention';

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
  read:
    md === null ? { status: 'absent' } : { status: 'ok', doc: doc(dir, md) },
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
    expect(
      fleet.blocked.map(entry => `${entry.sessionId}:${entry.itemId}`)
    ).toEqual(['b1:B-1', 'b3:B-3']);
    expect(fleet.blocked[0].projectDir).toBe(B);
    expect(fleet.blocked[0].reason).toBe('B-1 is blocked');
    expect(fleet.pending).toEqual([]);
  });

  it('gives the same answer whichever Project the operator stands in', () => {
    // There is no "active Project" argument to give — which is the fix.
    const projects = [
      project(A, CLEAN, [session('a1', { declaredItemId: 'A-1' })]),
      project(B, BLOCKED_NOW, [
        session('b1', { cwd: B, declaredItemId: 'B-1' }),
      ]),
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
    expect(fleet.blocked.map(entry => entry.sessionId).sort()).toEqual([
      't',
      'w',
    ]);
  });

  it('ignores blocked items with nothing attached, and unblocked ones', () => {
    const fleet = deriveFleetRoadmapBlocked([
      project(B, BLOCKED_NOW, [
        session('b2', { cwd: B, declaredItemId: 'B-2' }),
      ]),
    ]);
    expect(fleet.blocked).toEqual([]);
  });

  // BUG-162: a read that did not answer is not a Project with no roadmap.
  // Its Sessions are neither blocked nor cleared; they are unread, and the
  // producer must say so instead of letting the merge read them as quiet.
  it('reports a Project whose roadmap could not be read as unread, never clear', () => {
    const fleet = deriveFleetRoadmapBlocked([
      {
        dir: B,
        read: { status: 'failed', error: 'roadmap.md exceeds the limit' },
        sessions: [session('sb', { cwd: B, declaredItemId: 'B-1' })],
      },
      project(A, null, [session('sa')]),
    ]);
    expect(fleet.blocked).toEqual([]);
    expect(fleet.unread).toEqual(['sb']);
    expect(fleet.pending).toEqual([]);
  });

  it('reports a Project whose roadmap has not answered yet as pending', () => {
    const fleet = deriveFleetRoadmapBlocked([
      {
        dir: B,
        read: { status: 'pending' },
        sessions: [session('b1', { cwd: B })],
      },
    ]);
    expect(fleet.blocked).toEqual([]);
    expect(fleet.pending).toEqual(['b1']);
  });
});
