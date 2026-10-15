import { describe, expect, it } from 'vitest';
import { TileSlots } from './tile-slots';
import type { TileInstance } from './tile-contract';
const tile = (id: string): TileInstance => ({ id, agentId: id, x: 0, y: 0 });

describe('tile instance identity', () => {
  it('preserves slots across reorder and growth within spare capacity', () => {
    const pool = new TileSlots();
    const first = pool.reconcile([tile('a'), tile('b')]);
    const next = pool.reconcile([tile('b'), tile('new'), tile('a')]);
    for (const id of ['a', 'b']) {
      expect(next.slots.findIndex(t => t?.id === id)).toBe(
        first.slots.findIndex(t => t?.id === id)
      );
    }
    expect(next.capacity).toBe(first.capacity);
  });
  it('grows geometrically, preserves survivors and reclaims removed slots', () => {
    const pool = new TileSlots();
    const first = pool.reconcile([tile('anchor')]);
    const expanded = pool.reconcile(
      Array.from({ length: first.capacity + 1 }, (_, i) =>
        tile(i ? `a-${i}` : 'anchor')
      )
    );
    expect(expanded.capacity).toBeGreaterThan(first.capacity);
    expect(expanded.slots[0]?.id).toBe('anchor');
    const shrunk = pool.reconcile([tile('anchor'), tile('replacement')]);
    expect(shrunk.capacity).toBe(expanded.capacity);
    expect(shrunk.slots.filter(Boolean)).toHaveLength(2);
    expect(shrunk.slots[0]?.id).toBe('anchor');
  });
  it('rejects duplicate identity instead of aliasing two agents in one slot', () => {
    expect(() =>
      new TileSlots().reconcile([tile('same'), tile('same')])
    ).toThrow('unique');
  });
});
