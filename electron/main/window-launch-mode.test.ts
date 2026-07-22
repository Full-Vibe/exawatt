import { describe, expect, it } from 'vitest';
import { resolveWindowLaunchMode } from './window-launch-mode';

describe('window launch mode', () => {
  it('keeps production launches foreground even if an override leaks in', () => {
    expect(
      resolveWindowLaunchMode({
        isDevelopment: false,
        isTest: false,
        override: 'hidden',
      })
    ).toBe('foreground');
  });

  it('shows development windows without activating by default', () => {
    expect(
      resolveWindowLaunchMode({
        isDevelopment: true,
        isTest: false,
      })
    ).toBe('inactive');
  });

  it('keeps automated test windows hidden by default', () => {
    expect(
      resolveWindowLaunchMode({
        isDevelopment: false,
        isTest: true,
      })
    ).toBe('hidden');
  });

  it.each(['foreground', 'inactive', 'hidden'] as const)(
    'allows an explicit %s mode for development and test launches',
    override => {
      expect(
        resolveWindowLaunchMode({
          isDevelopment: true,
          isTest: false,
          override,
        })
      ).toBe(override);
      expect(
        resolveWindowLaunchMode({
          isDevelopment: false,
          isTest: true,
          override,
        })
      ).toBe(override);
    }
  );

  it('fails closed to the non-activating default for an invalid override', () => {
    expect(
      resolveWindowLaunchMode({
        isDevelopment: true,
        isTest: false,
        override: 'surprise',
      })
    ).toBe('inactive');
    expect(
      resolveWindowLaunchMode({
        isDevelopment: false,
        isTest: true,
        override: 'surprise',
      })
    ).toBe('hidden');
  });
});
