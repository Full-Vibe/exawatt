import { describe, expect, it } from 'vitest';
import { isAppRoute } from './surfaces';

describe('isAppRoute', () => {
  it.each([
    '/workspace',
    '/fleet',
    '/fleet/spatial',
    '/fleet/agent-1',
    '/settings',
    '/dashboard',
    '/board',
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
  ])('does not classify public route %s as an app surface', pathname => {
    expect(isAppRoute(pathname)).toBe(false);
  });
});
