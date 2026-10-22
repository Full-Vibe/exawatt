'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SpatialBoardPiece } from '@exawatt/ui-model';
import {
  createEmergenceTracker,
  type EmergenceTracker,
} from '../operations-board-emergence';
import { useFrameScheduler } from '@/lib/frame-demand/frame-demand';

/** Shared lifecycle policy, with React retaining departing tile records until
 * the same transition clock has taken their instance scale to zero. */
export function useTileEmergence(
  pieces: SpatialBoardPiece[],
  reduced: boolean
) {
  const visible = useMemo(
    () => pieces.filter(piece => piece.visible && piece.kind === 'agent'),
    [pieces]
  );
  const solid = useMemo(
    () => visible.filter(piece => piece.sessionState !== 'stopped'),
    [visible]
  );
  const tracker = useRef<EmergenceTracker | null>(null);
  if (!tracker.current)
    tracker.current = createEmergenceTracker(
      solid.map(piece => piece.id),
      reduced ? 0 : undefined
    );
  const records = useRef(new Map<string, SpatialBoardPiece>());
  for (const piece of solid) records.current.set(piece.id, piece);
  const [retiring, setRetiring] = useState<string[]>([]);
  const previousReduced = useRef(reduced);
  const frames = useFrameScheduler();
  useLayoutEffect(() => {
    if (previousReduced.current !== reduced) {
      tracker.current = createEmergenceTracker(
        solid.map(piece => piece.id),
        reduced ? 0 : undefined
      );
      previousReduced.current = reduced;
    }
    const current = tracker.current!;
    current.reconcile(
      solid.map(piece => piece.id),
      performance.now()
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const now = performance.now();
      const next = current.retiring(now);
      setRetiring(previous =>
        previous.length === next.length &&
        previous.every((id, index) => id === next[index])
          ? previous
          : next
      );
      // Arrivals and departures have a known end: paint through it.
      const remaining = current.remainingMs(now);
      frames.request();
      frames.until(now + remaining);
      if (remaining > 0) timer = setTimeout(settle, remaining);
    };
    settle();
    return () => clearTimeout(timer);
  }, [solid, reduced, frames]);
  useLayoutEffect(() => {
    tracker.current!.prune(performance.now(), retiring);
    const retained = new Set([
      ...solid.map(piece => piece.id),
      ...retiring,
      ...tracker.current!.retiring(performance.now()),
    ]);
    for (const id of records.current.keys())
      if (!retained.has(id)) records.current.delete(id);
  }, [solid, retiring]);
  const rendered = useMemo(() => {
    const ids = new Set(solid.map(piece => piece.id));
    return [
      ...solid,
      ...retiring
        .filter(id => !ids.has(id))
        .flatMap(id => {
          const piece = records.current.get(id);
          return piece ? [piece] : [];
        }),
    ];
  }, [solid, retiring]);
  const getTracker = useCallback(() => tracker.current!, []);
  return { visible, rendered, getTracker };
}
