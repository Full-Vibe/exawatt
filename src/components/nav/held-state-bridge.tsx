'use client';

import { useEffect } from 'react';
import {
  captureHeldState,
  registerHeldState,
  restoreHeldState,
} from '@/lib/app-lifecycle/held-state';
import { sessionStorageHolder } from '@/lib/app-lifecycle/session-storage-holder';

// Module scope, not an effect: the previous run's held state must be back in
// place before any surface reads it at mount (the Fleet camera reads its
// viewport on its first frame). The read is synchronous and answers once per
// launch, so a reload or a second window gets nothing.
if (typeof window !== 'undefined') {
  registerHeldState('session-storage', sessionStorageHolder(window));
  const held = window.electron?.app?.takeHeldState?.();
  if (held) restoreHeldState(held);
}

/**
 * Answers the lifecycle owner's held-state request for this window (BUG-260).
 * Where the operator stands is already the command-altitude memory's
 * (`command-altitude-nav.tsx`, localStorage); this carries what lived only
 * for the run.
 */
export function HeldStateBridge() {
  useEffect(() => {
    const api = window.electron?.app;
    if (!api) return;
    return api.onHeldStateRequest(({ requestId }) => {
      void api
        .completeHeldState(requestId, captureHeldState())
        .catch(() => undefined);
    });
  }, []);

  return null;
}
