import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DEFAULT_APPEARANCE_PREFERENCES } from '@/lib/appearance';
import { AppearanceProvider, useAppearance } from './appearance-provider';

const classic = structuredClone(DEFAULT_APPEARANCE_PREFERENCES);

beforeEach(() => {
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

    act(() => view.result.current.previewTheme('exawatt-classic-dark'));
    expect(setAppearance).not.toHaveBeenCalled();
    act(() => view.result.current.cancelPreview());

    await act(() => view.result.current.commitPreferences(classic));
    expect(setAppearance).toHaveBeenCalledWith(classic);
  });

  it('rejects gallery-only choices at the production provider boundary', async () => {
    const view = renderHook(() => useAppearance(), { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await expect(
      view.result.current.commitPreferences({
        ...classic,
        selection: { mode: 'manual', themeId: 'exawatt-air-light' },
      })
    ).rejects.toThrow('unavailable appearance');
  });
});
