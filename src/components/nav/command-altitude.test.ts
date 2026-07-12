import { describe, expect, it } from 'vitest';
import {
  altitudeShortcutId,
  COMMAND_ALTITUDE_HREFS,
  isCommandSurface,
  resolveCommandAltitude,
} from './command-altitude';

const query = (value = '') => new URLSearchParams(value);

describe('command altitude navigation', () => {
  it('resolves all three durable command altitudes', () => {
    expect(resolveCommandAltitude('/workspace', query())).toBe('terminal');
    expect(resolveCommandAltitude('/workspace', query('view=sessions'))).toBe(
      'sessions'
    );
    expect(resolveCommandAltitude('/fleet/spatial', query())).toBe('spatial');
  });

  it('ignores unrelated routes and unknown workspace views', () => {
    expect(resolveCommandAltitude('/fleet', query())).toBeNull();
    expect(resolveCommandAltitude('/workspace', query('view=unknown'))).toBe(
      'terminal'
    );
  });

  it('keeps each level directly addressable', () => {
    expect(COMMAND_ALTITUDE_HREFS).toEqual({
      terminal: '/workspace',
      sessions: '/workspace?view=sessions',
      spatial: '/fleet/spatial',
    });
  });

  it('advertises one absolute shortcut for each altitude', () => {
    expect(altitudeShortcutId('terminal')).toBe('command-terminal');
    expect(altitudeShortcutId('sessions')).toBe('command-sessions');
    expect(altitudeShortcutId('spatial')).toBe('command-spatial');
  });

  it('shows the shared control only on command surfaces', () => {
    expect(isCommandSurface('/workspace')).toBe(true);
    expect(isCommandSurface('/fleet/spatial')).toBe(true);
    expect(isCommandSurface('/architecture')).toBe(false);
  });
});
