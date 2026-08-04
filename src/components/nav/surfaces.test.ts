import { describe, expect, it } from 'vitest';
import {
  APP_SURFACES,
  NAVIGATION_SURFACES,
  commandPaletteSurfaces,
  isAppRoute,
  isMarketingRoute,
  surfaceById,
  surfacesByTier,
  usesDarkPublicChrome,
} from './surfaces';

describe('navigation destination contract', () => {
  it('keeps destination identity and hrefs unique in the one manifest', () => {
    expect(new Set(NAVIGATION_SURFACES.map(surface => surface.id)).size).toBe(
      NAVIGATION_SURFACES.length
    );
    expect(new Set(NAVIGATION_SURFACES.map(surface => surface.href)).size).toBe(
      NAVIGATION_SURFACES.length
    );
  });

  it('makes Leaderboard commandable without changing its public presentation', () => {
    const leaderboard = NAVIGATION_SURFACES.find(
      surface => surface.id === 'leaderboard'
    );

    expect(leaderboard).toMatchObject({
      routeClass: 'marketing',
      href: '/leaderboard',
      readiness: 'live',
      commandPalette: true,
    });
    expect(commandPaletteSurfaces()).toContain(leaderboard);
    expect(isAppRoute('/leaderboard')).toBe(false);
    expect(isMarketingRoute('/leaderboard')).toBe(true);
  });

  it('never exposes inert announced destinations as executable palette rows', () => {
    expect(commandPaletteSurfaces()).not.toContainEqual(
      expect.objectContaining({ readiness: 'announced' })
    );
  });
});

describe('isAppRoute', () => {
  it.each([
    '/workspace',
    '/fleet/spatial',
    '/fleet/spatial/deep',
    '/settings',
    '/usage',
    // ENG-026 N1 vision surfaces
    '/organization',
    '/cloud',
    '/coordination',
    '/agent-types',
  ])('recognizes registered app surface %s', pathname => {
    expect(isAppRoute(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/architecture',
    '/privacy',
    '/terms',
    '/sign-in',
    '/sign-up',
    '/leaderboard',
    '/operator/jake',
    '/run/abc123def456',
    '/deck',
    // retired legacy demo trio (decision 0023)
    '/fleet',
    '/dashboard',
    '/board',
  ])('does not classify public route %s as an app surface', pathname => {
    expect(isAppRoute(pathname)).toBe(false);
  });
});

describe('usesDarkPublicChrome', () => {
  it.each(['/', '/architecture', '/architecture/agent-sources'])(
    'keeps authored dark public chrome on %s',
    pathname => {
      expect(usesDarkPublicChrome(pathname)).toBe(true);
    }
  );

  it.each(['/settings', '/hud-gallery', '/privacy'])(
    'leaves app appearance in control on %s',
    pathname => {
      expect(usesDarkPublicChrome(pathname)).toBe(false);
    }
  );
});

describe('readiness (ENG-026 N0/N1)', () => {
  it('every surface states its readiness', () => {
    for (const surface of APP_SURFACES) {
      expect(['live', 'preview', 'announced']).toContain(surface.readiness);
    }
  });

  it('nothing in the spine links into an unbuilt state', () => {
    for (const surface of surfacesByTier('spine')) {
      expect(surface.readiness).toBe('live');
    }
  });

  it('an announced surface would have no page, so it may not carry an href users can follow', () => {
    // No announced SURFACES exist today (announced is currently a per-control
    // fact); if one is ever added, this test forces the conversation about
    // where its entry points may appear.
    expect(APP_SURFACES.filter(s => s.readiness === 'announced')).toEqual([]);
  });

  it('live surfaces keep their go-chords; preview surfaces defer theirs', () => {
    for (const surface of APP_SURFACES) {
      if (surface.readiness === 'live') {
        expect(surface.shortcutId, surface.id).toBeTruthy();
      }
    }
  });

  it('consumption is preview until ENG-008 E5 swaps the source', () => {
    expect(surfaceById('consumption').readiness).toBe('preview');
  });

  it('the vision surfaces are registered as navigable previews in the app tier', () => {
    for (const id of [
      'organization',
      'cloud',
      'coordination',
      'agent-types',
    ] as const) {
      const surface = surfaceById(id);
      expect(surface.tier).toBe('app');
      expect(surface.readiness).toBe('preview');
      expect(surface.href).toBe(`/${id}`);
    }
  });
});
