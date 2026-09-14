'use client';

/**
 * The one owner of "only the newest request may commit".
 *
 * BUG-118, BUG-119, BUG-120 and BUG-121 were one defect, an older read
 * overwriting newer state, fixed four times with four local sequence
 * counters. By 2026-09-13 the renderer carried nine named generation refs
 * across twenty files and twenty-two `let cancelled` effects with no shared
 * hook, so the fifth instance was guaranteed. This is the shared hook.
 *
 * A component holds one `LatestRequest` per CHANNEL: two channels that must
 * not invalidate each other (a roadmap read and its activity read) are two
 * hooks. `begin()` opens a ticket and supersedes every earlier one; a result
 * commits only while `ticket.current` is still true. Unmount supersedes
 * everything, and `invalidate()` supersedes on demand (a scope change, an
 * operator cancel) without opening a new ticket.
 *
 *   const reads = useLatestRequest();
 *   const load = useCallback(async () => {
 *     const ticket = reads.begin();
 *     const result = await api.read();
 *     if (!ticket.current) return;
 *     setState(result);
 *   }, [reads]);
 *
 * Inside an effect, `return () => reads.invalidate()` is the cleanup that
 * `let cancelled = false` used to hand-roll.
 *
 * `src/hooks/use-latest-request.ratchet.test.ts` fails on a new hand-rolled
 * counter or `let cancelled` effect, the way BUG-057's lint fails on a wall
 * clock in a test.
 */

import { useEffect, useMemo, useRef } from 'react';

export interface RequestTicket {
  /** True while no newer request has begun and the owner is still mounted. */
  readonly current: boolean;
}

export interface LatestRequest {
  /** Open a ticket for a new request, superseding every earlier ticket. */
  begin(): RequestTicket;
  /**
   * A ticket for the request already in progress, without beginning a new
   * one: a follow-up read that belongs to the current pass (a file-change
   * re-read of one Project inside the current set of open Projects).
   */
  current(): RequestTicket;
  /** Supersede every open ticket without beginning a new request. */
  invalidate(): void;
}

export function useLatestRequest(): LatestRequest {
  // The one generation counter this primitive exists to replace elsewhere.
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );
  return useMemo(() => {
    const ticket = (mine: number): RequestTicket => ({
      get current() {
        return generation.current === mine;
      },
    });
    return {
      begin: () => ticket(++generation.current),
      current: () => ticket(generation.current),
      invalidate() {
        generation.current += 1;
      },
    };
  }, []);
}
