import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicLeaderboardRow } from '@/lib/operator-stats/public';

/**
 * BUG-048 / incident `0017`: the board publishes three different facts, and it
 * used to publish two of them as the same sentence. "The board is open" is a
 * claim about the RECORDS, so a build that cannot read any records at all must
 * never make it — that is what invited visitors to be operator #1 for eighteen
 * hours while the board's only operator sat at rank 1.
 */

const { configured, readLeaderboard } = vi.hoisted(() => ({
  configured: { current: true },
  readLeaderboard: vi.fn(),
}));

vi.mock('@/lib/operator-stats/public', () => ({
  publicArenaConfigured: () => configured.current,
  readLeaderboard,
}));

vi.mock('@/components/operator-stats/publish-panel', () => ({
  PublishPanel: () => <aside data-testid="publish-panel" />,
}));

import LeaderboardPage from './page';

const ROW: PublicLeaderboardRow = {
  rank: 1,
  handle: 'jakesc',
  display_name: 'Jake Schwartz',
  avatar_url: null,
  value: 830_753_237,
  agent_ms: 830_753_237,
  longest_hands_off_ms: 20_044_704,
  peak_fleet: 21,
  normalized_tokens: 4_101_315_483,
};

async function renderBoard() {
  render(await LeaderboardPage({ searchParams: Promise.resolve({}) }));
}

function boardState() {
  return document.querySelector('[data-board-state]')?.getAttribute(
    'data-board-state'
  );
}

describe('the leaderboard names the state it is in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configured.current = true;
    readLeaderboard.mockResolvedValue([]);
  });

  it('says the build carries no rankings, and never reads', async () => {
    configured.current = false;

    await renderBoard();

    expect(boardState()).toBe('unconfigured');
    expect(readLeaderboard).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Rankings are not configured in this build/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/The board is open/)).not.toBeInTheDocument();
  });

  it('invites the first operator only when the board is truly empty', async () => {
    await renderBoard();

    expect(boardState()).toBe('empty');
    expect(screen.getByText(/The board is open/)).toBeInTheDocument();
  });

  it('separates a failed read from an absent capability', async () => {
    readLeaderboard.mockRejectedValue(new Error('rpc down'));

    await renderBoard();

    expect(boardState()).toBe('unavailable');
    expect(
      screen.getByText(/Rankings are temporarily unavailable/)
    ).toBeInTheDocument();
  });

  it('ranks the operators it can read', async () => {
    readLeaderboard.mockResolvedValue([ROW]);

    await renderBoard();

    expect(boardState()).toBe('ranked');
    expect(screen.getByText('@jakesc')).toBeInTheDocument();
  });
});
