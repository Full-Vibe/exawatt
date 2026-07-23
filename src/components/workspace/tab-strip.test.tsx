import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from './tab-strip';
import type { Project, WorkspaceTab } from './use-workspace-state';

/**
 * Turn-state legibility (ENG-016 D22): the strip must answer "who's
 * spinning, who's finished, who hasn't started" at a glance — and a fresh
 * agent tab stays glyph-only (no redundant "Claude Code" next to the mark).
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
}: {
  tabs: WorkspaceTab[];
  summaries?: Record<string, string>;
  attention?: Record<string, { since: number }>;
  activity?: Record<string, boolean>;
  engaged?: Record<string, boolean>;
}) {
  const projects: Project[] = [
    {
      dir: '/repo',
      name: 'repo',
      color: '#19E6FF',
      activeTabId: tabs[0]?.id ?? null,
      tabs,
    },
  ];
  return render(
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
        onSelectProject={vi.fn()}
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onRenameTab={vi.fn()}
        onRenameProject={vi.fn()}
        onSetProjectColor={vi.fn()}
      />
    </TooltipProvider>
  );
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

  it('an agent never given work shows fresh — and no default title text', () => {
    const { container } = strip({ tabs: [tab({ id: 'a' })] });
    expect(container.querySelector('[data-status="fresh"]')).not.toBeNull();
    expect(screen.queryByText('Claude Code')).toBeNull();
    // glyph-only tabs still carry a real accessible name
    expect(
      screen.getByRole('button', { name: 'Claude Code — new' })
    ).not.toBeNull();
  });

  it('a summarized glyph-only tab names itself by harness, goal, and state', () => {
    strip({
      tabs: [tab({ id: 'a' })],
      summaries: { 'durable-a': 'Ship code review fixes' },
    });
    expect(
      screen.getByRole('button', {
        name: 'Claude Code — Ship code review fixes — turn finished',
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
      'Unseen update — Agent finished or requested input. Open this tab to acknowledge.'
    );
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
