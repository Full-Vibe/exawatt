// Named as a DOM suite because first paint mutates document and localStorage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_BOOTSTRAP_SCRIPT } from './bootstrap-script';
import { APPEARANCE_MIRROR_STORAGE_KEY } from './preference-source';
import {
  CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_PREFERENCES,
} from './resolve-appearance';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-exa-theme');
  document.documentElement.removeAttribute('data-exa-appearance');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  delete window.electron;
  window.localStorage.clear();
});

function bootstrap() {
  Function(APPEARANCE_BOOTSTRAP_SCRIPT)();
}

describe('appearance first-paint bootstrap', () => {
  it('applies the production Air default before hydration in light mode', () => {
    bootstrap();
    expect(document.documentElement.dataset.exaTheme).toBe('exawatt-air-light');
    expect(document.documentElement.dataset.exaAppearance).toBe('light');
    expect(document.documentElement.dataset.exaTypography).toBe('air');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('follows the OS to Night when no preference exists', () => {
    vi.mocked(window.matchMedia).mockImplementation(
      query =>
        ({
          matches: query === '(prefers-color-scheme: dark)',
        }) as MediaQueryList
    );
    bootstrap();
    expect(document.documentElement.dataset.exaTheme).toBe(
      'exawatt-night-dark'
    );
    expect(document.documentElement.dataset.exaAppearance).toBe('dark');
  });

  it('preserves an explicit Classic preference', () => {
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES)
    );
    bootstrap();
    expect(document.documentElement.dataset.exaTheme).toBe(
      'exawatt-classic-dark'
    );
    expect(
      window.localStorage.getItem(APPEARANCE_MIRROR_STORAGE_KEY)
    ).not.toBeNull();
  });

  it('ignores retired manual accessibility overrides before hydration', () => {
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        contrast: 'enhanced',
        transparency: 'reduced',
      })
    );

    bootstrap();

    expect(document.documentElement.dataset.exaContrast).toBe('standard');
    expect(document.documentElement.dataset.exaTransparency).toBe('standard');
  });

  it('discards corrupt state and paints the Classic recovery theme', () => {
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        selection: { mode: 'manual', themeId: 'exawatt-unknown-dark' },
      })
    );
    bootstrap();
    expect(document.documentElement.dataset.exaTheme).toBe(
      'exawatt-classic-dark'
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(APPEARANCE_MIRROR_STORAGE_KEY) ?? 'null'
      )
    ).toEqual(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES);
  });

  it('uses Electron authority instead of a still-valid stale mirror', () => {
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES)
    );
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      app: {
        bootstrapAppearance: {
          preferences: DEFAULT_APPEARANCE_PREFERENCES,
          dark: false,
          safeTheme: false,
        },
      },
    } as unknown as NonNullable<Window['electron']>;

    bootstrap();

    expect(document.documentElement.dataset.exaTheme).toBe('exawatt-air-light');
    expect(
      JSON.parse(
        window.localStorage.getItem(APPEARANCE_MIRROR_STORAGE_KEY) ?? 'null'
      )
    ).toEqual(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES);
  });

  it('uses Electron dark authority when renderer media state is stale', () => {
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      app: {
        bootstrapAppearance: {
          preferences: DEFAULT_APPEARANCE_PREFERENCES,
          dark: true,
          safeTheme: false,
        },
      },
    } as unknown as NonNullable<Window['electron']>;

    bootstrap();

    expect(window.matchMedia).not.toHaveBeenCalledWith(
      '(prefers-color-scheme: dark)'
    );
    expect(document.documentElement.dataset.exaTheme).toBe(
      'exawatt-night-dark'
    );
  });

  it('keeps safe-theme Classic before hydration without rewriting the mirror', () => {
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify(DEFAULT_APPEARANCE_PREFERENCES)
    );
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      app: {
        bootstrapAppearance: {
          preferences: CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
          dark: true,
          safeTheme: true,
        },
      },
    } as unknown as NonNullable<Window['electron']>;

    bootstrap();

    expect(document.documentElement.dataset.exaTheme).toBe(
      'exawatt-classic-dark'
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(APPEARANCE_MIRROR_STORAGE_KEY) ?? 'null'
      )
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });
});
