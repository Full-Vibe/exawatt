import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeaderNav } from './site-header-nav';

/**
 * ENG-030 OS0.1. In the desktop app the account menu renders whether or not
 * anyone is signed in — and signed out it used to hold nothing at all, so the
 * one place an operator looks for an account was a dead end.
 */

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
    commitPreferences: vi.fn(async () => undefined),
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
}));

vi.mock('@/app/actions/projects', () => ({
  signOut: vi.fn(),
}));

// the desktop-only chrome the header mounts beside the account menu; none of
// it is under test here
vi.mock('./command-altitude-nav', () => ({
  ALTITUDE_ICONS: { terminal: () => null },
  CommandAltitudeNav: () => null,
}));

vi.mock('./command-navigation-provider', () => ({
  useCommandNavigation: () => ({
    canNavigateBack: false,
    canNavigateForward: false,
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
  }),
}));

vi.mock('@/components/consumption/meter/ambient-meter-chrome', () => ({
  AMBIENT_CHROME_METER_ENABLED: false,
  AmbientChromeMeter: () => null,
}));

function openAccountMenu() {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'Account and Workspace menu' }),
    { button: 0, ctrlKey: false }
  );
}

beforeEach(() => {
  (window as { electron?: unknown }).electron = { isElectron: true };
});

afterEach(() => {
  cleanup();
  delete (window as { electron?: unknown }).electron;
});

describe('SiteHeaderNav account menu', () => {
  it('offers Sign in when signed out in the desktop app', async () => {
    render(<SiteHeaderNav isAuthenticated={false} />);

    openAccountMenu();

    const signIn = await screen.findByRole('menuitem', { name: 'Sign in' });
    expect(signIn).toBeVisible();
    expect(signIn.closest('a')).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
  });

  it('offers Sign out, and only Sign out, once signed in', async () => {
    render(<SiteHeaderNav isAuthenticated userEmail="person@example.com" />);

    openAccountMenu();

    expect(
      await screen.findByRole('menuitem', { name: 'Sign out' })
    ).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Sign in' })).toBeNull();
  });

  it('keeps the desktop menu useful while naming absent accounts', async () => {
    render(<SiteHeaderNav isAuthenticated={false} accountAvailable={false} />);

    openAccountMenu();

    expect(
      await screen.findByRole('menuitem', {
        name: 'Accounts unavailable in this build',
      })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('menuitem', { name: 'Sign in' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });
});
