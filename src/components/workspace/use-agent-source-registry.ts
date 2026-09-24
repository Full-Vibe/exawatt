'use client';

/**
 * The one renderer reader of the Agent Source registry (BUG-062 / BUG-082).
 *
 * Both the composer and Settings → Agent Sources read the registry through
 * this hook, so both paint the same fact model: what this machine last
 * observed is painted FIRST, with no probe, and the live read revalidates it
 * behind the surface. Nothing waits for a login shell to paint.
 *
 *   mount ─→ checking placeholder ─→ remembered (if any) ─→ live
 *
 * `status` is about the LIVE read: `checking` while it is in flight, then
 * `live`, or `stale` (the read failed and an earlier registry stayed), or
 * `unavailable` (no bridge, or nothing to keep). `painted` says what the
 * registry currently on screen is. Per-source freshness derives from those
 * plus each snapshot's age (`agentSourceFactFreshness`).
 *
 * Newest-wins is owned by `useLatestRequest`: a recheck that overtakes the
 * mount read, or a Project change that overtakes a recheck, cannot be
 * overwritten by the older result (BUG-121's defect, stated once).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLatestRequest } from '@/hooks/use-latest-request';
import {
  checkingAgentSourceRegistry,
  loadAgentSourceRegistry,
  readRememberedAgentSourceRegistry,
} from './agent-sources';
import type {
  AgentSourceRegistryLoadResult,
  AgentSourceRegistrySnapshot,
} from '@exawatt/core';

type AgentSourceRegistryReadStatus =
  | 'checking'
  | 'live'
  | 'stale'
  | 'unavailable';

type AgentSourceRegistryPaint = 'none' | 'remembered' | 'live';

interface AgentSourceRegistryRead {
  registry: AgentSourceRegistrySnapshot;
  status: AgentSourceRegistryReadStatus;
  painted: AgentSourceRegistryPaint;
  error: AgentSourceRegistryLoadResult['error'];
  /**
   * Re-run the live probe. `force` bypasses the main-process cache, which is
   * what an operator Recheck means; a background revalidation does not.
   */
  recheck: (force?: boolean) => Promise<AgentSourceRegistryLoadResult>;
}

interface RegistryState {
  registry: AgentSourceRegistrySnapshot;
  status: AgentSourceRegistryReadStatus;
  painted: AgentSourceRegistryPaint;
  error: AgentSourceRegistryLoadResult['error'];
}

export function useAgentSourceRegistry(
  scope: 'all' | 'launch',
  options: { enabled?: boolean } = {}
): AgentSourceRegistryRead {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<RegistryState>(() => ({
    registry: checkingAgentSourceRegistry(scope),
    status: 'checking',
    painted: 'none',
    error: null,
  }));
  // The live read and the remembered read are one channel: whichever
  // request is newest owns the paint, and a remembered result that arrives
  // after the live one for the same request must not cover it.
  const reads = useLatestRequest();
  const latest = useRef(state);
  latest.current = state;

  const load = useCallback(
    async (force: boolean): Promise<AgentSourceRegistryLoadResult> => {
      const ticket = reads.begin();
      const previous =
        latest.current.painted === 'live' ? latest.current.registry : undefined;
      setState(current => ({ ...current, status: 'checking', error: null }));
      let liveLanded = false;
      if (latest.current.painted === 'none') {
        void readRememberedAgentSourceRegistry(scope).then(remembered => {
          if (!ticket.current || liveLanded || !remembered) return;
          setState(current =>
            current.painted === 'none'
              ? { ...current, registry: remembered, painted: 'remembered' }
              : current
          );
        });
      }
      const result = await loadAgentSourceRegistry(scope, force, previous);
      if (!ticket.current) return result;
      liveLanded = true;
      setState(current => {
        if (result.status === 'live') {
          return {
            registry: result.snapshot,
            status: 'live',
            painted: 'live',
            error: null,
          };
        }
        // The live read failed. Keep whatever is painted; a remembered
        // registry is still the best fact on this machine.
        const keep = current.painted !== 'none';
        return {
          registry: keep ? current.registry : result.snapshot,
          status: keep ? 'stale' : 'unavailable',
          painted: current.painted,
          error: result.error,
        };
      });
      return result;
    },
    [reads, scope]
  );

  useEffect(() => {
    setState({
      registry: checkingAgentSourceRegistry(scope),
      status: 'checking',
      painted: 'none',
      error: null,
    });
    if (!enabled) return;
    void load(false);
    return () => reads.invalidate();
  }, [enabled, load, reads, scope]);

  const recheck = useCallback((force = true) => load(force), [load]);

  return useMemo(
    () => ({ ...state, recheck }),
    [state, recheck]
  );
}
