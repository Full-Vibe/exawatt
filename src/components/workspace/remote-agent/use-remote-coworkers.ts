'use client';

/**
 * The workspace's read of the connected roster (ENG-033 H2).
 *
 * One reader for the whole workspace: Team paints from it, a coworker's pane
 * resolves from it, and both see the same thing at the same time. The roster
 * is PULLED — a source change is a tick naming which source moved, and this
 * hook re-reads rather than the main process pushing a topology payload per
 * reconnect attempt.
 *
 * A failed read is never evidence about the coworkers. The last-known roster
 * stays exactly as it was and the freshness each tile carries is what says
 * the view is not current.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_REMOTE_ROSTER,
  projectCoworkers,
  type RemoteCoworkerTile,
  type RemoteRoster,
} from './remote-agent-roster';

function connectedSourcesApi() {
  if (typeof window === 'undefined') return null;
  return window.electron?.connectedSources ?? null;
}

export interface RemoteCoworkers {
  roster: RemoteRoster;
  coworkers: RemoteCoworkerTile[];
  /** Ask a source to raise this device from observation to conversation. */
  requestWriteAccess: (sourceId: string) => void;
  /** Repair observation. Never touches the remote Agent's work. */
  reconnect: (sourceId: string) => void;
  /** Re-read and return the exact roster snapshot committed to React. */
  refresh: () => Promise<RemoteRoster | null>;
}

export function useRemoteCoworkers(enabled = true): RemoteCoworkers {
  const [roster, setRoster] = useState<RemoteRoster>(EMPTY_REMOTE_ROSTER);
  const readGeneration = useRef(0);

  const read = useCallback(async () => {
    const api = connectedSourcesApi();
    if (!api) return null;
    const generation = ++readGeneration.current;
    try {
      const [sources, agents, authorities] = await Promise.all([
        api.list(),
        api.agents(),
        api.commandAuthority(),
      ]);
      const next = { sources, agents, authorities, loaded: true } as const;
      // Mount, change ticks, Reconnect, and Connect completion can overlap.
      // A read started before a newer one cannot overwrite newer topology.
      if (generation !== readGeneration.current) return null;
      setRoster(next);
      return next;
    } catch {
      // Keep the last-known roster. Losing the read says nothing about the
      // coworkers, and replacing what is on screen with emptiness would.
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const api = connectedSourcesApi();
    if (!api) return;
    let cancelled = false;
    void read();
    const off = api.onChanged?.(() => {
      if (!cancelled) void read();
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [enabled, read]);

  const requestWriteAccess = useCallback(
    (sourceId: string) => {
      const api = connectedSourcesApi();
      if (!api?.requestCommandAuthority) return;
      // The answer is the source's, including `approval-required`, so the
      // roster is re-read rather than the outcome being assumed here.
      void api
        .requestCommandAuthority(sourceId)
        .then(() => read())
        .catch(() => undefined);
    },
    [read]
  );

  const reconnect = useCallback(
    (sourceId: string) => {
      const api = connectedSourcesApi();
      if (!api?.connect) return;
      void api
        .connect(sourceId)
        .then(() => read())
        .catch(() => undefined);
    },
    [read]
  );

  const coworkers = useMemo(() => projectCoworkers(roster), [roster]);

  return {
    roster,
    coworkers,
    requestWriteAccess,
    reconnect,
    refresh: read,
  };
}
