'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
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
 * address. The verbs below therefore answer from the latest address asked
 * for, never from `route`: a key pressed inside that window means the same
 * thing it would mean a moment later (BUG-323).
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
  // A URL arriving from outside (deep link, back/forward) re-syncs the state.
  useEffect(() => {
    const fromUrl = readBoardRoute(searchParams);
    setRoute(previous =>
      sameBoardRoute(previous, fromUrl) ? previous : fromUrl
    );
  }, [searchParams]);

  // The latest address asked for: written by each move as it is asked, and
  // by each commit (a URL re-sync), never during render.
  const latest = useRef(route);
  useLayoutEffect(() => {
    latest.current = route;
  }, [route]);

  const commit = useCallback(
    (next: BoardRoute): boolean => {
      if (sameBoardRoute(latest.current, next)) return false;
      latest.current = next;
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

  /** Move the address. Returns whether it changed. */
  const navigate = useCallback(
    (next: BoardRouteMove) => commit(moveBoardRoute(latest.current, next)),
    [commit]
  );

  const drillToProject = useCallback(
    (projectId: string) =>
      void navigate({ altitude: 'project', project: projectId, agent: null }),
    [navigate]
  );

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

  return { route, navigate, drillToProject, overview, changeProjection };
}
