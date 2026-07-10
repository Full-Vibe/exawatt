import { describe, it, expect } from 'vitest';
import {
  sessionRowStatus,
  extractProjectColors,
  buildSessionRows,
} from './switcher-rows';
import type { PtySessionInfo } from '@/types/electron';

const session = (over: Partial<PtySessionInfo> = {}): PtySessionInfo => ({
  id: 'pty-1',
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
  ...over,
});

describe('sessionRowStatus', () => {
  const NOW = 100_000;
  it('maps the four states', () => {
    expect(sessionRowStatus(session({ exited: true }), NOW)).toBe('exited');
    expect(
      sessionRowStatus(
        session({ attention: { kind: 'bell', since: NOW } }),
        NOW
      )
    ).toBe('needs-you');
    expect(sessionRowStatus(session({ lastDataAt: NOW - 5_000 }), NOW)).toBe(
      'working'
    );
    expect(sessionRowStatus(session({ lastDataAt: NOW - 60_000 }), NOW)).toBe(
      'idle'
    );
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
  it('reads dir -> color tolerantly and ignores junk', () => {
    expect(
      extractProjectColors({
        initiatives: [
          { dir: '/p/a', color: '#123456' },
          { dir: '/p/b' }, // no color yet (legacy layout)
          { nonsense: true },
          null,
        ],
      })
    ).toEqual({ '/p/a': '#123456' });
    expect(extractProjectColors(null)).toEqual({});
    expect(extractProjectColors('garbage')).toEqual({});
  });
});

describe('buildSessionRows', () => {
  const NOW = 100_000;

  it('orders needs-you (oldest flag first), then working by recency, then idle, then exited', () => {
    const rows = buildSessionRows(
      [
        session({ id: 'idle', lastDataAt: NOW - 60_000 }),
        session({ id: 'dead', exited: true, exitCode: 0 }),
        session({ id: 'flag-new', attention: { kind: 'bell', since: NOW - 1_000 }, lastDataAt: NOW }),
        session({ id: 'working', lastDataAt: NOW - 2_000 }),
        session({ id: 'flag-old', attention: { kind: 'turn-end', since: NOW - 9_000 }, lastDataAt: NOW }),
      ],
      null,
      NOW
    );
    expect(rows.map((r) => r.id)).toEqual([
      'flag-old',
      'flag-new',
      'working',
      'idle',
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
    expect(rows.map((r) => r.id)).toEqual(['dead-flagged-recent', 'dead-old']);
  });

  it('uses the layout color for the project, hash fallback otherwise', () => {
    const rows = buildSessionRows(
      [session({ id: 'a', projectDir: '/p/a' })],
      { initiatives: [{ dir: '/p/a', color: '#ABCDEF' }] },
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
