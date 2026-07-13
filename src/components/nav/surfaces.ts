import { spatialReturnHref } from './spatial-return';

/**
 * Navigation manifest (ENG-016 D8).
 *
 * The single typed source of truth for the app's navigable surfaces. The
 * command palette's navigation groups, the go-chord targets, the header's
 * legacy menu, and the marketing-footer suppression all derive from this
 * list — the 2026-07-11 IA audit found five independently hardcoded (and
 * already diverged) copies of it. Add or rename a surface here, nowhere else.
 *
 * Tiers:
 * - `spine`  — the command-altitude continuum (Terminal → Sessions → Spatial),
 *   the primary Electron navigation. Spine affordances must never link into
 *   `legacy` surfaces.
 * - `app`    — first-class surfaces outside the continuum (Settings).
 * - `legacy` — demo-era surfaces kept reachable via the avatar menu and their
 *   go-chords, but out of primary navigation (ENG-016).
 */
export type SurfaceTier = 'spine' | 'app' | 'legacy';

export interface AppSurface {
  id:
    | 'terminal'
    | 'sessions'
    | 'spatial'
    | 'settings'
    | 'dashboard'
    | 'board'
    | 'fleet';
  /** canonical display name — every consumer must render exactly this */
  name: string;
  /** concise operational meaning used by navigation controls */
  summary: string;
  href: string;
  tier: SurfaceTier;
  /** registry shortcut id whose go-chord navigates here */
  shortcutId: string;
  /** direct gesture advertised when moving to this surface */
  gestureShortcutId?: string;
  /** extra palette search terms */
  keywords: string[];
}

export const APP_SURFACES: AppSurface[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    summary: 'Focus one live Session',
    href: '/workspace',
    tier: 'spine',
    shortcutId: 'go-workspace',
    gestureShortcutId: 'command-terminal',
    keywords: ['workspace', 'terminal', 'agents', 'launch'],
  },
  {
    id: 'sessions',
    name: 'Sessions',
    summary: 'All open Sessions, live and stopped',
    href: '/workspace?view=sessions',
    tier: 'spine',
    shortcutId: 'go-sessions',
    gestureShortcutId: 'command-sessions',
    keywords: ['overview', 'expose', 'grid', 'tiles', 'all sessions'],
  },
  {
    id: 'spatial',
    name: 'Spatial',
    summary: 'Fleet command field',
    href: '/fleet/spatial',
    tier: 'spine',
    shortcutId: 'go-spatial',
    gestureShortcutId: 'command-spatial',
    keywords: ['map', 'board', 'fleet command', 'altitude', 'zoom'],
  },
  {
    id: 'settings',
    name: 'Settings',
    summary: 'Preferences and shortcuts',
    href: '/settings',
    tier: 'app',
    shortcutId: 'go-settings',
    keywords: ['preferences', 'config', 'customize', 'shortcuts'],
  },
  {
    id: 'dashboard',
    name: 'Lattice',
    summary: 'Legacy task dashboard',
    href: '/dashboard',
    tier: 'legacy',
    shortcutId: 'go-dashboard',
    keywords: ['dashboard', 'metrics', 'tasks', 'demo'],
  },
  {
    id: 'board',
    name: 'Board',
    summary: 'Legacy task board',
    href: '/board',
    tier: 'legacy',
    shortcutId: 'go-board',
    keywords: ['kanban', 'tasks', 'swimlane', 'demo'],
  },
  {
    id: 'fleet',
    name: 'Fleet Command',
    summary: 'Legacy fleet dashboard',
    href: '/fleet',
    tier: 'legacy',
    shortcutId: 'go-fleet',
    keywords: ['fleet', 'agents', 'heartbeats', 'demo'],
  },
];

export function surfacesByTier(tier: SurfaceTier): AppSurface[] {
  return APP_SURFACES.filter(s => s.tier === tier);
}

export function surfaceForShortcut(shortcutId: string): AppSurface | undefined {
  return APP_SURFACES.find(s => s.shortcutId === shortcutId);
}

/** Navigation target for a surface. Spatial returns to the operator's exact
 *  last board address (semantic position is part of the context key). */
export function resolveSurfaceHref(surface: AppSurface): string {
  return surface.id === 'spatial' ? spatialReturnHref() : surface.href;
}

/** Routes that are the public website rather than the app: the marketing
 *  footer renders only here. Everything else is an app surface (fixed,
 *  full-viewport, no page scroll). */
const MARKETING_ROUTES = [
  '/privacy',
  '/terms',
  '/sign-in',
  '/sign-up',
  '/architecture',
];

export function isMarketingRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  return MARKETING_ROUTES.some(
    p => pathname === p || pathname.startsWith(`${p}/`)
  );
}
