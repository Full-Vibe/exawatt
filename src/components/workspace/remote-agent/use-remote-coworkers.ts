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
import type { WriteAccessAnswer } from './remote-agent-surface';

function connectedSourcesApi() {
  if (typeof window === 'undefined') return null;
  return window.electron?.connectedSources ?? null;
}

export interface RemoteCoworkers {
  roster: RemoteRoster;
  coworkers: RemoteCoworkerTile[];
  /** Ask a source to raise this device from observation to conversation. */
  requestWriteAccess: (sourceId: string) => Promise<WriteAccessAnswer | null>;
  /** Approve Exawatt's own request on the server in one click, then ask. */
  approveWriteAccess: (sourceId: string) => Promise<WriteAccessAnswer | null>;
  /** Repair observation. Never touches the remote Agent's work. */
  reconnect: (sourceId: string) => void;
  /** Re-read and return the exact roster snapshot committed to React. */
  refresh: () => Promise<RemoteRoster | null>;
}

export function useRemoteCoworkers(enabled = true): RemoteCoworkers {
  const [roster, setRoster] = useState<RemoteRoster>(EMPTY_REMOTE_ROSTER);
  const readGeneration = useRef(0);
  /** The newest read in flight. A superseded read answers with ITS result. */
  const newestRead = useRef<Promise<RemoteRoster | null> | null>(null);

  const read = useCallback((): Promise<RemoteRoster | null> => {
    const api = connectedSourcesApi();
    if (!api) return Promise.resolve(null);
    const generation = ++readGeneration.current;
    const task = (async () => {
      try {
        const [sources, agents, authorities] = await Promise.all([
          api.list(),
          api.agents(),
          api.commandAuthority(),
        ]);
        const next = { sources, agents, authorities, loaded: true } as const;
        // Mount, change ticks, Reconnect, and Connect completion can overlap.
        // A read started before a newer one cannot overwrite newer topology,
        // and it does not answer with nothing either: null is a FAILED read,
        // and "Connect and open X" read it as "X is not there" and opened
        // nothing whenever the source's own change tick raced the refresh.
        // The newer read's answer is the current roster, so wait for it.
        if (generation !== readGeneration.current) {
          return newestRead.current ?? next;
        }
        setRoster(next);
        return next;
      } catch {
        // Keep the last-known roster. Losing the read says nothing about the
        // coworkers, and replacing what is on screen with emptiness would.
        return null;
      }
    })();
    newestRead.current = task;
    return task;
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
    async (sourceId: string): Promise<WriteAccessAnswer | null> => {
      const api = connectedSourcesApi();
      if (!api?.requestCommandAuthority) return null;
      // The answer is the source's, including `approval-required`, so the
      // roster is re-read rather than the outcome being assumed here. The
      // answer also goes back to the pane, which says what a check found
      // (BUG-156).
      try {
        const answer = await api.requestCommandAuthority(sourceId);
        await read();
        return { outcome: answer.outcome, message: answer.message };
      } catch {
        return null;
      }
    },
    [read]
  );

  const approveWriteAccess = useCallback(
    async (sourceId: string): Promise<WriteAccessAnswer | null> => {
      const api = connectedSourcesApi();
      if (!api?.approveCommandAuthority) return null;
      try {
        const answer = await api.approveCommandAuthority(sourceId);
        await read();
        return { outcome: answer.outcome, message: answer.message };
      } catch {
        return null;
      }
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
    approveWriteAccess,
    reconnect,
    refresh: read,
  };
}
