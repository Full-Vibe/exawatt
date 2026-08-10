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
import { useCallback, useSyncExternalStore } from 'react';
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

/** Same-tab listeners plus cross-window `storage`, so every mounted Team
 *  surface agrees without a provider. */
function subscribeTeamOrder(onChange: () => void): () => void {
  window.addEventListener(TEAM_ORDER_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(TEAM_ORDER_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function writeTeamOrderPreference(mode: TeamOrderMode): void {
  try {
    window.localStorage.setItem(TEAM_ORDER_STORAGE_KEY, mode);
  } catch {
    // storage may be unavailable; the in-memory state still applies
  }
  window.dispatchEvent(new CustomEvent(TEAM_ORDER_EVENT));
}

export function useTeamOrderPreference(): {
  mode: TeamOrderMode;
  /** false until the stored choice has been read — the glide waits for it */
  ready: boolean;
  setMode: (mode: TeamOrderMode) => void;
} {
  // An external store, read through React's own contract rather than an
  // effect that assigns state after the first paint: the client's FIRST
  // render already carries the stored sort, so Team never paints Started and
  // then re-sorts. `getServerSnapshot` keeps SSR and hydration agreeing on
  // the default; `ready` marks the moment the two can diverge, which is what
  // the glide uses to treat the settle as a starting point, not a re-sort.
  const mode = useSyncExternalStore(
    subscribeTeamOrder,
    readTeamOrderPreference,
    () => 'started' as const
  );
  const ready = useSyncExternalStore(
    subscribeTeamOrder,
    () => true,
    () => false
  );
  const setMode = useCallback(
    (next: TeamOrderMode) => writeTeamOrderPreference(next),
    []
  );
  return { mode, ready, setMode };
}
