import type { SpatialBoardProjection } from '@exawatt/ui-model';

/**
 * The board's semantic address: altitude, focused Project, selected Agent, and
 * projection. It is deep-linkable, so it lives in the URL -- but the URL is
 * where it is REMEMBERED, not where the frame reads it from.
 *
 * **Why the client holds this as state and mirrors it to the URL.** A hotkey
 * used to go `router.replace` -> URL -> `useSearchParams` -> re-render ->
 * layout -> camera, and the first frame that moved arrived 84-142ms after
 * the key. An RTS hotkey moves the camera on the keystroke's frame. Holding
 * the route as local state lets everything react synchronously; the URL
 * follows, and a URL that arrives from outside (deep link, back/forward)
 * re-syncs the state. The two never disagree for longer than one commit.
 */
export type BoardAltitude = 'fleet' | 'project' | 'agent';

export interface BoardRoute {
  altitude: BoardAltitude;
  projectId: string | null;
  agentId: string | null;
  projection: SpatialBoardProjection;
}

export function readBoardRoute(params: URLSearchParams): BoardRoute {
  const rawAltitude = params.get('altitude');
  return {
    altitude:
      rawAltitude === 'project' || rawAltitude === 'agent'
        ? rawAltitude
        : 'fleet',
    projectId: params.get('project'),
    agentId: params.get('agent'),
    projection:
      params.get('projection') === 'fixed-angle' ? 'fixed-angle' : 'top-down',
  };
}

/** Write the route into `params` in place, deleting what is at its default. */
export function writeBoardRoute(
  params: URLSearchParams,
  route: BoardRoute
): URLSearchParams {
  if (route.altitude !== 'fleet') params.set('altitude', route.altitude);
  else params.delete('altitude');
  if (route.projectId) params.set('project', route.projectId);
  else params.delete('project');
  if (route.agentId) params.set('agent', route.agentId);
  else params.delete('agent');
  if (route.projection === 'fixed-angle') params.set('projection', route.projection);
  else params.delete('projection');
  return params;
}

export function sameBoardRoute(a: BoardRoute, b: BoardRoute): boolean {
  return (
    a.altitude === b.altitude &&
    a.projectId === b.projectId &&
    a.agentId === b.agentId &&
    a.projection === b.projection
  );
}

/** Apply a partial move to a route, the way the board's verbs express one. */
export function moveBoardRoute(
  route: BoardRoute,
  next: {
    altitude?: BoardAltitude;
    project?: string | null;
    agent?: string | null;
    projection?: SpatialBoardProjection;
  }
): BoardRoute {
  return {
    altitude: next.altitude ?? route.altitude,
    projectId: 'project' in next ? (next.project ?? null) : route.projectId,
    agentId: 'agent' in next ? (next.agent ?? null) : route.agentId,
    projection: next.projection ?? route.projection,
  };
}
