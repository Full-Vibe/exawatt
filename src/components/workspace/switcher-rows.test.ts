import { describe, it, expect } from 'vitest';
import {
  sessionRowStatus,
  extractProjectColors,
  extractRecentProjects,
  extractRoadmapItemIds,
  buildSessionRows,
} from './switcher-rows';
import type { PtySessionInfo } from '@/types/electron';

const session = (over: Partial<PtySessionInfo> = {}): PtySessionInfo => ({
  id: 'pty-1',
  durableSessionId: 'session-one',
  harness: 'claude',
  title: 'Claude Code',
  cwd: '/p/a',
  projectDir: '/p/a',
  projectName: 'alpha',
  cols: 80,
  rows: 24,
  startedAt: 0,
  exited: false,
  exitCode: null,
  lastDataAt: 0,
  harnessSessionId: '11111111-1111-4111-8111-111111111111',
  ...over,
});

describe('sessionRowStatus', () => {
  const NOW = 100_000;
  it('mirrors the shared five-state turn model plus exited', () => {
    expect(
      sessionRowStatus(
        session({
          exited: true,
          attention: { kind: 'bell', since: NOW },
          working: true,
        }),
        NOW
      )
    ).toBe('exited');
    expect(
      sessionRowStatus(
        session({
          attention: { kind: 'bell', since: NOW },
          working: true,
        }),
        NOW
      )
    ).toBe('needs-you');
    expect(sessionRowStatus(session({ working: true }), NOW)).toBe('working');
    expect(
      sessionRowStatus(session({ working: false, engaged: true }), NOW)
    ).toBe('done');
    expect(
      sessionRowStatus(
        session({ working: false, contextSummary: 'Finished auth tests' }),
        NOW
      )
    ).toBe('done');
    expect(sessionRowStatus(session({ working: false }), NOW)).toBe('fresh');
    expect(
      sessionRowStatus(
        session({ harness: 'shell', working: false, engaged: true }),
        NOW
      )
    ).toBe('quiet');
  });

  it('trusts an explicit false working bit even when output is recent', () => {
    expect(
      sessionRowStatus(session({ working: false, lastDataAt: NOW - 1 }), NOW)
    ).toBe('fresh');
  });

  it('uses the monitor-equivalent 3s window only for legacy mocks', () => {
    expect(sessionRowStatus(session({ lastDataAt: NOW - 2_999 }), NOW)).toBe(
      'working'
    );
    expect(sessionRowStatus(session({ lastDataAt: NOW - 3_000 }), NOW)).toBe(
      'fresh'
    );
    expect(
      sessionRowStatus(session({ engaged: true, lastDataAt: NOW - 3_000 }), NOW)
    ).toBe('done');
  });

  it('working still outranks shell quiet in the shared model', () => {
    expect(
      sessionRowStatus(session({ harness: 'shell', working: true }), NOW)
    ).toBe('working');
  });

  it('exited wins over a stale attention flag', () => {
    expect(
      sessionRowStatus(
        session({ exited: true, attention: { kind: 'bell', since: 1 } }),
        NOW
      )
    ).toBe('exited');
  });
});

describe('extractProjectColors', () => {
  it('reads dir -> color from the v2 `projects` key, ignoring junk', () => {
    expect(
      extractProjectColors({
        projects: [
          { dir: '/p/a', color: '#123456' },
          { dir: '/p/b' }, // no color yet (fresh group)
          { nonsense: true },
          null,
        ],
      })
    ).toEqual({ '/p/a': '#123456' });
    expect(extractProjectColors(null)).toEqual({});
    expect(extractProjectColors('garbage')).toEqual({});
  });

  it('falls back to the v1 `initiatives` key (pre-ENG-015-S5 layouts)', () => {
    expect(
      extractProjectColors({
        initiatives: [{ dir: '/p/a', color: '#123456' }],
      })
    ).toEqual({ '/p/a': '#123456' });
  });
});

describe('buildSessionRows', () => {
  const NOW = 100_000;

  it('orders the complete attention and turn-state model', () => {
    const rows = buildSessionRows(
      [
        session({ id: 'fresh', working: false }),
        session({ id: 'quiet', harness: 'shell', working: false }),
        session({ id: 'done', working: false, engaged: true }),
        session({ id: 'dead', exited: true, exitCode: 0, working: false }),
        session({
          id: 'flag-new',
          attention: { kind: 'bell', since: NOW - 1_000 },
          lastDataAt: NOW,
          working: true,
        }),
        session({ id: 'working', lastDataAt: NOW - 2_000, working: true }),
        session({
          id: 'flag-old',
          attention: { kind: 'turn-end', since: NOW - 9_000 },
          lastDataAt: NOW,
          working: false,
        }),
      ],
      null,
      NOW
    );
    expect(rows.map(r => r.id)).toEqual([
      'flag-old',
      'flag-new',
      'working',
      'done',
      'fresh',
      'quiet',
      'dead',
    ]);
  });

  it('an exited session with a stale flag sorts by recency among exited rows', () => {
    const rows = buildSessionRows(
      [
        session({ id: 'dead-old', exited: true, lastDataAt: NOW - 60_000 }),
        session({
          id: 'dead-flagged-recent',
          exited: true,
          lastDataAt: NOW - 1_000,
          attention: { kind: 'bell', since: NOW - 30_000 },
        }),
      ],
      null,
      NOW
    );
    expect(rows.map(r => r.id)).toEqual(['dead-flagged-recent', 'dead-old']);
  });

  it('uses the layout color for the project, hash fallback otherwise', () => {
    const rows = buildSessionRows(
      [session({ id: 'a', projectDir: '/p/a' })],
      { projects: [{ dir: '/p/a', color: '#ABCDEF' }] },
      NOW
    );
    expect(rows[0].color).toBe('#ABCDEF');
    const fallback = buildSessionRows([session({ id: 'b' })], null, NOW);
    expect(fallback[0].color).toMatch(/^#|^rgb|^hsl/);
  });

  it('search value carries title, project, and micro-context', () => {
    const [row] = buildSessionRows(
      [session({ contextSummary: 'fixing auth tests' })],
      null,
      NOW
    );
    expect(row.searchValue).toBe('Claude Code alpha fixing auth tests');
    expect(row.subtitle).toBe('fixing auth tests');
  });
});

describe('extractRecentProjects', () => {
  it('merges open groups with the durable recency record, open first', () => {
    const layout = {
      v: 3,
      projects: [{ dir: '/p/a', name: 'alpha', color: '#0ff', tabs: [] }],
      recentProjects: [
        { dir: '/p/a', name: 'alpha-stale', lastOpenedAt: 1 },
        { dir: '/p/b', name: 'beta', color: '#f0f', lastOpenedAt: 2 },
      ],
    };
    expect(extractRecentProjects(layout)).toEqual([
      { dir: '/p/a', name: 'alpha', color: '#0ff' },
      { dir: '/p/b', name: 'beta', color: '#f0f' },
    ]);
  });

  it('reads pre-D8 layouts (no recentProjects) and v1 initiatives', () => {
    expect(
      extractRecentProjects({
        v: 1,
        initiatives: [{ dir: '/p/c', name: '', tabs: [] }],
      })
    ).toEqual([{ dir: '/p/c', name: 'c' }]);
    expect(extractRecentProjects(null)).toEqual([]);
    expect(extractRecentProjects({ v: 3, projects: 'bogus' })).toEqual([]);
  });
});

describe('extractRoadmapItemIds', () => {
  it('maps sessionId to the declared roadmap item across projects', () => {
    const layout = {
      v: 4,
      projects: [
        {
          dir: '/p/a',
          tabs: [
            { sessionId: 'pty-1', roadmapItemId: 'APP-018' },
            { sessionId: 'pty-2', roadmapItemId: null },
          ],
        },
        { dir: '/p/b', tabs: [{ sessionId: 'pty-3', roadmapItemId: 'APP-003' }] },
      ],
    };
    expect(extractRoadmapItemIds(layout)).toEqual({
      'pty-1': 'APP-018',
      'pty-3': 'APP-003',
    });
    expect(extractRoadmapItemIds(null)).toEqual({});
  });

  it('rides into rows and their search value', () => {
    const layout = {
      v: 4,
      projects: [
        { dir: '/p/a', tabs: [{ sessionId: 'pty-1', roadmapItemId: 'APP-018' }] },
      ],
    };
    const rows = buildSessionRows([session()], layout, 100_000);
    expect(rows[0].roadmapItemId).toBe('APP-018');
    expect(rows[0].searchValue).toContain('APP-018');
  });
});
