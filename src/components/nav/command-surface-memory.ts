import type { TenantWorkspace } from '@/lib/tenancy/workspace-scope';

export const LAST_COMMAND_SURFACE_KEY = 'exawatt:last-command-surface:v1';

/**
 * Command-surface routes whose pages mount `WorkspaceScopeGate` (ENG-027).
 * A non-personal tenant may only restore onto these — any surface missing
 * from this set would render Personal live truth under another tenant's
 * identity, so restore fails closed to `/workspace` (which is gated).
 * Adding a surface to `validStoredCommandSurface` without gating its route
 * must not silently widen what a non-personal tenant can land on.
 */
const TENANT_SCOPE_GATED_SURFACE_PATHS: ReadonlySet<string> = new Set([
  '/workspace',
  '/fleet/spatial',
  // ENG-027 W2: the usage surface has a per-tenant source (demo week vs the
  // Voltaic corpus), so it is in the gated set — its page mounts the gate.
  // Renamed /consumption → /usage 2026-08-03 with no redirect (operator:
  // hard cut); stored pre-rename '/consumption' memory simply fails this
  // validation and falls back to the default surface.
  '/usage',
]);

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

/**
 * Scope-aware variant: the surface must be valid AND, for non-personal
 * tenants, sit behind `WorkspaceScopeGate`. Callers restoring view state for
 * a tenant (boot restore, Workspace switch) use this so a remembered path can
 * never bypass the gate.
 */
export function validStoredCommandSurfaceForWorkspace(
  value: string | null,
  workspace: Pick<TenantWorkspace, 'kind'>
): string | null {
  const surface = validStoredCommandSurface(value);
  if (!surface) return null;
  if (workspace.kind === 'personal') return surface;
  const pathname = new URL(surface, 'https://exawatt.local').pathname;
  return TENANT_SCOPE_GATED_SURFACE_PATHS.has(pathname) ? surface : null;
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
