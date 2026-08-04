import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession },
  }),
}));

import GoalVisualBenchPage from './page';

describe('Agent tile image geometry bench', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders five comparable treatments and the cross-goal corner set', async () => {
    render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    expect(
      screen.getByRole('heading', { name: 'Agent tile image geometry' })
    ).toBeInTheDocument();
    expect(screen.getByText('Full field')).toBeVisible();
    expect(screen.getByText('Corner field')).toBeVisible();
    expect(screen.getByText('Header banner')).toBeVisible();
    expect(screen.getByText('Right ribbon')).toBeVisible();
    expect(screen.getByText('Horizon band')).toBeVisible();
    expect(
      document.querySelectorAll('[data-goal-visual-geometry]')
    ).toHaveLength(8);
    expect(
      screen.getByRole('heading', { name: 'Corner field across goals' })
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Sign in for generated scenes/)
    ).toBeVisible();
  });

  it('loads the three stable scenes through the authenticated hosted boundary', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'bench-token' } },
    });
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            identityKey: 'a'.repeat(64),
            dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    expect(await screen.findByText(/3 scenes ready/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/goal-visuals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bench-token',
        }),
      })
    );
    expect(container.querySelectorAll('img')).toHaveLength(8);
  });
});
