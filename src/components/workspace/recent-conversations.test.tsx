import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';

const mocks = vi.hoisted(() => ({
  createOptionalClient: vi.fn(),
  getSession: vi.fn(),
  distribution: { current: null as DistributionContractV2 | null },
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => mocks.distribution.current,
}));

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient: mocks.createOptionalClient,
}));

import { RecentConversations } from './recent-conversations';

const LOCAL_CONVERSATION = {
  id: 'provider-session-id',
  harness: 'codex' as const,
  cwd: '/project',
  startedAt: 1,
  updatedAt: 2,
  title: 'provider-session-id',
  description: null,
  titleSource: 'fallback' as const,
  needsSummary: true,
  providerSessionId: 'provider-session-id',
  continuation: { kind: 'provider' as const },
};

const OFFICIAL_SUMMARY_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  account: {
    supabaseUrl: 'https://account.example.test',
    supabaseAnonKey: 'public-test-key',
    recoveryOrigin: 'https://app.example.test',
  },
  enrichment: {
    ...COMMUNITY_DISTRIBUTION.enrichment,
    conversationSummaries: {
      url: 'https://services.example.test/v1/conversation-summaries',
      protocolVersion: 1,
    },
  },
} satisfies DistributionContractV2;

describe('Recent Conversations distribution boundary', () => {
  beforeEach(() => {
    mocks.distribution.current = COMMUNITY_DISTRIBUTION;
    mocks.getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'official-token' } },
    });
    mocks.createOptionalClient.mockReset().mockReturnValue({
      auth: { getSession: mocks.getSession },
    });
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: { get: vi.fn().mockResolvedValue({}) },
      pty: {
        listRecentConversations: vi
          .fn()
          .mockResolvedValue([LOCAL_CONVERSATION]),
        enrichRecentConversations: vi.fn().mockResolvedValue([
          {
            ...LOCAL_CONVERSATION,
            title: 'Configured service summary',
            titleSource: 'generated',
            needsSummary: false,
          },
        ]),
      },
    } as unknown as NonNullable<Window['electron']>;
  });

  it('renders the local catalog without auth or enrichment in community builds', async () => {
    render(
      <RecentConversations
        projectDir="/project"
        onOpen={vi.fn(async () => true)}
        onReturnToComposer={vi.fn()}
      />
    );

    expect(
      await screen.findByRole('button', {
        name: 'Resume provider-session-id in Codex',
      })
    ).toBeVisible();
    expect(mocks.createOptionalClient).not.toHaveBeenCalled();
    expect(window.electron!.settings!.get).not.toHaveBeenCalled();
    expect(
      window.electron!.pty!.enrichRecentConversations
    ).not.toHaveBeenCalled();
  });

  it('preserves authenticated enrichment for configured distributors', async () => {
    mocks.distribution.current = OFFICIAL_SUMMARY_DISTRIBUTION;
    render(
      <RecentConversations
        projectDir="/project"
        onOpen={vi.fn(async () => true)}
        onReturnToComposer={vi.fn()}
      />
    );

    expect(await screen.findByText('Configured service summary')).toBeVisible();
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(1));
    expect(
      window.electron!.pty!.enrichRecentConversations
    ).toHaveBeenCalledWith('/project', 'official-token');
  });
});
