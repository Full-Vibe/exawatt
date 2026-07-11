import { describe, it, expect } from 'vitest';
import { rankRecents } from './palette-recents';

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe('rankRecents', () => {
  it('ranks by count decayed by recency', () => {
    const now = 10 * WEEK;
    const ranked = rankRecents(
      [
        // heavy but stale: 8 uses, 3 half-lives ago → weight 1
        { id: 'nav-fleet', at: now - 3 * WEEK, count: 8 },
        // fresh single use → weight 1... tie-broken below by a fresher heavy
        { id: 'nav-terminal', at: now, count: 4 },
        { id: 'project:/p/a', at: now - WEEK, count: 4 },
      ],
      now,
      2
    );
    expect(ranked).toEqual(['nav-terminal', 'project:/p/a']);
  });

  it('limits results and survives empty history', () => {
    expect(rankRecents([], Date.now())).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `id-${i}`,
      at: i,
      count: 1,
    }));
    expect(rankRecents(many, 10, 5)).toHaveLength(5);
  });
});
