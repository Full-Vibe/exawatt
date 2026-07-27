import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from './tab-strip';
import type { SessionAttentionSignal } from './status-glyphs';
import type { Project, WorkspaceTab } from './use-workspace-state';
import { EDIT_ACTIVE_PROJECT_EVENT } from './session-jump';

/**
 * Turn-state legibility (ENG-016 D22): the strip must answer "who's
 * spinning, who's finished, who hasn't started" at a glance — and a fresh
 * every tab also retains visible identity, using "New agent" as the final
 * context-label fallback instead of collapsing to icons alone.
 */

function tab(overrides: Partial<WorkspaceTab> & { id: string }): WorkspaceTab {
  return {
    durableSessionId: `durable-${overrides.id}`,
    harness: 'claude',
    title: 'Claude Code',
    titleKind:
      overrides.title && overrides.title !== 'Claude Code'
        ? 'operator'
        : 'default',
    cwd: '/repo',
    sessionId: `session-${overrides.id}`,
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
    ...overrides,
  };
}

function strip({
  tabs,
  summaries = {},
  attention = {},
  activity = {},
  engaged = {},
  onCloseProject,
  exitingProjectDirs,
}: {
  tabs: WorkspaceTab[];
  summaries?: Record<string, string>;
  attention?: Record<string, SessionAttentionSignal>;
  activity?: Record<string, boolean>;
  engaged?: Record<string, boolean>;
  onCloseProject?: (dir: string) => void;
  exitingProjectDirs?: ReadonlySet<string>;
}) {
  const view = (nextTabs: WorkspaceTab[]) => {
    const projects: Project[] = [
      {
        dir: '/repo',
        name: 'repo',
        color: '#19E6FF',
        activeTabId: nextTabs[0]?.id ?? null,
        tabs: nextTabs,
      },
    ];
    return (
      <TooltipProvider>
        <TabStrip
          projects={projects}
          activeDir="/repo"
          pinnedTabId={null}
          summaries={summaries}
          attention={attention}
          activity={activity}
          engaged={engaged}
          onTogglePinTab={vi.fn()}
          onResumeTab={vi.fn()}
          onCloseProject={onCloseProject}
          onSelectProject={vi.fn()}
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onRenameTab={vi.fn()}
          onRenameProject={vi.fn()}
          onSetProjectColor={vi.fn()}
          exitingProjectDirs={exitingProjectDirs}
        />
      </TooltipProvider>
    );
  };
  const result = render(view(tabs));
  return {
    ...result,
    rerenderTabs: (nextTabs: WorkspaceTab[]) => result.rerender(view(nextTabs)),
  };
}

describe('TabStrip turn-state glyphs (D22)', () => {
  it('a streaming session spins', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      activity: { 'session-a': true },
    });
    expect(container.querySelector('[data-status="working"]')).not.toBeNull();
  });

  it('a started-then-quiet agent rests as done', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      engaged: { 'session-a': true },
    });
    expect(container.querySelector('[data-status="done"]')).not.toBeNull();
  });

  it('a goal subtitle alone also reads as started', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      // durable-keyed since D21
      summaries: { 'durable-a': 'Ship code review fixes' },
    });
    expect(container.querySelector('[data-status="done"]')).not.toBeNull();
  });

  it('an agent never given work shows fresh with a visible fallback title', () => {
    const { container } = strip({ tabs: [tab({ id: 'a' })] });
    expect(container.querySelector('[data-status="fresh"]')).not.toBeNull();
    expect(screen.queryByText('Claude Code')).toBeNull();
    expect(screen.getByText('New agent')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'New agent — new' })
    ).not.toBeNull();
  });

  it('a summarized default tab uses context as its visible identity', () => {
    strip({
      tabs: [tab({ id: 'a' })],
      summaries: { 'durable-a': 'Ship code review fixes' },
    });
    expect(
      screen.getByRole('button', {
        name: 'Ship code review fixes — result ready',
      })
    ).not.toBeNull();
  });

  it('a renamed fresh agent keeps its name', () => {
    strip({
      tabs: [tab({ id: 'a', title: 'auth refactor', titleKind: 'operator' })],
    });
    expect(screen.getByText('auth refactor')).not.toBeNull();
  });

  it('honors an explicit rename even when it matches the source label', () => {
    strip({
      tabs: [tab({ id: 'a', title: 'Claude Code', titleKind: 'operator' })],
    });
    expect(screen.getByText('Claude Code')).not.toBeNull();
  });

  it('keeps a resumed catalog label out of operator-owned tab chrome', () => {
    strip({
      tabs: [
        tab({
          id: 'a',
          title: "I'm going to give you a call transcript…",
          titleKind: 'default',
        }),
      ],
      summaries: { 'durable-a': 'Verify E&M codes use AMA guidelines' },
    });
    expect(
      screen.queryByText("I'm going to give you a call transcript…")
    ).toBeNull();
    expect(
      screen.getByText('Verify E&M codes use AMA guidelines')
    ).not.toBeNull();
  });

  it('idle shells stay quiet and keep their title (no glyph to carry them)', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a', harness: 'shell', title: 'Shell' })],
    });
    expect(container.querySelector('[data-status="quiet"]')).not.toBeNull();
    expect(screen.getByText('Shell')).not.toBeNull();
  });

  it('attention is a calm static marker with a clear hover explanation', async () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      attention: { 'session-a': { since: 1 } },
      activity: { 'session-a': true },
    });
    const marker = container.querySelector('[data-attention]');
    expect(marker).not.toBeNull();
    expect(container.querySelector('[data-status]')).toBeNull();
    expect(marker?.querySelector('.animate-ping')).toBeNull();
    expect(marker?.querySelector('.lucide-bell')).toBeNull();

    fireEvent.pointerMove(marker!, { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Needs you — Agent requested input or hit a roadmap block. Open this Session to respond.'
    );
  });

  it('distinguishes a quiet result from a human gate and shows faults', () => {
    const { container, rerender } = strip({
      tabs: [tab({ id: 'a' })],
      attention: { 'session-a': { kind: 'turn-end', since: 1 } },
      engaged: { 'session-a': true },
    });
    expect(
      container.querySelector('[data-status-light="result"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-attention]')).toBeNull();

    rerender(
      <TooltipProvider>
        <TabStrip
          projects={[
            {
              dir: '/repo',
              name: 'repo',
              color: '#19E6FF',
              activeTabId: 'a',
              tabs: [tab({ id: 'a', lifecycle: 'failed', exitCode: 1 })],
            },
          ]}
          activeDir="/repo"
          pinnedTabId={null}
          summaries={{}}
          attention={{}}
          activity={{}}
          engaged={{}}
          onTogglePinTab={vi.fn()}
          onResumeTab={vi.fn()}
          onSelectProject={vi.fn()}
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onRenameTab={vi.fn()}
          onRenameProject={vi.fn()}
          onSetProjectColor={vi.fn()}
        />
      </TooltipProvider>
    );
    expect(
      container.querySelector('[data-status-light="fault"]')
    ).not.toBeNull();
  });

  it('every tab offers Close (D24 chrome model); stopped tabs condense', () => {
    const { container } = strip({
      tabs: [
        tab({ id: 'a', title: 'alpha' }),
        tab({
          id: 'b',
          title: 'beta',
          sessionId: null,
          resumeState: 'ended-resumable',
          lifecycle: 'stopped-clean',
        }),
      ],
    });
    expect(screen.getByLabelText('Close alpha')).not.toBeNull();
    expect(screen.getByLabelText('Close beta')).not.toBeNull();
    // the stopped tab's text folds into a condensed chip (hover unfurls)
    expect(container.querySelector('[data-condensed]')).not.toBeNull();
  });

  it('a ⌘T draft is a real chip — fresh ring, no badge, discardable', () => {
    const { container } = strip({
      tabs: [
        tab({ id: 'a', title: 'alpha' }),
        tab({
          id: 'd',
          title: 'New agent',
          sessionId: null,
          resumeState: 'identity-missing',
          lifecycle: 'draft',
        }),
      ],
    });
    expect(screen.getByText('New agent')).not.toBeNull();
    expect(screen.getByLabelText('Close New agent')).not.toBeNull();
    expect(container.querySelector('[data-status="fresh"]')).not.toBeNull();
    // drafts carry no lifecycle badge and never condense
    expect(screen.queryByLabelText('Stopped')).toBeNull();
    expect(container.querySelector('[data-condensed]')).toBeNull();
  });

  it('the ACTIVE stopped tab stays unfurled — its restore panel is on screen', () => {
    const { container } = strip({
      tabs: [
        tab({
          id: 'a',
          title: 'alpha',
          sessionId: null,
          resumeState: 'ended-resumable',
          lifecycle: 'stopped-clean',
        }),
      ],
    });
    // tabs[0] is the group's activeTabId in the fixture
    expect(container.querySelector('[data-condensed]')).toBeNull();
  });

  it('a stopped tab right-click offers Pin — the split shows retained history (D26/D27)', () => {
    const { container } = strip({
      tabs: [
        tab({ id: 'a', title: 'alpha' }),
        tab({
          id: 'b',
          title: 'beta',
          sessionId: null,
          harnessSessionId: 'provider-b',
          resumeState: 'ended-resumable',
          lifecycle: 'stopped-clean',
        }),
      ],
    });
    const deadTab = container.querySelectorAll('[data-tab-id]')[1];
    fireEvent.contextMenu(deadTab);
    const menu = container.querySelector('[data-strip-menu]');
    expect(menu?.textContent).toContain('Pin in split');
    expect(menu?.textContent).toContain('Resume This Agent');
    expect(menu?.textContent).toContain('Close');
  });

  it('the Project right-click menu exposes Close project', () => {
    const onCloseProject = vi.fn();
    const { container } = strip({ tabs: [], onCloseProject });
    fireEvent.contextMenu(container.querySelector('[data-project]')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close project' }));
    expect(onCloseProject).toHaveBeenCalledWith('/repo');
  });

  it('opens Project actions with Shift-F10 and restores focus on Escape', async () => {
    const { container } = strip({ tabs: [], onCloseProject: vi.fn() });
    const trigger = screen.getByRole('button', { name: 'repo' });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true });
    const menu = screen.getByRole('menu', { name: 'repo Project actions' });
    expect(menu).toHaveTextContent('Rename / color…');
    expect(menu).toHaveTextContent('Close project');

    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(container.querySelector('[data-strip-menu]')).toBeNull();
  });

  it('uses roving focus with Home, End, and Tab exit semantics', async () => {
    strip({ tabs: [tab({ id: 'a' })], onCloseProject: vi.fn() });
    const projectTrigger = screen.getByRole('button', { name: 'repo' });
    const sessionTrigger = screen.getByRole('button', {
      name: 'New agent — new',
    });

    fireEvent.keyDown(projectTrigger, { key: 'F10', shiftKey: true });
    const menu = screen.getByRole('menu', { name: 'repo Project actions' });
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    expect(items.filter(item => item.tabIndex === 0)).toHaveLength(1);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Tab' });
    await waitFor(() => expect(sessionTrigger).toHaveFocus());
  });

  it('hands focus to rename and closes a menu whose target disappears', async () => {
    const rendered = strip({ tabs: [tab({ id: 'a' })] });
    const trigger = screen.getByRole('button', {
      name: 'New agent — new',
    });
    fireEvent.keyDown(trigger, { key: 'ContextMenu' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveFocus()
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename' }), {
      key: 'Escape',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'New agent — new' }), {
      key: 'ContextMenu',
    });
    expect(screen.getByRole('menu')).not.toBeNull();
    rendered.rerenderTabs([]);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('opens Session actions with the Context Menu key', () => {
    strip({ tabs: [tab({ id: 'a' })] });
    const trigger = screen.getByRole('button', {
      name: 'New agent — new',
    });

    fireEvent.keyDown(trigger, { key: 'ContextMenu' });
    const menu = screen.getByRole('menu', {
      name: 'New agent Session actions',
    });
    expect(menu).toHaveTextContent('Rename…');
    expect(menu).toHaveTextContent('Pin in split');
    expect(menu).toHaveTextContent('Close');
  });

  it('opens the active Project editor from the shared command event', () => {
    strip({ tabs: [] });
    fireEvent(
      window,
      new CustomEvent(EDIT_ACTIVE_PROJECT_EVENT, { bubbles: true })
    );
    expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue('repo');
  });

  it('retracts an exiting Project from right to left', () => {
    const { container } = strip({
      tabs: [],
      exitingProjectDirs: new Set(['/repo']),
    });
    const project = container.querySelector('[data-project-exiting="true"]');
    expect(project).not.toBeNull();
    expect(project).toHaveClass('origin-left', 'scale-x-0');
    expect(project).toHaveStyle({ opacity: '0' });
  });

  it('dead tabs carry their lifecycle badge, not a turn-state glyph', () => {
    const { container } = strip({
      tabs: [
        tab({
          id: 'a',
          sessionId: null,
          resumeState: 'ended-resumable',
          lifecycle: 'exited',
        }),
      ],
    });
    expect(container.querySelector('[data-status]')).toBeNull();
    expect(screen.getByLabelText('Exited')).not.toBeNull();
  });
});
