import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_PREFERENCES,
} from '@/lib/appearance/resolve-appearance';
import { selectManualTheme } from '@/lib/appearance/selection';
import { APPEARANCE_MIRROR_STORAGE_KEY } from '@/lib/appearance/preference-source';
import {
  AppearanceProvider,
  EXTERNAL_APPEARANCE_SETTLE_MS,
  useAppearance,
} from './appearance-provider';

const { appliedThemes } = vi.hoisted(() => ({
  appliedThemes: vi.fn(),
}));

vi.mock('@/lib/appearance/dom-adapter', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/appearance/dom-adapter')>();
  return {
    ...actual,
    applyResolvedAppearance: (
      root: HTMLElement,
      resolved: Parameters<typeof actual.applyResolvedAppearance>[1]
    ) => {
      appliedThemes(resolved.themeId);
      return actual.applyResolvedAppearance(root, resolved);
    },
  };
});

const classic = structuredClone(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES);

beforeEach(() => {
  appliedThemes.mockClear();
  window.localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete window.electron;
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
});

function wrapper({ children }: { children: ReactNode }) {
  return <AppearanceProvider>{children}</AppearanceProvider>;
}

describe('AppearanceProvider', () => {
  it('hydrates from Electron authority and publishes Classic root state', async () => {
    const setAppearance = vi.fn().mockResolvedValue({ appearance: classic });
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: vi.fn().mockResolvedValue({ appearance: classic }),
        setAppearance,
        onChanged: vi.fn(() => vi.fn()),
      },
      app: {
        appearance: vi.fn().mockResolvedValue({
          dark: true,
          highContrast: false,
          invertedColors: false,
          systemAccent: '#FF00FF',
          safeTheme: false,
        }),
        onAppearanceChanged: vi.fn(() => vi.fn()),
      },
    } as unknown as NonNullable<Window['electron']>;

    const view = renderHook(() => useAppearance(), { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.resolved.themeId).toBe('exawatt-classic-dark');
    expect(document.documentElement.dataset.exaTheme).toBe(
      'exawatt-classic-dark'
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(APPEARANCE_MIRROR_STORAGE_KEY) ?? 'null'
      )
    ).toEqual(classic);

    act(() => view.result.current.previewTheme('exawatt-classic-dark'));
    expect(setAppearance).not.toHaveBeenCalled();
    act(() => view.result.current.cancelPreview());

    await act(() => view.result.current.commitPreferences(classic));
    expect(setAppearance).toHaveBeenCalledWith(classic);
  });

  it('commits the promoted Air theme at the production provider boundary', async () => {
    const view = renderHook(() => useAppearance(), { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(() =>
      view.result.current.commitPreferences(
        selectManualTheme(classic, 'exawatt-air-light')
      )
    );
    expect(view.result.current.resolved.themeId).toBe('exawatt-air-light');
  });

  it('keeps corrupt browser state on Classic through hydration', async () => {
    window.localStorage.setItem(APPEARANCE_MIRROR_STORAGE_KEY, '{');

    const view = renderHook(() => useAppearance(), { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));

    expect(view.result.current.preferences).toEqual(classic);
    expect(view.result.current.resolved.themeId).toBe('exawatt-classic-dark');
  });

  it('keeps a safe Electron launch on Classic while stored Auto hydrates', async () => {
    const automatic = structuredClone(DEFAULT_APPEARANCE_PREFERENCES);
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify(automatic)
    );
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: vi.fn().mockResolvedValue({ appearance: automatic }),
        setAppearance: vi.fn(),
        onChanged: vi.fn(() => vi.fn()),
      },
      app: {
        bootstrapAppearance: {
          preferences: classic,
          dark: true,
          safeTheme: true,
        },
        appearance: vi.fn(() => new Promise(() => undefined)),
        onAppearanceChanged: vi.fn(() => vi.fn()),
      },
    } as unknown as NonNullable<Window['electron']>;

    const view = renderHook(() => useAppearance(), { wrapper });
    expect(view.result.current.resolved.themeId).toBe('exawatt-classic-dark');
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.preferences).toEqual(automatic);
    expect(view.result.current.resolved.themeId).toBe('exawatt-classic-dark');
  });

  it('hydrates Auto from Electron dark authority before native async state resolves', async () => {
    const automatic = structuredClone(DEFAULT_APPEARANCE_PREFERENCES);
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: vi.fn().mockResolvedValue({ appearance: automatic }),
        setAppearance: vi.fn(),
        onChanged: vi.fn(() => vi.fn()),
      },
      app: {
        bootstrapAppearance: {
          preferences: automatic,
          dark: true,
          safeTheme: false,
        },
        appearance: vi.fn(() => new Promise(() => undefined)),
        onAppearanceChanged: vi.fn(() => vi.fn()),
      },
    } as unknown as NonNullable<Window['electron']>;

    const view = renderHook(() => useAppearance(), { wrapper });

    expect(view.result.current.resolved.themeId).toBe('exawatt-night-dark');
    expect(appliedThemes).not.toHaveBeenCalledWith('exawatt-air-light');
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.resolved.themeId).toBe('exawatt-night-dark');
    expect(appliedThemes).not.toHaveBeenCalledWith('exawatt-air-light');
    expect(window.matchMedia).not.toHaveBeenCalledWith(
      '(prefers-color-scheme: dark)'
    );
  });

  it('publishes only the final snapshot from a burst of external renderer settings', async () => {
    let onSettingsChanged:
      | ((settings: { appearance: typeof classic }) => void)
      | undefined;
    const air = selectManualTheme(classic, 'exawatt-air-light');
    const night = selectManualTheme(classic, 'exawatt-night-dark');
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: vi.fn().mockResolvedValue({ appearance: classic }),
        setAppearance: vi.fn(),
        onChanged: vi.fn(handler => {
          onSettingsChanged = handler;
          return vi.fn();
        }),
      },
      app: {
        bootstrapAppearance: {
          preferences: classic,
          dark: true,
          safeTheme: false,
        },
        appearance: vi.fn(() => new Promise(() => undefined)),
        onAppearanceChanged: vi.fn(() => vi.fn()),
      },
    } as unknown as NonNullable<Window['electron']>;

    const view = renderHook(() => useAppearance(), { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(onSettingsChanged).toBeTypeOf('function');
    appliedThemes.mockClear();
    vi.useFakeTimers();

    act(() => {
      onSettingsChanged?.({ appearance: air });
      onSettingsChanged?.({ appearance: classic });
      onSettingsChanged?.({ appearance: night });
    });
    expect(view.result.current.resolved.themeId).toBe('exawatt-classic-dark');
    expect(appliedThemes).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(EXTERNAL_APPEARANCE_SETTLE_MS - 1));
    expect(view.result.current.resolved.themeId).toBe('exawatt-classic-dark');

    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.resolved.themeId).toBe('exawatt-night-dark');
    expect(appliedThemes).toHaveBeenCalledTimes(1);
    expect(appliedThemes).toHaveBeenLastCalledWith('exawatt-night-dark');
    expect(
      JSON.parse(
        window.localStorage.getItem(APPEARANCE_MIRROR_STORAGE_KEY) ?? 'null'
      )
    ).toEqual(night);
  });
});
