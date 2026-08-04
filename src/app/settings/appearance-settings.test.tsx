import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearancePreferencesV1 } from '@/lib/appearance/types';
import {
  selectAutoThemes,
  selectManualTheme,
} from '@/lib/appearance/selection';
import { AppearanceSettings } from './appearance-settings';

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

  it('does not expose the retired manual accessibility overrides', () => {
    render(<AppearanceSettings />);

    expect(
      screen.queryByRole('switch', { name: 'Enhanced contrast' })
    ).toBeNull();
    expect(
      screen.queryByRole('switch', { name: 'Reduce transparency' })
    ).toBeNull();
  });

  it('coalesces rapid changes behind the active save without losing fields', async () => {
    let releaseFirst: (() => void) | undefined;
    commitPreferences
      .mockImplementationOnce(
        () =>
          new Promise<undefined>(resolve => {
            releaseFirst = () => resolve(undefined);
          })
      )
      .mockResolvedValueOnce(undefined);
    render(<AppearanceSettings />);

    act(() => {
      screen.getByRole('button', { name: 'Air' }).click();
      screen.getByRole('switch', { name: 'Use system accent' }).click();
    });

    expect(commitPreferences).toHaveBeenCalledOnce();
    await act(async () => releaseFirst?.());
    await waitFor(() => expect(commitPreferences).toHaveBeenCalledTimes(2));

    const calls = commitPreferences.mock.calls as unknown as Array<
      [AppearancePreferencesV1]
    >;
    expect(calls[1][0]).toMatchObject({
      selection: { mode: 'manual', themeId: 'exawatt-air-light' },
      accentSource: 'system',
    });
  });

  it('reports a persistence failure and re-enables controls', async () => {
    commitPreferences.mockRejectedValueOnce(new Error('disk unavailable'));
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('switch', { name: 'Use system accent' }));

    expect(
      await screen.findByText('Appearance could not be saved. Try again.')
    ).toBeInTheDocument();
    expect(commitPreferences).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('switch', { name: 'Use system accent' })
    ).toBeEnabled();
  });
});
