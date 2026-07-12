import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '@exawatt/core';
import { buildRoadmapLens } from './roadmap-lens';
import { buildRoadmapStrip } from './roadmap-strip';
import type { RoadmapLensSessionInput } from './roadmap-lens';
import type { SessionLink } from '@exawatt/core';

const DIR = '/p';
const FILE = 'roadmap.md';

function lens(md: string, sessions: RoadmapLensSessionInput[] = [], links: SessionLink[] = []) {
  const doc = parseRoadmap(md, { projectDir: DIR, file: FILE });
  return buildRoadmapLens({ read: { status: 'ok', doc, mtimeMs: 1 }, sessions, links });
}

const item = (id: string, title: string, status: string) =>
  `### ${id} ${title}\n\nStatus: ${status}\n`;

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

describe('buildRoadmapStrip', () => {
  it('marks current by attachment, not position', () => {
    const view = lens(
      `## Now\n\n${item('A-1', 'First', 'now')}${item('A-2', 'Second', 'now')}\n## Next\n\n${item('A-3', 'Third', 'next')}`,
      [session(1)],
      [link(1, 'A-2')]
    );
    const nodes = buildRoadmapStrip(view);
    const roles = nodes.map(n => (n.kind === 'item' ? `${n.id}:${n.role}` : n.kind));
    expect(roles).toEqual(['A-1:now', 'A-2:current', 'A-3:next']);
  });

  it('falls back to the now station when nothing is attached', () => {
    const view = lens(`## Now\n\n${item('A-1', 'First', 'now')}`);
    const nodes = buildRoadmapStrip(view);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'item', id: 'A-1', role: 'current' });
  });

  it('compresses shipped first, then the later tail', () => {
    const shipped = Array.from({ length: 5 }, (_, i) => item(`S-${i}`, `Done ${i}`, 'shipped')).join('');
    const later = Array.from({ length: 20 }, (_, i) => item(`L-${i}`, `Later ${i}`, 'later')).join('');
    const view = lens(`## Shipped\n\n${shipped}\n## Now\n\n${item('N-1', 'Current', 'now')}\n## Later\n\n${later}`);
    const nodes = buildRoadmapStrip(view, 8);
    const agg = nodes.filter(n => n.kind === 'aggregate');
    expect(agg).toEqual([
      expect.objectContaining({ group: 'shipped', count: 5 }),
      expect.objectContaining({ group: 'later', count: 15 }),
    ]);
    expect(nodes).toHaveLength(8);
  });

  it('counts the unmapped node in the budget (never exceeds the cap)', () => {
    const shipped = Array.from({ length: 5 }, (_, i) => item(`S-${i}`, `Done ${i}`, 'shipped')).join('');
    const later = Array.from({ length: 20 }, (_, i) => item(`L-${i}`, `Later ${i}`, 'later')).join('');
    const view = lens(
      `## Shipped\n\n${shipped}\n## Now\n\n${item('N-1', 'Current', 'now')}\n## Later\n\n${later}`,
      [session(1)] // an unmapped session (no link)
    );
    const nodes = buildRoadmapStrip(view, 8);
    expect(nodes.length).toBeLessThanOrEqual(8);
    expect(nodes[0].kind).toBe('unmapped');
  });

  it('never hides now/next even when they exceed the cap', () => {
    const now = Array.from({ length: 10 }, (_, i) => item(`N-${i}`, `Now ${i}`, 'now')).join('');
    const view = lens(`## Now\n\n${now}`);
    const nodes = buildRoadmapStrip(view, 4);
    const nowNodes = nodes.filter(n => n.kind === 'item');
    expect(nowNodes).toHaveLength(10);
  });

  it('renders starving with shipped context when the queue is empty', () => {
    const view = lens(`## Shipped\n\n${item('S-1', 'Done', 'shipped')}`, [session(1)]);
    const nodes = buildRoadmapStrip(view);
    expect(nodes.map(n => n.kind)).toEqual(['unmapped', 'aggregate', 'starving']);
  });

  it('carries blocked and attention flags onto item nodes', () => {
    const view = lens(
      `## Now\n\n${item('B-1', 'Stuck', 'blocked')}`,
      [{ ...session(1), needsAttention: true }],
      [link(1, 'B-1')]
    );
    const nodes = buildRoadmapStrip(view);
    expect(nodes[0]).toMatchObject({ blocked: true, attached: true, needsAttention: true });
  });
});
