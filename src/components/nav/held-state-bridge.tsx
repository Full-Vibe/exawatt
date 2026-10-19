'use client';

import { useEffect, useLayoutEffect } from 'react';
import {
  captureHeldState,
  registerHeldState,
  restoreHeldState,
  type HeldStateRestoreFailure,
} from '@/lib/app-lifecycle/held-state';
import { sessionStorageHolder } from '@/lib/app-lifecycle/session-storage-holder';

/**
 * Names what could not be put back, never what it held: a held value can be
 * an unsent draft.
 */
function reportRestoreFailure({
  holder,
  entry,
  error,
}: HeldStateRestoreFailure): void {
  const cause =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  void window.electron?.app
    ?.reportRenderError?.({
      kind: 'error',
      message:
        `Held state was not restored (${holder}${entry ? ` ${entry}` : ''}). ${cause}`.slice(
          0,
          500
        ),
      stack: null,
      source: 'held-state',
      pathname: window.location.pathname,
    })
    .catch(() => undefined);
}

/**
 * The window's side of held state (BUG-260): hands the previous run's held
 * state back once, and answers the lifecycle owner's request for this
 * window's. Where the operator stands is already the command-altitude
 * memory's (`command-altitude-nav.tsx`, localStorage); this carries what
 * lived only for the run.
 *
 * The hand-back runs in a layout effect, never while a module is being
 * evaluated (the 0.1.22 review: a throw there took the window down outside
 * every boundary). The root layout renders this bridge before the page, and
 * React runs an earlier sibling's layout effects before any of a later
 * sibling's effects, so every surface's own effects already see the
 * restored state; per-run storage is read in effects, never during render,
 * which hydration requires anyway. The read is synchronous and answers once
 * per launch, so a reload or a second window gets nothing.
 */
export function HeldStateBridge() {
  useLayoutEffect(() => {
    const unregister = registerHeldState(
      'session-storage',
      sessionStorageHolder(window)
    );
    try {
      const held = window.electron?.app?.takeHeldState?.();
      if (held) restoreHeldState(held, reportRestoreFailure);
    } catch (error) {
      reportRestoreFailure({ holder: 'hand-back', entry: null, error });
    }
    return unregister;
  }, []);

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
