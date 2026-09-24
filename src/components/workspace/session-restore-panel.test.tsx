import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_LIFECYCLE_VERB_LABEL,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';

import { SessionRestorePanel } from './session-restore-panel';
import type { SessionTab } from './use-workspace-state';
import { installBridgeDouble } from '@/test-support/desktop-bridge-double';

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
    installBridgeDouble({
      platform: 'darwin',
      pty: { listResumeCandidates },
    });
  });

  it('prints the shared lifecycle word and line, and the individual resume verb', () => {
    const tab = stoppedTab();
    const expected = sessionLifecyclePresentation(tab);
    const onResumeTab = vi.fn(async () => true);
    render(<SessionRestorePanel tab={tab} onResumeTab={onResumeTab} />);

    expect(screen.getByRole('status')).toHaveTextContent(expected.word);
    expect(
      document.querySelector('[data-session-lifecycle-line]')
    ).toHaveTextContent(expected.line ?? '');
    fireEvent.click(
      screen.getByRole('button', {
        name: SESSION_LIFECYCLE_VERB_LABEL.resume,
      })
    );
    expect(onResumeTab).toHaveBeenCalledWith('tab-one');
    expect(screen.queryByText(/Resume All/i)).toBeNull();
  });

  it('offers reconnection when the conversation identity was never recorded', async () => {
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
    const tab = stoppedTab(null);
    render(<SessionRestorePanel tab={tab} onResumeTab={onResumeTab} />);

    expect(sessionLifecyclePresentation(tab).verb).toBe('reconnect');
    expect(
      document.querySelector('[data-session-restore][data-identity-missing]')
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: SESSION_LIFECYCLE_VERB_LABEL.resume })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: SESSION_LIFECYCLE_VERB_LABEL.reconnect,
      })
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
