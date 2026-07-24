import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteHeaderNav } from './site-header-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
}));

vi.mock('@/app/actions/projects', () => ({
  signOut: vi.fn(),
}));

afterEach(cleanup);

describe('SiteHeaderNav component-library link', () => {
  it('shows Components beside Architecture for the temporary admin', () => {
    render(<SiteHeaderNav isAuthenticated userEmail="jake@jakeschwartz.com" />);

    expect(screen.getByRole('link', { name: /architecture/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /components/i })).toHaveAttribute(
      'href',
      '/hud-gallery'
    );
  });

  it('does not expose the Components link to other users', () => {
    render(<SiteHeaderNav isAuthenticated userEmail="someone@example.com" />);

    expect(
      screen.queryByRole('link', { name: /components/i })
    ).not.toBeInTheDocument();
  });
});
