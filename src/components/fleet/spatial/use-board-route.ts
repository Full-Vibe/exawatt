'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { SpatialBoardProjection } from '@exawatt/ui-model';
import {
  moveBoardRoute,
  readBoardRoute,
  sameBoardRoute,
  writeBoardRoute,
  type BoardAltitude,
  type BoardRoute,
} from './board-route';

interface BoardRouteMove {
  altitude?: BoardAltitude;
  project?: string | null;
  agent?: string | null;
}

/**
 * The one owner of the board's address (see `board-route.ts`).
 *
 * `route` is the address the board has RENDERED. A move commits as a
 * transition, so the camera the move started paints before the board's
 * re-render; until that render commits, `route` still holds the previous
 * address. Every verb below therefore answers from the latest address asked
 * for, never from `route`, and every relative verb (ascend, select, toggle)
 * lives here so no caller decides from what it last rendered: a key pressed
 * inside that window means the same thing it would mean a moment later
 * (BUG-323).
 *
 * The latest address has two writers: a move, as it is asked, and the URL,
 * when it brings an address from outside (a deep link, the palette). A
 * render committing never writes it, and neither does the router catching up
 * with an address this owner wrote, even an older one that lands after a
 * newer move was asked.
 */
export function useBoardRoute({
  searchParams,
  replace,
}: {
  searchParams: URLSearchParams;
  /** Mirror the address to the URL (the router's `replace`). */
  replace: (href: string) => void;
}) {
  const [route, setRoute] = useState<BoardRoute>(() =>
    readBoardRoute(searchParams)
  );
  const latest = useRef(route);
  // Addresses written to the URL whose echo has not landed yet, oldest
  // first. The router lands navigations in order and may skip superseded
  // ones, so its echoes are a subsequence of these writes.
  const unechoed = useRef<BoardRoute[]>([]);

  useEffect(() => {
    const fromUrl = readBoardRoute(searchParams);
    if (sameBoardRoute(fromUrl, latest.current)) {
      // The URL reads what was last asked (or changed elsewhere, a filter):
      // everything written before it is settled.
      unechoed.current = [];
      return;
    }
    const echo = unechoed.current.findIndex(written =>
      sameBoardRoute(written, fromUrl)
    );
    if (echo !== -1) {
      // An older write of ours landing late: a newer move is already asked.
      unechoed.current = unechoed.current.slice(echo + 1);
      return;
    }
    unechoed.current = [];
    latest.current = fromUrl;
    setRoute(fromUrl);
  }, [searchParams]);

  const commit = useCallback(
    (next: BoardRoute): boolean => {
      if (sameBoardRoute(latest.current, next)) return false;
      latest.current = next;
      unechoed.current.push(next);
      // Non-urgent on purpose. A keydown is a discrete event, so React would
      // flush this render synchronously -- before the browser paints -- and
      // the camera the hotkey just started would wait behind an 80ms commit.
      // As a transition, the camera frame paints first and the board's
      // re-render follows.
      startTransition(() => setRoute(next));
      const params = writeBoardRoute(
        new URLSearchParams(window.location.search),
        next
      );
      const q = params.toString();
      replace(`/fleet/spatial${q ? `?${q}` : ''}`);
      return true;
    },
    [replace]
  );

  const navigate = useCallback(
    (next: BoardRouteMove) => commit(moveBoardRoute(latest.current, next)),
    [commit]
  );

  const drillToProject = useCallback(
    (projectId: string) =>
      void navigate({ altitude: 'project', project: projectId, agent: null }),
    [navigate]
  );

  /** Drill to an Agent, with its owning Project as the focused context. */
  const inspectAgent = useCallback(
    (agentId: string, owner: string | null) =>
      void navigate({ altitude: 'agent', project: owner, agent: agentId }),
    [navigate]
  );

  /**
   * Move the selection to an Agent at the altitude the board is going to
   * (the arrow keys, the Agent navigator).
   */
  const selectAgent = useCallback(
    (agentId: string, owner: string | null) => {
      const { altitude } = latest.current;
      void navigate({
        altitude,
        project: altitude === 'fleet' ? null : owner,
        agent: agentId,
      });
    },
    [navigate]
  );

  /**
   * One altitude up: an Agent to its Project, a Project to the Fleet. Returns
   * false at Fleet altitude, where there is nothing above.
   */
  const ascend = useCallback((): boolean => {
    const { altitude, projectId } = latest.current;
    if (altitude === 'fleet') return false;
    if (altitude === 'agent' && projectId) {
      return navigate({ altitude: 'project', project: projectId, agent: null });
    }
    return navigate({ altitude: 'fleet', project: null, agent: null });
  }, [navigate]);

  /**
   * Go up to the Fleet overview. Returns false when the address is already at
   * Fleet altitude, where the board answers by re-centering instead.
   */
  const overview = useCallback((): boolean => {
    if (latest.current.altitude === 'fleet') return false;
    return navigate({ altitude: 'fleet', project: null, agent: null });
  }, [navigate]);

  const changeProjection = useCallback(
    (projection: SpatialBoardProjection) =>
      void commit(moveBoardRoute(latest.current, { projection })),
    [commit]
  );

  const toggleProjection = useCallback(
    () =>
      changeProjection(
        latest.current.projection === 'top-down' ? 'fixed-angle' : 'top-down'
      ),
    [changeProjection]
  );

  return {
    route,
    drillToProject,
    inspectAgent,
    selectAgent,
    ascend,
    overview,
    changeProjection,
    toggleProjection,
  };
}
