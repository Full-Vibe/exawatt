export type CommandAltitude = 'terminal' | 'sessions' | 'spatial';

export const COMMAND_ALTITUDE_HREFS: Record<CommandAltitude, string> = {
  terminal: '/workspace',
  sessions: '/workspace?view=sessions',
  spatial: '/fleet/spatial',
};

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
