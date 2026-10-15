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
  FleetMaterial,
  PresentationPreferencesV1,
  PresentationUpdate,
} from '@exawatt/core/desktop-bridge';
import { useLatestRequest } from '@/hooks/use-latest-request';
import { createPresentationPreferenceSource } from '@/lib/presentation/preference-source';

interface PresentationContextValue {
  preference: PresentationPreferencesV1 | undefined;
  fleetView: FleetView;
  fleetMaterial: FleetMaterial;
  ready: boolean;
  setFleetView: (fleetView: FleetView) => Promise<void>;
  resetFleetView: () => Promise<void>;
  setFleetMaterial: (material: FleetMaterial) => Promise<void>;
  resetFleetMaterial: () => Promise<void>;
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

  const update = useCallback(
    async (intent: PresentationUpdate) => {
      const ticket = updates.begin();
      const saved = await source.update(intent);
      // Broadcasts are authoritative, including one that arrives before this
      // response. Never let a delayed response undo a later persisted choice.
      if (ticket.current) setPreference(saved);
    },
    [source, updates]
  );
  const setFleetView = useCallback(
    (value: FleetView) => update({ field: 'fleetView', value }),
    [update]
  );
  const resetFleetView = useCallback(
    () => update({ field: 'fleetView', value: null }),
    [update]
  );
  const setFleetMaterial = useCallback(
    (value: FleetMaterial) => update({ field: 'fleetMaterial', value }),
    [update]
  );
  const resetFleetMaterial = useCallback(
    () => update({ field: 'fleetMaterial', value: null }),
    [update]
  );
  const value = useMemo(
    () => ({
      preference,
      fleetView: preference?.fleetView ?? 'v1',
      fleetMaterial: preference?.fleetMaterial ?? 'gummy',
      ready,
      setFleetView,
      resetFleetView,
      setFleetMaterial,
      resetFleetMaterial,
    }),
    [
      preference,
      ready,
      setFleetView,
      resetFleetView,
      setFleetMaterial,
      resetFleetMaterial,
    ]
  );
  return (
    <PresentationContext.Provider value={value}>
      {children}
    </PresentationContext.Provider>
  );
}
