import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    <TabStrip
      projects={projects}
      activeDir="/repo"
      pinnedTabId={null}
      summaries={summaries}
      attention={attention}
      activity={activity}
      engaged={engaged}
      onSelectProject={vi.fn()}
      onSelectTab={vi.fn()}
      onCloseTab={vi.fn()}
      onRenameTab={vi.fn()}
      onRenameProject={vi.fn()}
      onSetProjectColor={vi.fn()}
    />
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
    strip({ tabs: [tab({ id: 'a', title: 'auth refactor' })] });
    expect(screen.getByText('auth refactor')).not.toBeNull();
  });

  it('idle shells stay quiet and keep their title (no glyph to carry them)', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a', harness: 'shell', title: 'Shell' })],
    });
    expect(container.querySelector('[data-status="quiet"]')).not.toBeNull();
    expect(screen.getByText('Shell')).not.toBeNull();
  });

  it('attention outranks every turn-state glyph', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      attention: { 'session-a': { since: 1 } },
      activity: { 'session-a': true },
    });
    expect(container.querySelector('[data-attention]')).not.toBeNull();
    expect(container.querySelector('[data-status]')).toBeNull();
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
