import { surfacesByTier } from './surfaces';

export type CommandAltitude = 'terminal' | 'sessions' | 'spatial';

export const COMMAND_ALTITUDE_HREFS = Object.fromEntries(
  surfacesByTier('spine').map(surface => [surface.id, surface.href])
) as Record<CommandAltitude, string>;

const COMMAND_ALTITUDE_SURFACES = Object.fromEntries(
  surfacesByTier('spine').map(surface => [surface.id, surface])
) as Record<CommandAltitude, ReturnType<typeof surfacesByTier>[number]>;

/** Which rebindable gesture moves from the current altitude to the target. */
export function altitudeGestureShortcutId(
  active: CommandAltitude | null,
  target: CommandAltitude
): string | null {
  if (active === target) return null;
  const gestureOwner =
    target === 'terminal' && active
      ? COMMAND_ALTITUDE_SURFACES[active]
      : COMMAND_ALTITUDE_SURFACES[target];
  return gestureOwner.gestureShortcutId ?? null;
}

export function resolveCommandAltitude(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>
): CommandAltitude | null {
  if (pathname.startsWith('/fleet/spatial')) return 'spatial';
  if (!pathname.startsWith('/workspace')) return null;
  return searchParams.get('view') === 'sessions' ? 'sessions' : 'terminal';
}

export function isCommandSurface(pathname: string): boolean {
  return (
    pathname.startsWith('/workspace') || pathname.startsWith('/fleet/spatial')
  );
}
