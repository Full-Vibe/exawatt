import { describe, expect, it } from 'vitest';
import { parseRoadmap, type SessionLink } from '@exawatt/core';
import {
  buildRoadmapLens,
  type RoadmapLensSessionInput,
} from './roadmap-lens';

const SAMPLE = `## Now

### ENG-016 Daily-driver adoption

Status: active-build — in flight.

Milestones:

- [x] D0 Baseline gates
- [ ] D7 Product-grade updates
- W0.5 Spatial cockpit (rescoped 2026-07 — replaced by exposé)

### ENG-017 Project roadmap lens

## Next

### ENG-018 Durable sessions

Status: blocked — waiting on ENG-016.

## Later

### ENG-004 Spatial board

## Shipped

### ENG-001 Consolidation
`;

const doc = parseRoadmap(SAMPLE, { projectDir: '/repo', file: 'ROADMAP.md', now: () => 0 });

function session(id: string, title = `tab ${id}`): RoadmapLensSessionInput {
  return { sessionId: id, tabId: `tab-${id}`, title, harness: 'claude', needsAttention: false };
}

function link(sessionId: string, itemId: string): SessionLink {
  return {
    sessionId,
    tabId: `tab-${sessionId}`,
    projectDir: '/repo',
    itemId,
    method: 'inferred',
    confidence: 'high',
    evidence: [{ kind: 'branch-name', excerpt: `branch "${itemId.toLowerCase()}-x"` }],
    evaluatedAt: 0,
  };
}

describe('buildRoadmapLens', () => {
  it('groups the queue and crowns the first now item as the station', () => {
    const view = buildRoadmapLens({ read: { status: 'ok', doc, mtimeMs: 42 } });
    expect(view.status).toBe('ok');
    expect(view.now.map((i) => i.id)).toEqual(['ENG-016', 'ENG-017']);
    expect(view.now[0].isNowStation).toBe(true);
    expect(view.now[1].isNowStation).toBe(false);
    expect(view.now[0].displayStatus).toBe('active');
    expect(view.now[0].milestonesDone).toBe(1);
    // retired milestones leave the fraction entirely: 1/2, not 1/3
    expect(view.now[0].milestonesTotal).toBe(2);
    expect(view.next.map((i) => i.id)).toEqual(['ENG-018']);
    expect(view.next[0].blocked).toBe(true);
    expect(view.shipped.map((i) => i.id)).toEqual(['ENG-001']);
    expect(view.queueEmpty).toBe(false);
    expect(view.trust).toMatchObject({ file: 'ROADMAP.md', itemCount: 5, warningCount: 0 });
  });

  it('attaches linked sessions as chips and keeps unlinked ones unmapped', () => {
    const sessions = [session('a'), session('b'), session('c')];
    const links = [link('a', 'ENG-016'), link('b', 'ENG-999')];
    const view = buildRoadmapLens({
      read: { status: 'ok', doc, mtimeMs: 0 },
      sessions,
      links,
    });
    expect(view.now[0].chips.map((c) => c.sessionId)).toEqual(['a']);
    expect(view.now[0].chips[0].method).toBe('inferred');
    // b's link points at an item the doc no longer has; c has no link at all
    expect(view.unmappedSessions.map((s) => s.sessionId)).toEqual(['b', 'c']);
  });

  it('flags queueEmpty when nothing unfinished remains', () => {
    const done = parseRoadmap(`## Shipped\n\n### A-1 Done thing\n`, {
      projectDir: '/repo',
      file: 'ROADMAP.md',
      now: () => 0,
    });
    const view = buildRoadmapLens({ read: { status: 'ok', doc: done, mtimeMs: 0 } });
    expect(view.queueEmpty).toBe(true);
    expect(view.shipped).toHaveLength(1);
  });

  it('passes through none and error reads with sessions kept visible', () => {
    const none = buildRoadmapLens({
      read: { status: 'none', checked: ['ROADMAP.md'] },
      sessions: [session('a')],
    });
    expect(none.status).toBe('none');
    expect(none.checkedPaths).toEqual(['ROADMAP.md']);
    expect(none.unmappedSessions).toHaveLength(1);

    const err = buildRoadmapLens({ read: { status: 'error', error: 'boom' } });
    expect(err.status).toBe('error');
    expect(err.error).toBe('boom');
  });

  it('badges the item whose source lines carry parser warnings', () => {
    const warnDoc = parseRoadmap(
      `## Now\n\n### A-1 Thing\n\nStatus: someday — unknown token.\n`,
      { projectDir: '/repo', file: 'ROADMAP.md', now: () => 0 },
    );
    const view = buildRoadmapLens({ read: { status: 'ok', doc: warnDoc, mtimeMs: 0 } });
    expect(view.now[0].hasWarnings).toBe(true);
    expect(view.trust?.warningCount).toBe(1);
  });
});
