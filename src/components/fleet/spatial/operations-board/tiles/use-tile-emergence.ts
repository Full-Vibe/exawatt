'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SpatialBoardPiece } from '@exawatt/ui-model';
import {
  createEmergenceTracker,
  type EmergenceTracker,
} from '../operations-board-emergence';
import { useFrameScheduler } from '@/lib/frame-demand/frame-demand';
import { useRetainedRecords } from './use-retained-records';

/** Shared lifecycle policy, with React retaining departing pieces (in state,
 * `useRetainedRecords`) until the same transition clock has taken their
 * instance scale to zero. */
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
  }, [solid, retiring]);
  const rendered = useRetainedRecords(solid, retiring);
  const getTracker = useCallback(() => tracker.current!, []);
  return { visible, rendered, getTracker };
}
