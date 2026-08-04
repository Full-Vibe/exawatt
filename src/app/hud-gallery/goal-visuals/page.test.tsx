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

describe('Agent tile visual language bench', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds full-card geometry constant across three visual languages', async () => {
    render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    expect(
      screen.getByRole('heading', { name: 'Agent tile visual languages' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Material macro' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Aerial structure' })
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Graphic form' })).toBeVisible();
    expect(
      document.querySelectorAll('[data-goal-visual-language]')
    ).toHaveLength(9);
    expect(
      await screen.findByText(/Sign in for generated studies/)
    ).toBeVisible();
  });

  it('loads nine fixed studies through the authenticated hosted boundary', async () => {
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

    expect(await screen.findByText(/9 studies ready/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/goal-visuals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bench-token',
        }),
      })
    );
    expect(container.querySelectorAll('img')).toHaveLength(9);
  });
});
