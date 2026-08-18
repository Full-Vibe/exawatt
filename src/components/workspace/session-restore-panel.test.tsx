import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionRestorePanel } from './session-restore-panel';
import type { SessionTab } from './use-workspace-state';

const stoppedTab = (
  harnessSessionId: string | null = 'provider-one'
): SessionTab => ({
  id: 'tab-one',
  kind: 'session' as const,
  durableSessionId: 'session-one',
  harness: 'codex',
  title: 'Voting shipped',
  titleKind: 'operator',
  cwd: '/project',
  sessionId: null,
  harnessSessionId,
  resumeState: harnessSessionId ? 'ended-resumable' : 'identity-missing',
  lifecycle: 'stopped-clean',
  exitCode: 0,
  roadmapItemId: null,
  initialTask: 'Build voting',
});

describe('SessionRestorePanel', () => {
  const listResumeCandidates = vi.fn();

  beforeEach(() => {
    listResumeCandidates.mockReset().mockResolvedValue([]);
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      pty: { listResumeCandidates },
    } as unknown as NonNullable<Window['electron']>;
  });

  it('makes stopped history and the individual resume scope explicit', () => {
    const onResumeTab = vi.fn(async () => true);
    render(
      <SessionRestorePanel tab={stoppedTab()} onResumeTab={onResumeTab} />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Stopped');
    expect(screen.getByText(/terminal history is read-only/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resume This Agent' }));
    expect(onResumeTab).toHaveBeenCalledWith('tab-one');
    expect(screen.queryByText(/Resume All/i)).toBeNull();
  });

  it('labels unresolved identity honestly and presents richer candidates', async () => {
    listResumeCandidates.mockResolvedValue([
      {
        id: 'provider-one',
        cwd: '/project',
        startedAt: 100,
        updatedAt: 200,
        label: 'Ship subtle voting',
        description: 'Add durable rate limits and verify production.',
      },
    ]);
    const onResumeTab = vi.fn(async () => true);
    render(
      <SessionRestorePanel tab={stoppedTab(null)} onResumeTab={onResumeTab} />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Reconnect needed');
    expect(screen.getByText(/was not recorded/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reconnect Conversation' })
    );
    expect(
      await screen.findByText('Add durable rate limits and verify production.')
    ).toBeVisible();
    fireEvent.click(screen.getByText('Ship subtle voting'));
    await waitFor(() =>
      expect(onResumeTab).toHaveBeenCalledWith('tab-one', 'provider-one')
    );
  });
});
