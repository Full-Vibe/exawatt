'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  FleetView,
  PresentationPreferencesV1,
} from '@exawatt/core/desktop-bridge';
import { useLatestRequest } from '@/hooks/use-latest-request';
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
  const lifetime = useLatestRequest();
  const updates = useLatestRequest();

  useEffect(() => {
    const mounted = lifetime.begin();
    const accept = (next: PresentationPreferencesV1 | undefined) => {
      if (!mounted.current) return;
      setPreference(next);
      setReady(true);
    };
    const loadTicket = updates.begin();
    const unsubscribe = source.subscribe(next => {
      updates.invalidate();
      accept(next);
    });
    void source.load().then(
      next => {
        if (loadTicket.current) accept(next);
      },
      () => {
        if (mounted.current) setReady(true);
      }
    );
    return () => {
      lifetime.invalidate();
      updates.invalidate();
      unsubscribe();
    };
  }, [source, lifetime, updates]);

  const commit = useCallback(
    async (next: PresentationPreferencesV1 | undefined) => {
      const ticket = updates.begin();
      const saved = await source.save(next);
      // A settings broadcast may precede its response. Both carry the saved
      // snapshot; a later external choice must not be replaced by this response.
      if (ticket.current) setPreference(saved);
    },
    [source, updates]
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
