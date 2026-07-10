const SPATIAL_RETURN_KEY = 'exawatt:spatial-return';
const DEFAULT_SPATIAL_RETURN = '/fleet/spatial';

export function isSpatialReturnHref(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value, 'https://exawatt.local');
    return (
      url.origin === 'https://exawatt.local' &&
      url.pathname === '/fleet/spatial'
    );
  } catch {
    return false;
  }
}

export function rememberSpatialReturn(href: string): void {
  if (typeof window === 'undefined' || !isSpatialReturnHref(href)) return;
  window.sessionStorage.setItem(SPATIAL_RETURN_KEY, href);
}

export function spatialReturnHref(): string {
  if (typeof window === 'undefined') return DEFAULT_SPATIAL_RETURN;
  const stored = window.sessionStorage.getItem(SPATIAL_RETURN_KEY);
  return isSpatialReturnHref(stored) ? stored : DEFAULT_SPATIAL_RETURN;
}
