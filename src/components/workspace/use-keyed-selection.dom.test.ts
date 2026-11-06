import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useKeyedSelection } from './use-keyed-selection';

const keyOf = (item: string) => item;

function setup(initial: string[], start = 0) {
  return renderHook(
    ({ items }: { items: string[] }) =>
      useKeyedSelection(items, keyOf, () => start),
    { initialProps: { items: initial } }
  );
}

describe('useKeyedSelection', () => {
  it('stays on the same item when the items reorder or grow ahead of it', () => {
    const { result, rerender } = setup(['a', 'b', 'c'], 1);
    expect(result.current[0]).toBe(1);
    rerender({ items: ['b', 'a', 'c'] });
    expect(result.current[0]).toBe(0);
    rerender({ items: ['new', 'b', 'a', 'c'] });
    expect(result.current[0]).toBe(1);
  });

  it('moves only when told, by position or from the current position', () => {
    const { result, rerender } = setup(['a', 'b', 'c']);
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    rerender({ items: ['c', 'a', 'b'] });
    expect(result.current[0]).toBe(0);
    act(() => result.current[1](current => current + 1));
    expect(result.current[0]).toBe(1);
    rerender({ items: ['a', 'c', 'b'] });
    expect(result.current[0]).toBe(0);
  });

  it('falls to the nearest item when the selected one is gone', () => {
    const { result, rerender } = setup(['a', 'b', 'c'], 2);
    rerender({ items: ['a', 'b'] });
    expect(result.current[0]).toBe(1);
    // a clamp from the position the gone item held moves to its neighbour
    let seen = -1;
    act(() =>
      result.current[1](current => {
        seen = current;
        return Math.min(current, 1);
      })
    );
    expect(seen).toBe(2);
    rerender({ items: ['x', 'a', 'b'] });
    expect(result.current[0]).toBe(2);
  });

  it('holds the item that took a gone selection’s place by identity, when the count is unchanged', () => {
    // An empty Project's placeholder becomes its first tab: the same count,
    // a new key. The selection must not drift with later reorders.
    const { result, rerender } = setup(['a', 'project:/x', 'c'], 1);
    rerender({ items: ['a', 'tab-1', 'c'] });
    expect(result.current[0]).toBe(1);
    rerender({ items: ['tab-1', 'a', 'c'] });
    expect(result.current[0]).toBe(0);
    rerender({ items: ['a', 'c', 'tab-1'] });
    expect(result.current[0]).toBe(2);
  });

  it('ignores a position outside the items', () => {
    const { result } = setup(['a', 'b']);
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(0);
  });
});
