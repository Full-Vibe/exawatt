import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FOCUS_SESSIONS_EVENT } from '@/components/nav/command-altitude-events';
import { ExposeOverlay } from './expose-overlay';
import type { Project } from './use-workspace-state';

const projects: Project[] = [
  {
    dir: '/one',
    name: 'One',
    color: '#19E6FF',
    activeTabId: 'tab-a',
    tabs: [
      {
        id: 'tab-a',
        durableSessionId: 'durable-a',
        harness: 'shell',
        title: 'Alpha',
        cwd: '/one',
        sessionId: 'session-a',
        harnessSessionId: null,
        resumeState: 'live',
        lifecycle: 'running',
        exitCode: null,
        roadmapItemId: null,
      },
      {
        id: 'tab-b',
        durableSessionId: 'durable-b',
        harness: 'codex',
        title: 'Beta',
        cwd: '/one',
        sessionId: 'session-b',
        harnessSessionId: 'provider-b',
        resumeState: 'live',
        lifecycle: 'running',
        exitCode: null,
        roadmapItemId: null,
      },
    ],
  },
];

describe('Sessions overview', () => {
  it('starts on the originating Session and moves focus with arrows', async () => {
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-b"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const alpha = screen.getByRole('button', { name: 'Alpha, One' });
    const beta = screen.getByRole('button', { name: 'Beta, One' });
    await waitFor(() => expect(beta).toHaveFocus());
    fireEvent.keyDown(beta, { key: 'ArrowLeft' });
    await waitFor(() => expect(alpha).toHaveFocus());
    expect(alpha).toHaveAttribute('data-selected', 'true');
  });

  it('opens with Enter and returns with Escape without changing Session', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-a"
        onPick={onPick}
        onClose={onClose}
      />
    );

    const alpha = screen.getByRole('button', { name: 'Alpha, One' });
    await waitFor(() => expect(alpha).toHaveFocus());
    fireEvent.keyDown(alpha, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.keyDown(alpha, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('/one', 'tab-a');
  });

  it('is a non-modal region and active-altitude focus returns to selection', async () => {
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-a"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: 'Session overview' });
    expect(overview).not.toHaveAttribute('aria-modal');
    const alpha = screen.getByRole('button', { name: 'Alpha, One' });
    await waitFor(() => expect(alpha).toHaveFocus());
    alpha.blur();
    window.dispatchEvent(new CustomEvent(FOCUS_SESSIONS_EVENT));
    expect(alpha).toHaveFocus();
  });
});
