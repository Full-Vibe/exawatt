import { surfacesByTier } from './surfaces';

export type CommandAltitude = 'terminal' | 'sessions' | 'spatial';

export const COMMAND_ALTITUDE_HREFS = Object.fromEntries(
  surfacesByTier('spine').map(surface => [surface.id, surface.href])
) as Record<CommandAltitude, string>;

export const COMMAND_ALTITUDE_SURFACES = Object.fromEntries(
  surfacesByTier('spine').map(surface => [surface.id, surface])
) as Record<CommandAltitude, ReturnType<typeof surfacesByTier>[number]>;

/** Absolute, rebindable destination key advertised for an altitude. */
export function altitudeShortcutId(target: CommandAltitude): string | null {
  return COMMAND_ALTITUDE_SURFACES[target].gestureShortcutId ?? null;
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
