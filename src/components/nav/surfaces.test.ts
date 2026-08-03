import { describe, expect, it } from 'vitest';
import { isAppRoute } from './surfaces';

describe('isAppRoute', () => {
  it.each([
    '/workspace',
    '/fleet/spatial',
    '/fleet/spatial/deep',
    '/settings',
    '/consumption',
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
    '/deck',
    // retired legacy demo trio (decision 0023)
    '/fleet',
    '/dashboard',
    '/board',
  ])('does not classify public route %s as an app surface', pathname => {
    expect(isAppRoute(pathname)).toBe(false);
  });
});
