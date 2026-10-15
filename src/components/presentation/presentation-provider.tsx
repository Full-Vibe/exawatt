'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import type {
  FleetView,
  FleetMaterial,
  PresentationPreferencesV1,
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
  const latest = useRef<PresentationPreferencesV1 | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const lifetime = useLatestRequest();
  const updates = useLatestRequest();

  useEffect(() => {
    const mounted = lifetime.begin();
    const accept = (next: PresentationPreferencesV1 | undefined) => {
      if (!mounted.current) return;
      latest.current = next;
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
      latest.current = next;
      const saved = await source.save(next);
      // A settings broadcast may precede its response. Both carry the saved
      // snapshot; a later external choice must not be replaced by this response.
      if (ticket.current) {
        latest.current = saved;
        setPreference(saved);
      }
    },
    [source, updates]
  );
  const update = useCallback(
    (patch: Partial<Omit<PresentationPreferencesV1, 'schemaVersion'>>) => {
      const next = { ...latest.current, schemaVersion: 1 as const, ...patch };
      return commit(next.fleetView || next.fleetMaterial ? next : undefined);
    },
    [commit]
  );
  const setFleetView = useCallback(
    (fleetView: FleetView) => update({ fleetView }),
    [update]
  );
  const resetFleetView = useCallback(
    () => update({ fleetView: undefined }),
    [update]
  );
  const setFleetMaterial = useCallback(
    (fleetMaterial: FleetMaterial) => update({ fleetMaterial }),
    [update]
  );
  const resetFleetMaterial = useCallback(
    () => update({ fleetMaterial: undefined }),
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
