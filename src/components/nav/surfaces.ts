import { spatialReturnHref } from './spatial-return';
import { CONSUMPTION_SURFACE_NAME } from '@/components/consumption/surface-name';

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
 *
 * Readiness (ENG-026 N0) is a fact about each surface, carried here and
 * rendered by the shared component set in `@/components/readiness`:
 * - `live`      — built, truthful, the user's own data. Normal presentation.
 * - `preview`   — the designed page exists and is navigable; it renders
 *   representative data under one persistent **Coming soon** marker. It never
 *   presents that data as the operator's own and never simulates an action
 *   succeeding.
 * - `announced` — the affordance is visible so the map is complete, but there
 *   is no page behind it. Muted, `cursor: default`, tooltip naming what is
 *   coming; visibly *not yet*, never broken.
 *
 * Readiness is a property of the data source, not of the page: shipping a
 * capability is a one-line flip here plus a source swap, never a page rewrite.
 * The command-altitude spine stays exactly three surfaces and every spine
 * surface stays `live` — nothing in the spine may link into an unbuilt state
 * (enforced by `surfaces.test.ts`).
 */
export type SurfaceTier = 'spine' | 'app';

export type SurfaceReadiness = 'live' | 'preview' | 'announced';

export interface AppSurface {
  id:
    | 'terminal'
    | 'sessions'
    | 'spatial'
    | 'settings'
    | 'consumption'
    | 'organization'
    | 'cloud'
    | 'coordination'
    | 'agent-types';
  /** canonical display name — every consumer must render exactly this */
  name: string;
  /** concise operational meaning used by navigation controls */
  summary: string;
  href: string;
  tier: SurfaceTier;
  readiness: SurfaceReadiness;
  /** registry shortcut id whose go-chord navigates here. Preview surfaces
   *  earn a chord when they flip `live`; the scarce letters stay with the
   *  surfaces the operator actually lives in. */
  shortcutId?: string;
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
    readiness: 'live',
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
    readiness: 'live',
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
    readiness: 'live',
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
    readiness: 'live',
    shortcutId: 'go-settings',
    keywords: ['preferences', 'config', 'customize', 'shortcuts'],
  },
  {
    // ENG-008 E4. A VIEW, not a fourth command altitude — the spine stays
    // exactly Agent → Team → Fleet, and this sits beside Settings.
    id: 'consumption',
    // Display name shared with the page title and window title. Renamed
    // "Usage" 2026-08-03 (operator + naming research); the id keeps its
    // historical spelling per the ids-are-addresses rule above. The old
    // /consumption route is gone — hard cut, no redirect (operator).
    name: CONSUMPTION_SURFACE_NAME,
    summary: 'What the fleet is spending, and on what',
    href: '/usage',
    tier: 'app',
    // ENG-008 E4 shipped it demo-sourced; E5 swaps the source and this line
    // flips to `live`. That flip is the whole deployment.
    readiness: 'preview',
    shortcutId: 'go-consumption',
    keywords: [
      'tokens',
      'cost',
      'spend',
      // the pre-rename display name stays findable in ⌘K
      'consumption',
      'watts',
      'energy',
      'burn',
      'capacity',
      'plan',
      'budget',
      'billing',
    ],
  },
  // --- Vision surfaces (ENG-026 N1) ------------------------------------
  // The intended IA, registered so the whole map is navigable. Each renders
  // a designed preview shell today; its owning roadmap item replaces the
  // body with real preview content (N3–N5) and eventually flips it `live`.
  {
    // ENG-012 / ENG-034 — the multiplayer and tenancy story. Named
    // Organization, not Team: decision 0023 gives Team to the middle
    // command altitude.
    id: 'organization',
    name: 'Organization',
    summary: 'People, Workspaces, and spend across your org',
    href: '/organization',
    tier: 'app',
    readiness: 'preview',
    keywords: [
      'team',
      'members',
      'permissions',
      'sharing',
      'multiplayer',
      'tenancy',
      'workspaces',
      'roles',
    ],
  },
  {
    // ENG-033 — one-click hosted agents, any source the user wants.
    id: 'cloud',
    name: 'Cloud',
    summary: 'Agents running on hosted plans, beside your local ones',
    href: '/cloud',
    tier: 'app',
    readiness: 'preview',
    keywords: ['hosted', 'remote', 'push to cloud', 'plans', 'always on'],
  },
  {
    // ENG-029 — shared context and handoff between a Project's agents.
    id: 'coordination',
    name: 'Coordination',
    summary: "How a Project's Agents share context and hand off",
    href: '/coordination',
    tier: 'app',
    readiness: 'preview',
    keywords: [
      'handoff',
      'blackboard',
      'bus',
      'shared context',
      // ENG-029 vocabulary: the coordination record is an *assignment*;
      // `claim` stays the assurance word and is never overloaded.
      'assignments',
      'crystallization',
    ],
  },
  {
    // ENG-028 — the portable Type is the worker; the harness is the engine.
    id: 'agent-types',
    name: 'Agent Types',
    summary: 'What kind of worker an Agent is, portable across harnesses',
    href: '/agent-types',
    tier: 'app',
    readiness: 'preview',
    keywords: [
      'types',
      'roles',
      'worker',
      'identity',
      'instructions',
      'tools',
      'defaults',
    ],
  },
];

export function surfacesByTier(tier: SurfaceTier): AppSurface[] {
  return APP_SURFACES.filter(s => s.tier === tier);
}

export function surfaceForShortcut(shortcutId: string): AppSurface | undefined {
  return APP_SURFACES.find(s => s.shortcutId === shortcutId);
}

export function surfaceById(id: AppSurface['id']): AppSurface {
  // ids are a closed union, so a miss is a programming error, not a state.
  return APP_SURFACES.find(s => s.id === id)!;
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
