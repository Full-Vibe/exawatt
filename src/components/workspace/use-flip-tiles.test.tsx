import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFlipTiles } from './use-flip-tiles';

/**
 * The FLIP glide's one load-bearing invariant (ENG-015 S6.3, repaired
 * 2026-08-16 under FIX-002's verification).
 *
 * A tile glides because the hook still holds where that tile WAS. It holds
 * that only while React keeps the same ref callback attached — a fresh
 * closure per render makes React detach and re-attach every ref, and every
 * detach drops the prior rect. The cache that keeps callback identity
 * stable used to evict itself on detach, so a single detach (React's Strict
 * Mode double-invokes refs on every dev mount) started a cycle it could
 * never leave: new closure, detach, evict, new closure. The re-sort then
 * snapped in silence, because a tile with no prior rect is indistinguishable
 * from a tile that has just arrived.
 */
describe('useFlipTiles ref identity', () => {
  it('keeps one callback per tile across renders, and across a detach', () => {
    const { result, rerender } = renderHook(
      ({ orderKey, animate }: { orderKey: string; animate: boolean }) =>
        useFlipTiles(orderKey, animate),
      { initialProps: { orderKey: 'a,b,c', animate: true } }
    );

    const first = result.current('a');
    expect(result.current('a')).toBe(first);

    rerender({ orderKey: 'a,b,c', animate: true });
    expect(result.current('a')).toBe(first);

    // React detached the ref — Strict Mode does exactly this once on mount.
    // The callback must survive it, or the next render hands React a new one
    // and the detach/re-attach cycle never ends.
    first(null);
    rerender({ orderKey: 'a,b,c', animate: true });
    expect(result.current('a')).toBe(first);

    // A re-sort must not change identity either: the tile is the same tile,
    // it is only somewhere else.
    rerender({ orderKey: 'b,a,c', animate: true });
    expect(result.current('a')).toBe(first);
  });

  it('gives a different callback to a different tile', () => {
    const { result } = renderHook(() => useFlipTiles('a,b', true));
    expect(result.current('a')).not.toBe(result.current('b'));
  });
});
