// Named as a DOM suite because the return address is browser-session state.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isSpatialReturnHref,
  rememberSpatialReturn,
  spatialReturnHref,
} from './spatial-return';

describe('Spatial return address', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('preserves a deep Agent address and projection', () => {
    const href =
      '/fleet/spatial?altitude=agent&project=project%3AAlpha&agent=a-1&projection=fixed-angle';
    rememberSpatialReturn(href);
    expect(spatialReturnHref()).toBe(href);
  });

  it('falls back when no return address exists', () => {
    expect(spatialReturnHref()).toBe('/fleet/spatial');
  });

  it('rejects external, sibling, and malformed paths', () => {
    expect(isSpatialReturnHref('https://example.com/fleet/spatial')).toBe(
      false
    );
    expect(isSpatialReturnHref('/fleet')).toBe(false);
    expect(isSpatialReturnHref('not a route')).toBe(false);
    rememberSpatialReturn('https://example.com/fleet/spatial');
    expect(spatialReturnHref()).toBe('/fleet/spatial');
  });
});
