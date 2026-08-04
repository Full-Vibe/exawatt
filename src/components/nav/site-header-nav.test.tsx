import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteHeaderNav } from './site-header-nav';

const { commitPreferences } = vi.hoisted(() => ({
  commitPreferences: vi.fn(async () => undefined),
}));

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({
    preferences: {
      schemaVersion: 1,
      selection: {
        mode: 'auto',
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
      autoPair: {
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
      accentSource: 'theme',
      interfaceFont: 'theme',
      interfaceScale: 100,
      contrast: 'system',
      transparency: 'system',
    },
    ready: true,
    commitPreferences,
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
}));

vi.mock('@/app/actions/projects', () => ({
  signOut: vi.fn(),
}));

afterEach(cleanup);

describe('SiteHeaderNav leaderboard link', () => {
  it('shows Leaderboard beside Architecture', () => {
    render(<SiteHeaderNav isAuthenticated userEmail="jake@jakeschwartz.com" />);

    expect(screen.getByRole('link', { name: /architecture/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /leaderboard/i })).toHaveAttribute(
      'href',
      '/leaderboard'
    );
    expect(screen.queryByRole('link', { name: /components/i })).toBeNull();
  });

  it('shows the public Leaderboard link to every operator', () => {
    render(<SiteHeaderNav isAuthenticated={false} />);

    expect(screen.getByRole('link', { name: /leaderboard/i })).toHaveAttribute(
      'href',
      '/leaderboard'
    );
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/sign-in'
    );
  });

  it('places the app-global theme switcher in the account menu', async () => {
    render(<SiteHeaderNav isAuthenticated userEmail="jake@jakeschwartz.com" />);

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Account and Workspace menu' }),
      { button: 0, ctrlKey: false }
    );

    const themeMenu = (await screen.findByText('Theme')).closest(
      '[data-account-theme-menu]'
    );
    expect(themeMenu).not.toBeNull();
    expect(themeMenu).toHaveAttribute('data-account-theme-menu');
    expect(themeMenu).toHaveTextContent('Auto');

    await act(async () => {
      (themeMenu as HTMLElement).focus();
      fireEvent.keyDown(themeMenu!, { key: 'ArrowRight' });
    });
    const air = await screen.findByRole('menuitemradio', { name: 'Air' });
    expect(air).toBeVisible();
    await act(async () => fireEvent.click(air));
    expect(commitPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { mode: 'manual', themeId: 'exawatt-air-light' },
      })
    );
  });
});
