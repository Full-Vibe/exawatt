import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearancePreferencesV1 } from '@/lib/appearance/types';
import {
  AppearanceSettings,
  selectAutoThemes,
  selectManualTheme,
} from './appearance-settings';

const { commitPreferences, appearance } = vi.hoisted(() => {
  const preferences: AppearancePreferencesV1 = {
    schemaVersion: 1,
    selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  };
  return {
    commitPreferences: vi.fn(async () => undefined),
    appearance: {
      preferences,
      resolved: { themeId: 'exawatt-classic-dark' },
      ready: true,
    },
  };
});

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({
    ...appearance,
    commitPreferences,
  }),
}));

describe('AppearanceSettings', () => {
  beforeEach(() => {
    commitPreferences.mockClear();
    commitPreferences.mockResolvedValue(undefined);
    appearance.preferences = {
      schemaVersion: 1,
      selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
      accentSource: 'theme',
      interfaceFont: 'theme',
      interfaceScale: 100,
      contrast: 'system',
      transparency: 'system',
    };
    appearance.resolved = { themeId: 'exawatt-classic-dark' };
    appearance.ready = true;
  });

  afterEach(cleanup);

  it('preserves the remembered Auto pair across Manual selection', () => {
    const auto = selectAutoThemes(appearance.preferences, {
      lightThemeId: 'exawatt-air-light',
      darkThemeId: 'exawatt-night-dark',
    });
    const manual = selectManualTheme(
      auto,
      'exawatt-classic-dark'
    ) as AppearancePreferencesV1 & {
      autoPair: { lightThemeId: string; darkThemeId: string };
    };

    expect(manual.selection).toEqual({
      mode: 'manual',
      themeId: 'exawatt-classic-dark',
    });
    expect(manual.autoPair).toEqual({
      lightThemeId: 'exawatt-air-light',
      darkThemeId: 'exawatt-night-dark',
    });
    expect(selectAutoThemes(manual).selection).toEqual({
      mode: 'auto',
      lightThemeId: 'exawatt-air-light',
      darkThemeId: 'exawatt-night-dark',
    });
  });

  it('commits all three built-in presets as complete Manual preferences', async () => {
    render(<AppearanceSettings />);

    for (const [index, label] of ['Classic Dark', 'Air', 'Night'].entries()) {
      const button = screen.getByRole('button', { name: label });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() =>
        expect(commitPreferences).toHaveBeenCalledTimes(index + 1)
      );
    }

    const calls = commitPreferences.mock.calls as unknown as Array<
      [AppearancePreferencesV1]
    >;
    expect(calls.map(([next]) => next.selection)).toEqual([
      { mode: 'manual', themeId: 'exawatt-classic-dark' },
      { mode: 'manual', themeId: 'exawatt-air-light' },
      { mode: 'manual', themeId: 'exawatt-night-dark' },
    ]);
  });

  it('restores Auto and keeps interface preferences app-global', async () => {
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    await waitFor(() => expect(commitPreferences).toHaveBeenCalledOnce());
    const calls = commitPreferences.mock.calls as unknown as Array<
      [AppearancePreferencesV1]
    >;
    expect(calls[0][0]).toMatchObject({
      selection: {
        mode: 'auto',
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
      interfaceScale: 100,
      interfaceFont: 'theme',
    });
  });

  it('serializes saves and reports a persistence failure', async () => {
    commitPreferences.mockRejectedValueOnce(new Error('disk unavailable'));
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('switch', { name: 'Use system accent' }));

    expect(
      await screen.findByText('Appearance could not be saved. Try again.')
    ).toBeInTheDocument();
    expect(commitPreferences).toHaveBeenCalledOnce();
  });
});
