'use client';

/**
 * A roving selection held by identity, read as a position (BUG-333).
 *
 * Team's tiles rebuild whenever an Agent starts or stops working (the
 * Active-first order moves it) or a tab opens or closes earlier in the grid.
 * A selection kept as a position then points at whatever tile slid into
 * that slot, and the Project the dock shows changes under the operator. The
 * selection is the item's key; its position is derived from the items each
 * render, so only the operator (or an explicit command) moves it.
 *
 * The setter keeps the position-based shape callers already use: a number,
 * or an updater from the current position. When the selected item is gone,
 * the current position is the one it last held, so a caller that clamps to
 * the list's length lands on its nearest neighbour, as it always did.
 *
 * Until something moves it, a gone selection shows the item that took its
 * place, held by that item's key (its stand-in), never by the position: an
 * empty Project's placeholder becoming its first tab keeps the count, so no
 * clamp runs, and a position would drift with the next reorder (review
 * front 2026-11-05). If the selected item returns, the selection is its
 * again.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface Held {
  key: string | null;
  /** where the selected item last was, for when it is gone */
  index: number;
  /** while `key` is gone: the item shown in its place, by identity */
  standIn?: string;
}

function clamp(index: number, length: number): number {
  return Math.min(Math.max(0, index), Math.max(0, length - 1));
}

export function useKeyedSelection<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  initialIndex: () => number
): [number, (next: number | ((current: number) => number)) => void] {
  const [held, setHeld] = useState<Held>(() => {
    const index = initialIndex();
    const item = items[index];
    return { key: item === undefined ? null : keyOf(item), index };
  });
  const itemsRef = useRef(items);
  const keyOfRef = useRef(keyOf);
  useLayoutEffect(() => {
    itemsRef.current = items;
    keyOfRef.current = keyOf;
  }, [items, keyOf]);

  const indexOf = (key: string | null | undefined) =>
    key == null ? -1 : items.findIndex(item => keyOf(item) === key);
  const found = indexOf(held.key);
  const standIn = found === -1 ? indexOf(held.standIn) : -1;
  const index =
    found !== -1
      ? found
      : standIn !== -1
        ? standIn
        : clamp(held.index, items.length);
  // Gone, with no stand-in present: the item now at its place becomes one.
  // Adjusting state while rendering, from the items this render received.
  if (found === -1 && standIn === -1 && items[index] !== undefined) {
    setHeld({ ...held, standIn: keyOf(items[index]) });
  }

  const select = useCallback((next: number | ((current: number) => number)) => {
    setHeld(previous => {
      const list = itemsRef.current;
      const key = keyOfRef.current;
      const at =
        previous.key === null
          ? -1
          : list.findIndex(item => key(item) === previous.key);
      // Gone: the position it held, so a clamp moves to its neighbour.
      const current = at === -1 ? previous.index : at;
      const target = typeof next === 'function' ? next(current) : next;
      const item = list[target];
      if (item === undefined) return previous;
      const nextKey = key(item);
      return nextKey === previous.key && target === previous.index
        ? previous
        : { key: nextKey, index: target };
    });
  }, []);

  return [index, select];
}
