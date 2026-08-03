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

describe('SiteHeaderNav leaderboard link', () => {
  it('shows Leaderboard beside Architecture', () => {
    render(<SiteHeaderNav isAuthenticated userEmail="jake@jakeschwartz.com" />);

    expect(screen.getByRole('link', { name: /architecture/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /leaderboard/i })).toHaveAttribute(
      'href',
      '/agentmaxxing'
    );
    expect(screen.queryByRole('link', { name: /components/i })).toBeNull();
  });

  it('shows the public Leaderboard link to every operator', () => {
    render(<SiteHeaderNav isAuthenticated={false} />);

    expect(screen.getByRole('link', { name: /leaderboard/i })).toHaveAttribute(
      'href',
      '/agentmaxxing'
    );
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/sign-in'
    );
  });
});
