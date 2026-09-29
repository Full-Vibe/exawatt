'use client';

/**
 * Environment preferences the board reads before its first frame: reduced
 * motion, low power, and page visibility. Split from the canvas so every
 * layer module can state its motion policy against one shared source.
 */

import { useEffect, useState } from 'react';
import { lowPowerLikely } from '@/components/nav/altitude-handoff';

/** Reads matchMedia synchronously on mount (guide rule 12): initializing to
 *  `false` and correcting in an effect gave reduced-motion users one animated
 *  entrance frame set — entrances must SNAP for them, so the first render
 *  already needs the real preference. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function useLowPowerMode(): boolean {
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    // Shared predicate with the altitude handoff (V3.0): the same machine
    // that renders low-power also skips the entry-pose choreography.
    setLowPower(lowPowerLikely());
  }, []);
  return lowPower;
}
