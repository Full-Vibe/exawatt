import { describe, expect, it } from 'vitest';
import {
  commandSurfaceAddress,
  validStoredCommandSurface,
} from './command-surface-memory';

describe('command surface memory', () => {
  it('keeps semantic Spatial state and canonicalizes workspace state', () => {
    expect(
      validStoredCommandSurface(
        '/fleet/spatial?altitude=project&project=p1&q=build'
      )
    ).toBe('/fleet/spatial?altitude=project&project=p1&q=build');
    expect(validStoredCommandSurface('/workspace?view=sessions&junk=1')).toBe(
      '/workspace?view=sessions'
    );
  });

  it('rejects external and unrelated addresses', () => {
    expect(
      validStoredCommandSurface('https://example.com/workspace')
    ).toBeNull();
    expect(validStoredCommandSurface('/settings')).toBeNull();
  });

  it('builds the current durable command address', () => {
    expect(
      commandSurfaceAddress(
        '/fleet/spatial',
        new URLSearchParams('projection=fixed-angle')
      )
    ).toBe('/fleet/spatial?projection=fixed-angle');
    expect(
      commandSurfaceAddress('/workspace', new URLSearchParams('view=sessions'))
    ).toBe('/workspace?view=sessions');
  });
});
