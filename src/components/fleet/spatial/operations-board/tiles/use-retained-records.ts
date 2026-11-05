'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

type Keyed = { readonly id: string };

const NONE: ReadonlyMap<string, never> = new Map<string, never>();

/**
 * Keeps a departing record drawable until its exit has played: `live` plus,
 * for each id in `wanted` that is no longer live, the value it had when it
 * left.
 *
 * Departures are learned at commit (a layout effect, before paint) and kept
 * in React state, never in a ref written during render: a render that never
 * commits (a transition React held or discarded) cannot leave a record behind
 * or lose one, and every render reads one consistent snapshot. The owner of
 * `wanted` learns of a departure in the same commit (the emergence tracker
 * reconciles in its own layout effect), so the record is there by the time it
 * is asked for. A departed record is forgotten once nothing wants it.
 */
export function useRetainedRecords<T extends Keyed>(
  live: readonly T[],
  wanted: readonly string[]
): readonly T[] {
  const [departed, setDeparted] = useState<ReadonlyMap<string, T>>(NONE);
  // Only the commit phase reads or writes this.
  const committedLive = useRef(live);
  useLayoutEffect(() => {
    const before = committedLive.current;
    committedLive.current = live;
    const liveIds = new Set(live.map(record => record.id));
    const keep = new Set(wanted);
    const left = before.filter(record => !liveIds.has(record.id));
    setDeparted(current => {
      let changed = left.length > 0;
      const next = new Map<string, T>();
      for (const [id, record] of current) {
        if (keep.has(id) && !liveIds.has(id)) next.set(id, record);
        else changed = true;
      }
      for (const record of left) next.set(record.id, record);
      return changed ? next : current;
    });
  }, [live, wanted]);

  return useMemo(() => {
    const liveIds = new Set(live.map(record => record.id));
    return [
      ...live,
      ...wanted
        .filter(id => !liveIds.has(id))
        .flatMap(id => {
          const record = departed.get(id);
          return record ? [record] : [];
        }),
    ];
  }, [live, wanted, departed]);
}
