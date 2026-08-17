import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV1,
} from '@exawatt/core/distribution';

const { getSession, distributionState } = vi.hoisted(() => ({
  getSession: vi.fn(),
  distributionState: { current: null as unknown },
}));

const OFFICIAL_GOAL_VISUAL_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  account: {
    supabaseUrl: 'https://account.example.test',
    supabaseAnonKey: 'public-test-key',
    recoveryOrigin: 'https://app.example.test',
  },
  enrichment: {
    ...COMMUNITY_DISTRIBUTION.enrichment,
    goalVisuals: {
      url: 'https://services.example.test/v1/goal-visuals',
      protocolVersion: 1,
    },
  },
} satisfies DistributionContractV1;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession },
  }),
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
}));

import GoalVisualBenchPage from './page';

describe('Agent tile visual language bench', () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: null } });
    distributionState.current = OFFICIAL_GOAL_VISUAL_DISTRIBUTION;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds full-card geometry constant across seven visual languages', async () => {
    render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    expect(
      screen.getByRole('heading', { name: 'Agent tile visual languages' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Graphic form' })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Graphic metaphor' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Symbolic still life' })
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Noun place' })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Emblematic artifact' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Editorial collage' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Diagrammatic landscape' })
    ).toBeVisible();
    expect(
      document.querySelectorAll('[data-goal-visual-language]')
    ).toHaveLength(21);
    expect(
      screen.getAllByText(
        'Reduce context switching across active agent work'
      )[0]
    ).toHaveStyle({ color: 'var(--exa-hud-text, #dcebff)' });
    expect(
      await screen.findByText(/Sign in for generated studies/)
    ).toBeVisible();
  });

  it('keeps deterministic studies local when the build has no visual service', async () => {
    distributionState.current = COMMUNITY_DISTRIBUTION;
    const fetchMock = vi.fn(async () => {
      throw new Error('community visual study attempted network I/O');
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    expect(await screen.findByText(/Deterministic fallbacks/)).toBeVisible();
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads 21 fixed studies through the authenticated hosted boundary', async () => {
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

    expect(await screen.findByText(/21 studies ready/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(21);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://services.example.test/v1/goal-visuals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bench-token',
        }),
      })
    );
    expect(container.querySelectorAll('img')).toHaveLength(21);
  });

  it('keeps deterministic fallbacks mounted until every returned study is decoded', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'bench-token' } },
    });
    const decodes: Array<() => void> = [];
    class DeferredImage {
      decoding = '';
      src = '';
      decode() {
        return new Promise<void>(resolve => decodes.push(resolve));
      }
    }
    vi.stubGlobal('Image', DeferredImage);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              identityKey: 'b'.repeat(64),
              dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      )
    );

    const { container } = render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    await waitFor(() => expect(decodes).toHaveLength(21));
    expect(screen.getByText(/Loading studies/)).toBeVisible();
    expect(container.querySelectorAll('img')).toHaveLength(0);

    await act(async () => {
      for (const resolve of decodes) resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText(/21 studies ready/)).toBeVisible();
    expect(container.querySelectorAll('img')).toHaveLength(21);
  });

  it('keeps successful studies when one request is unavailable', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'bench-token' } },
    });
    let request = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request += 1;
        if (request === 1) throw new Error('network unavailable');
        return new Response(
          JSON.stringify({
            identityKey: request.toString(16).padStart(64, '0'),
            dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const { container } = render(
      <TooltipProvider>
        <GoalVisualBenchPage />
      </TooltipProvider>
    );

    expect(await screen.findByText(/20 studies ready/)).toBeVisible();
    expect(container.querySelectorAll('img')).toHaveLength(20);
  });
});
