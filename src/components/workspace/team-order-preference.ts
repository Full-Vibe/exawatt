'use client';

/**
 * The Team sort preference (ENG-015 S6.3): device-local, app-global, and
 * remembered — the operator asked for the default to be "stored somehow".
 *
 * Deliberately the WEB storage source only, not the Electron settings
 * channel the Backgrounds toggle uses: that channel exists for preferences
 * that gate rendering work app-wide and future requests; this is one
 * surface's view order. localStorage persists identically in the Electron
 * renderer and the hosted web, and a same-tab event keeps every mounted
 * Team surface (workspace and demo tenant) in agreement. Promote it to the
 * settings channel only if a second surface ever needs it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TeamOrderMode } from './team-order';

export const TEAM_ORDER_STORAGE_KEY = 'exawatt.team-order.v1';
const TEAM_ORDER_EVENT = 'exawatt:team-order-changed';

export function readTeamOrderPreference(): TeamOrderMode {
  try {
    const stored = window.localStorage.getItem(TEAM_ORDER_STORAGE_KEY);
    // 'active-first' is the pre-rename spelling of the activity sort; a
    // stored choice survives the rename (data migrates, paths do not)
    return stored === 'activity' || stored === 'active-first'
      ? 'activity'
      : 'started';
  } catch {
    return 'started';
  }
}

export function writeTeamOrderPreference(mode: TeamOrderMode): void {
  try {
    window.localStorage.setItem(TEAM_ORDER_STORAGE_KEY, mode);
  } catch {
    // storage may be unavailable; the in-memory state still applies
  }
  window.dispatchEvent(
    new CustomEvent<TeamOrderMode>(TEAM_ORDER_EVENT, { detail: mode })
  );
}

export function useTeamOrderPreference(): [
  TeamOrderMode,
  (mode: TeamOrderMode) => void,
] {
  // read lazily so SSR and the first client render agree on the default
  const [mode, setMode] = useState<TeamOrderMode>('started');
  useEffect(() => {
    setMode(readTeamOrderPreference());
    const onChanged = (event: Event) =>
      setMode((event as CustomEvent<TeamOrderMode>).detail);
    // cross-tab: another window wrote the key
    const onStorage = (event: StorageEvent) => {
      if (event.key === TEAM_ORDER_STORAGE_KEY) {
        setMode(readTeamOrderPreference());
      }
    };
    window.addEventListener(TEAM_ORDER_EVENT, onChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TEAM_ORDER_EVENT, onChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = useCallback((next: TeamOrderMode) => {
    setMode(next);
    writeTeamOrderPreference(next);
  }, []);

  return [mode, set];
}
