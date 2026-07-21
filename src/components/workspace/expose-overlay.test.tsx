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
        initialTask: null,
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
        initialTask: null,
      },
      {
        id: 'tab-c',
        durableSessionId: 'durable-c',
        harness: 'claude',
        title: 'Gamma',
        cwd: '/one',
        sessionId: null,
        harnessSessionId: 'provider-c',
        resumeState: 'ended-resumable',
        lifecycle: 'stopped-clean',
        exitCode: null,
        roadmapItemId: null,
        initialTask: null,
      },
    ],
  },
];

describe('Sessions overview', () => {
  it('shows EVERY tab — stopped ones dimmed with their state, still openable', () => {
    const onPick = vi.fn();
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-a"
        onPick={onPick}
        onClose={vi.fn()}
      />
    );
    const gamma = screen.getByRole('button', { name: 'Gamma, One, stopped' });
    expect(gamma.querySelector('[data-expose-state="stopped"]')).not.toBeNull();
    fireEvent.click(gamma);
    expect(onPick).toHaveBeenCalledWith('/one', 'tab-c');
  });

  it('shows an empty Project as a selectable group without inventing a Session', async () => {
    const onPickProject = vi.fn();
    const emptyProject: Project = {
      dir: '/empty',
      name: 'Empty',
      color: '#FFD166',
      activeTabId: null,
      tabs: [],
    };
    render(
      <ExposeOverlay
        projects={[...projects, emptyProject]}
        summaries={{}}
        attention={{}}
        activeTabId={null}
        activeProjectDir="/empty"
        onPick={vi.fn()}
        onPickProject={onPickProject}
        onClose={vi.fn()}
      />
    );

    expect(
      screen.getByRole('region', { name: 'Empty, 0 Sessions' })
    ).toBeInTheDocument();
    const empty = screen.getByRole('button', {
      name: 'Open Empty in Terminal, no Sessions yet',
    });
    await waitFor(() => expect(empty).toHaveFocus());
    expect(screen.queryByText('No Projects open')).not.toBeInTheDocument();
    fireEvent.keyDown(empty, { key: 'Enter' });
    expect(onPickProject).toHaveBeenCalledWith('/empty');
  });

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

    const alpha = screen.getByRole('button', { name: /^Alpha, One/ });
    const beta = screen.getByRole('button', { name: /^Beta, One/ });
    await waitFor(() => expect(beta).toHaveFocus());
    fireEvent.keyDown(beta, { key: 'ArrowLeft' });
    await waitFor(() => expect(alpha).toHaveFocus());
    expect(alpha).toHaveAttribute('data-selected', 'true');
  });

  it('follows active-tab changes from the global command-shift bracket ring', async () => {
    const view = render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-a"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const alpha = screen.getByRole('button', { name: /^Alpha, One/ });
    const beta = screen.getByRole('button', { name: /^Beta, One/ });
    await waitFor(() => expect(alpha).toHaveFocus());

    view.rerender(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-b"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => expect(beta).toHaveFocus());
    expect(beta).toHaveAttribute('data-selected', 'true');
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

    const alpha = screen.getByRole('button', { name: /^Alpha, One/ });
    await waitFor(() => expect(alpha).toHaveFocus());
    fireEvent.keyDown(alpha, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.keyDown(alpha, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('/one', 'tab-a');
  });

  it('returns with Escape after focus moves to persistent shell chrome', async () => {
    const onClose = vi.fn();
    const shellControl = document.createElement('button');
    shellControl.textContent = 'Terminal altitude';
    document.body.append(shellControl);
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        activeTabId="tab-a"
        onPick={vi.fn()}
        onClose={onClose}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Alpha, One/ })).toHaveFocus()
    );
    shellControl.focus();
    fireEvent.keyDown(shellControl, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    shellControl.remove();
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
    const alpha = screen.getByRole('button', { name: /^Alpha, One/ });
    await waitFor(() => expect(alpha).toHaveFocus());
    alpha.blur();
    window.dispatchEvent(new CustomEvent(FOCUS_SESSIONS_EVENT));
    expect(alpha).toHaveFocus();
  });

  it('applies scrollback previews even when tiles re-render mid-fetch', async () => {
    // the fetch outliving ONE workspace re-render used to drop the batch
    // forever (sessions were already marked fetched) — tiles froze on "…"
    const resolvers: Array<(v: string) => void> = [];
    const buffer = vi.fn(() => new Promise<string>(res => resolvers.push(res)));
    (window as unknown as { electron: unknown }).electron = {
      pty: { buffer },
    };
    try {
      const props = {
        summaries: {},
        attention: {},
        activeTabId: 'tab-a',
        onPick: vi.fn(),
        onClose: vi.fn(),
      };
      const { rerender } = render(
        <ExposeOverlay projects={projects} {...props} />
      );
      await waitFor(() => expect(buffer).toHaveBeenCalled());
      // new projects identity while the fetch is still in flight
      rerender(
        <ExposeOverlay
          projects={projects.map(p => ({ ...p, tabs: [...p.tabs] }))}
          {...props}
        />
      );
      resolvers.forEach(res => res('$ pnpm test\nall green\n'));
      await waitFor(() =>
        expect(screen.getAllByText(/all green/).length).toBeGreaterThan(0)
      );
    } finally {
      delete (window as unknown as { electron?: unknown }).electron;
    }
  });
});
