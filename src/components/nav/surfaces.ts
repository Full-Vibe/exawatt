import { spatialReturnHref } from './spatial-return';

/**
 * Navigation manifest (ENG-016 D8).
 *
 * The single typed source of truth for the app's navigable surfaces. The
 * command palette's navigation groups, the go-chord targets, and the
 * marketing-footer suppression all derive from this list — the 2026-07-11
 * IA audit found five independently hardcoded (and already diverged) copies
 * of it. Add or rename a surface here, nowhere else.
 *
 * Altitude names are decision 0023: Agent → Team → Fleet (singular → group →
 * everything). Surface ids and route paths are internal addresses and keep
 * their historical spellings; user-facing labels are what the decision owns.
 * The legacy demo trio (/fleet, /dashboard, /board) retired with that
 * decision — the Demo Workspace (ENG-027) supersedes its purpose.
 *
 * Tiers:
 * - `spine`  — the command-altitude continuum (Agent → Team → Fleet),
 *   the primary Electron navigation.
 * - `app`    — first-class surfaces outside the continuum (Settings).
 */
export type SurfaceTier = 'spine' | 'app';

export interface AppSurface {
  id: 'terminal' | 'sessions' | 'spatial' | 'settings' | 'consumption';
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
    name: 'Agent',
    summary: 'One live Agent, its terminal, its work',
    href: '/workspace',
    tier: 'spine',
    shortcutId: 'go-workspace',
    gestureShortcutId: 'command-terminal',
    keywords: ['workspace', 'terminal', 'agents', 'launch'],
  },
  {
    id: 'sessions',
    name: 'Team',
    summary: 'Your Projects and the Agents working them',
    href: '/workspace?view=sessions',
    tier: 'spine',
    shortcutId: 'go-sessions',
    gestureShortcutId: 'command-sessions',
    keywords: ['overview', 'expose', 'grid', 'tiles', 'all sessions'],
  },
  {
    id: 'spatial',
    name: 'Fleet',
    summary: 'All of it, at population scale',
    href: '/fleet/spatial',
    tier: 'spine',
    shortcutId: 'go-spatial',
    gestureShortcutId: 'command-spatial',
    keywords: ['map', 'board', 'spatial', 'altitude', 'zoom'],
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
    // ENG-008 E4. A VIEW, not a fourth command altitude — the spine stays
    // exactly Agent → Team → Fleet, and this sits beside Settings.
    id: 'consumption',
    name: 'Consumption',
    summary: 'What the fleet is spending, and on what',
    href: '/consumption',
    tier: 'app',
    shortcutId: 'go-consumption',
    keywords: [
      'tokens',
      'cost',
      'spend',
      'usage',
      'watts',
      'energy',
      'burn',
      'capacity',
      'plan',
      'budget',
      'billing',
    ],
  },
];

export function surfacesByTier(tier: SurfaceTier): AppSurface[] {
  return APP_SURFACES.filter(s => s.tier === tier);
}

export function surfaceForShortcut(shortcutId: string): AppSurface | undefined {
  return APP_SURFACES.find(s => s.shortcutId === shortcutId);
}

/** Navigation target for a surface. Fleet returns to the operator's exact
 *  last board address (semantic position is part of the context key). */
export function resolveSurfaceHref(surface: AppSurface): string {
  return surface.id === 'spatial' ? spatialReturnHref() : surface.href;
}

const APP_ROUTE_PREFIXES = Array.from(
  new Set(APP_SURFACES.map(surface => surface.href.split('?')[0]))
);

/** True only for registered product surfaces, including their nested routes. */
export function isAppRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Public website routes that render the marketing footer. Internal previews
 *  and eval routes are intentionally footerless without becoming app routes. */
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
