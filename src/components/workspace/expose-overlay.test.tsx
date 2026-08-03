import type { ReactElement, ReactNode } from 'react';
import {
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FOCUS_SESSIONS_EVENT } from '@/components/nav/command-altitude-events';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ExposeOverlay } from './expose-overlay';
import type { Project } from './use-workspace-state';

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TooltipProvider>{children}</TooltipProvider>
    ),
  });
}

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
        titleKind: 'operator',
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
        titleKind: 'operator',
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
        titleKind: 'operator',
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
  it('projects a goal visual by durable Session identity without changing the tile contract', () => {
    const image = 'data:image/webp;base64,UklGRg==';
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        goalVisuals={{
          'durable-b': {
            identityKey: 'workspace:one:goal:investor-demo',
            revision: 2,
            state: 'ready',
            dataUrl: image,
          },
        }}
        activeTabId="tab-b"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const alpha = screen.getByRole('button', { name: /^Alpha, One/ });
    const beta = screen.getByRole('button', { name: /^Beta, One/ });
    expect(beta.querySelector('[data-goal-visual-backdrop]')).toHaveAttribute(
      'data-goal-visual-identity',
      'workspace:one:goal:investor-demo'
    );
    expect(beta.querySelector('[data-goal-visual-image]')).toHaveAttribute(
      'src',
      image
    );
    expect(alpha.querySelector('[data-goal-visual-backdrop]')).toHaveAttribute(
      'data-goal-visual-identity',
      'durable-a'
    );
    expect(alpha.querySelector('[data-goal-visual-image]')).toBeNull();
    expect(beta).toHaveClass('h-[272px]');
  });

  it('shows source-reported Initiative truth without inventing it for other Sessions', () => {
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        initiativeByTab={{
          'tab-b': {
            id: 'init-demo',
            name: 'Investor demo polish',
            goal: 'Make the product legible in one walkthrough.',
          },
        }}
        activeTabId="tab-b"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const beta = screen.getByRole('button', {
      name: /Beta, One.*Initiative Investor demo polish/,
    });
    expect(
      beta.querySelector('[data-session-initiative="init-demo"]')
    ).toHaveTextContent('Investor demo polish');
    const alpha = screen.getByRole('button', { name: /^Alpha, One/ });
    expect(alpha.querySelector('[data-session-initiative]')).toBeNull();
  });

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

  it('details delegated children as a labeled rail, capped with a summary (D3a)', () => {
    render(
      <ExposeOverlay
        projects={projects}
        summaries={{}}
        attention={{}}
        delegation={{
          'session-b': {
            ownTurn: 'available',
            blockedOn: null,
            children: [
              {
                id: 'c1',
                agentType: 'Explore',
                description: 'Map the Sessions tab',
                startedAt: Date.now() - 3 * 60_000,
              },
              {
                id: 'c2',
                agentType: 'general-purpose',
                description: null,
                startedAt: Date.now() - 2 * 60_000,
              },
              {
                id: 'c3',
                agentType: 'Explore',
                description: 'Trace the fleet provider',
                startedAt: Date.now() - 60_000,
              },
              {
                id: 'c4',
                agentType: 'Explore',
                description: 'Collect frame budgets',
                startedAt: Date.now(),
              },
            ],
          },
        }}
        activeTabId="tab-a"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const beta = screen.getByRole('button', { name: /Beta, One/ });
    const rail = beta.querySelector('[data-session-delegation-rail]');
    expect(rail).not.toBeNull();
    // four children, three-row budget: two labeled rows plus the summary
    expect(rail!.querySelectorAll('[data-delegation-child]')).toHaveLength(2);
    expect(rail!.textContent).toContain('Explore');
    expect(rail!.textContent).toContain('Map the Sessions tab');
    expect(rail!.querySelector('[data-delegation-overflow]')?.textContent).toBe(
      'and 2 more working'
    );
    // the rail is detail; the presence dots stay beside the light
    expect(beta.querySelector('[data-delegation="4"]')).not.toBeNull();
    // and the census rides the accessible name — the tile subtree is
    // presentational to assistive tech, so this is where AT hears the team
    expect(beta.getAttribute('aria-label')).toContain(
      '4 delegated agents working'
    );
    // a tile without reported delegation renders no rail at all — absent, not empty
    const alpha = screen.getByRole('button', { name: /Alpha, One/ });
    expect(alpha.querySelector('[data-session-delegation-rail]')).toBeNull();
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
      name: 'Open Empty at the Agent altitude, no Sessions yet',
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

  it('keeps raw terminal output out of the comparison surface', () => {
    const buffer = vi.fn(async () =>
      [
        'Model: Opus 5 · Ctx: 142k · Ctx Used: 14%',
        'bypass permissions on (shift+tab to cycle)',
        'SESSION_PREVIEW_MUST_STAY_IN_TERMINAL',
      ].join('\n')
    );
    (window as unknown as { electron: unknown }).electron = {
      pty: { buffer },
    };
    try {
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
      expect(buffer).not.toHaveBeenCalled();
      expect(
        screen.queryByText('SESSION_PREVIEW_MUST_STAY_IN_TERMINAL')
      ).not.toBeInTheDocument();
      expect(screen.getAllByText('Shell is idle').length).toBeGreaterThan(0);
    } finally {
      delete (window as unknown as { electron?: unknown }).electron;
    }
  });

  it('renders readable sans state copy and a total New agent fallback', () => {
    const untitled: Project = {
      ...projects[0],
      tabs: [
        {
          ...projects[0].tabs[1],
          id: 'tab-untitled',
          durableSessionId: 'durable-untitled',
          title: 'Claude Code',
          titleKind: 'default',
          harness: 'claude',
          sessionId: 'session-untitled',
        },
      ],
      activeTabId: 'tab-untitled',
    };
    render(
      <ExposeOverlay
        projects={[untitled]}
        summaries={{}}
        attention={{}}
        activeTabId="tab-untitled"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const tile = screen.getByRole('button', {
      name: 'New agent, One, new',
    });
    expect(screen.getByText('New agent')).toHaveClass(
      'font-sans',
      'text-base',
      'leading-6'
    );
    expect(screen.getByText('Ready for instructions')).toHaveClass(
      'font-sans',
      'text-reading',
      'leading-6'
    );
    expect(screen.getByText('No plan reported')).toHaveClass(
      'font-sans',
      'text-sm'
    );
    expect(tile).toHaveClass('h-[272px]');
  });

  it('a ⌘T draft tile reads as a draft, never as stopped (D24)', () => {
    const draftProject: Project = {
      dir: '/two',
      name: 'Two',
      color: '#55EAD4',
      activeTabId: 'tab-d',
      tabs: [
        {
          id: 'tab-d',
          durableSessionId: 'durable-d',
          harness: 'claude',
          title: 'New agent',
          titleKind: 'default',
          cwd: '/two',
          sessionId: null,
          harnessSessionId: null,
          resumeState: 'identity-missing',
          lifecycle: 'draft',
          exitCode: null,
          roadmapItemId: null,
          initialTask: null,
        },
      ],
    };
    render(
      <ExposeOverlay
        projects={[draftProject]}
        summaries={{}}
        attention={{}}
        activeTabId="tab-d"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const tile = screen.getByRole('button', { name: 'New agent, Two, draft' });
    expect(tile.querySelector('[data-expose-state="draft"]')).not.toBeNull();
  });
});
