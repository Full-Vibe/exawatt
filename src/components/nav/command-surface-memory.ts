export const LAST_COMMAND_SURFACE_KEY = 'exawatt:last-command-surface:v1';

/** Accept only durable command-surface addresses from local renderer state. */
export function validStoredCommandSurface(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://exawatt.local');
    if (url.origin !== 'https://exawatt.local') return null;
    if (url.pathname === '/fleet/spatial') {
      return `${url.pathname}${url.search}`;
    }
    if (
      url.pathname === '/workspace' &&
      url.searchParams.get('view') === 'sessions'
    ) {
      return '/workspace?view=sessions';
    }
    if (url.pathname === '/workspace' && !url.search) return '/workspace';
    return null;
  } catch {
    return null;
  }
}

export function commandSurfaceAddress(
  pathname: string,
  searchParams: URLSearchParams
): string | null {
  if (pathname === '/fleet/spatial') {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  }
  if (pathname !== '/workspace') return null;
  return searchParams.get('view') === 'sessions'
    ? '/workspace?view=sessions'
    : '/workspace';
}
