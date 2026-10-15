'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  FleetView,
  PresentationPreferencesV1,
} from '@exawatt/core/desktop-bridge';
import { createPresentationPreferenceSource } from '@/lib/presentation/preference-source';

interface PresentationContextValue {
  preference: PresentationPreferencesV1 | undefined;
  fleetView: FleetView;
  ready: boolean;
  setFleetView: (fleetView: FleetView) => Promise<void>;
  resetFleetView: () => Promise<void>;
}
const PresentationContext = createContext<PresentationContextValue | null>(
  null
);

export function usePresentation(): PresentationContextValue {
  const value = useContext(PresentationContext);
  if (!value)
    throw new Error('usePresentation must be used within PresentationProvider');
  return value;
}

export function PresentationProvider({ children }: { children: ReactNode }) {
  const source = useMemo(() => createPresentationPreferenceSource(), []);
  const [preference, setPreference] = useState<PresentationPreferencesV1>();
  const [ready, setReady] = useState(false);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    const accept = (next: PresentationPreferencesV1 | undefined) => {
      if (!active) return;
      setPreference(next);
      setReady(true);
    };
    const loadRevision = revision.current;
    const unsubscribe = source.subscribe(next => {
      revision.current++;
      accept(next);
    });
    void source.load().then(
      next => {
        if (revision.current === loadRevision) accept(next);
      },
      () => {
        if (active) setReady(true);
      }
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [source]);

  const commit = useCallback(
    async (next: PresentationPreferencesV1 | undefined) => {
      const saveRevision = ++revision.current;
      const saved = await source.save(next);
      // A settings broadcast may precede its response. Both carry the saved
      // snapshot; a later external choice must not be replaced by this response.
      if (revision.current === saveRevision) setPreference(saved);
    },
    [source]
  );
  const setFleetView = useCallback(
    (fleetView: FleetView) => commit({ schemaVersion: 1, fleetView }),
    [commit]
  );
  const resetFleetView = useCallback(() => commit(undefined), [commit]);
  const value = useMemo(
    () => ({
      preference,
      fleetView: preference?.fleetView ?? 'v1',
      ready,
      setFleetView,
      resetFleetView,
    }),
    [preference, ready, setFleetView, resetFleetView]
  );
  return (
    <PresentationContext.Provider value={value}>
      {children}
    </PresentationContext.Provider>
  );
}
