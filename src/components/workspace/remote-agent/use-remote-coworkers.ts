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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
}

export function useRemoteCoworkers(enabled = true): RemoteCoworkers {
  const [roster, setRoster] = useState<RemoteRoster>(EMPTY_REMOTE_ROSTER);

  const read = useCallback(async () => {
    const api = connectedSourcesApi();
    if (!api) return;
    try {
      const [sources, agents, authorities] = await Promise.all([
        api.list(),
        api.agents(),
        api.commandAuthority(),
      ]);
      setRoster({ sources, agents, authorities, loaded: true });
    } catch {
      // Keep the last-known roster. Losing the read says nothing about the
      // coworkers, and replacing what is on screen with emptiness would.
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

  return { roster, coworkers, requestWriteAccess, reconnect };
}
