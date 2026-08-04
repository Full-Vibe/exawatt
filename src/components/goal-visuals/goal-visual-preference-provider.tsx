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
import { createGoalVisualPreferenceSource } from '@/lib/goal-visuals/preference-source';

interface GoalVisualPreferenceContextValue {
  enabled: boolean;
  ready: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

const GoalVisualPreferenceContext =
  createContext<GoalVisualPreferenceContextValue | null>(null);

export function useGoalVisualPreference(): GoalVisualPreferenceContextValue {
  const value = useContext(GoalVisualPreferenceContext);
  if (!value) {
    throw new Error(
      'useGoalVisualPreference must be used within GoalVisualPreferenceProvider'
    );
  }
  return value;
}

export function GoalVisualPreferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const source = useMemo(() => createGoalVisualPreferenceSource(), []);
  const [enabled, setEnabledState] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const accept = (next: boolean) => {
      if (!active) return;
      setEnabledState(next);
      setReady(true);
    };
    void source.load().then(accept, () => {
      if (active) setReady(true);
    });
    const unsubscribe = source.subscribe(accept);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [source]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      const saved = await source.save(next);
      setEnabledState(saved);
    },
    [source]
  );

  const value = useMemo(
    () => ({ enabled, ready, setEnabled }),
    [enabled, ready, setEnabled]
  );

  return (
    <GoalVisualPreferenceContext.Provider value={value}>
      {children}
    </GoalVisualPreferenceContext.Provider>
  );
}
