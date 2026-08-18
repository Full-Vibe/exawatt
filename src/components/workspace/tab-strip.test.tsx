import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

// the strip navigates to the Cloud preview from the tab menu (ENG-026 N3);
// jsdom mounts no app router, so provide the standard stub
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { TabStrip } from './tab-strip';
import {
  fleetAttention,
  mergeFleetAttention,
  NO_FLEET_ATTENTION,
} from './session-status';
import type { CloneSessionTarget } from './session-clone';
import type { SessionAttentionSignal } from './status-glyphs';
import { DELEGATION_DOT_CAP } from './session-status';
import type { Project, SessionTab } from './use-workspace-state';
import type { SessionDelegation } from '@/types/electron';
import { EDIT_ACTIVE_PROJECT_EVENT } from './session-jump';

/**
 * Turn-state legibility (ENG-016 D22): the strip must answer "who's
 * spinning, who's finished, who hasn't started" at a glance — and a fresh
 * every tab also retains visible identity, using "New agent" as the final
 * context-label fallback instead of collapsing to icons alone.
 */

function tab(overrides: Partial<SessionTab> & { id: string }): SessionTab {
  return {
    kind: 'session' as const,
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
  delegation = {},
  feedbackEnabled = false,
  onRateContext,
  onCloseProject,
  cloneTargets,
  onCloneTab,
  exitingProjectDirs,
  onCloseTab = vi.fn(),
  onSelectTab = vi.fn(),
}: {
  tabs: SessionTab[];
  summaries?: Record<string, string>;
  attention?: Record<string, SessionAttentionSignal>;
  activity?: Record<string, boolean>;
  engaged?: Record<string, boolean>;
  delegation?: Record<string, SessionDelegation>;
  feedbackEnabled?: boolean;
  onRateContext?: ComponentProps<typeof TabStrip>['onRateContext'];
  onCloseProject?: (dir: string) => void;
  cloneTargets?: CloneSessionTarget[];
  onCloneTab?: (tabId: string, target: CloneSessionTarget) => void;
  exitingProjectDirs?: ReadonlySet<string>;
  onCloseTab?: (tabId: string) => void;
  onSelectTab?: (dir: string, tabId: string) => void;
}) {
  const view = (
    nextTabs: SessionTab[],
    nextDelegation: Record<string, SessionDelegation> = delegation
  ) => {
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
          attention={mergeFleetAttention(fleetAttention('pty', attention))}
          activity={activity}
          engaged={engaged}
          delegation={nextDelegation}
          feedbackEnabled={feedbackEnabled}
          onRateContext={onRateContext}
          onTogglePinTab={vi.fn()}
          onResumeTab={vi.fn()}
          cloneTargets={cloneTargets}
          onCloneTab={onCloneTab}
          onCloseProject={onCloseProject}
          onSelectProject={vi.fn()}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
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
    rerenderTabs: (nextTabs: SessionTab[]) => result.rerender(view(nextTabs)),
    /** re-render with different harness-reported delegation (ENG-023) */
    rerenderDelegation: (next: Record<string, SessionDelegation>) =>
      result.rerender(view(tabs, next)),
  };
}

describe('TabStrip title allocation', () => {
  it('keeps authenticated feedback out of the title flex budget', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      summaries: {
        'durable-a': 'VSCode-Like Theme Across Exawatt Surfaces',
      },
      feedbackEnabled: true,
      onRateContext: vi.fn(async () => true),
    });
    const chrome = container.querySelector('[data-tab-chrome]');
    const label = container.querySelector('[data-tab-label]');
    const overlay = container.querySelector('[data-tab-feedback-overlay]');
    expect(chrome).toHaveClass('flex-1', 'overflow-hidden');
    expect(label).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(overlay).toHaveClass('absolute', 'opacity-0');
    expect(overlay?.parentElement).toBe(
      container.querySelector('[data-ribbon-item="initiative"]')
    );
  });
});

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
    // Attention and turn state are separate channels (agent-state.md), so the
    // marker CARRIES the turn state rather than replacing it. Hiding turn
    // state behind attention is what let two surfaces disagree unnoticed.
    expect(marker?.getAttribute('data-status')).toBe('working');
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
          attention={NO_FLEET_ATTENTION}
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
    // the stopped tab drops its inline title entirely (D42 review round,
    // amends the D23 hover-unfurl: reveals must not shift layout) — its
    // badge and close remain, identity lives in the tooltip and aria-label
    const stopped = container.querySelector('[data-tab-id="b"]');
    expect(stopped?.textContent).not.toContain('beta');
    expect(stopped?.querySelector('[aria-label="Stopped"]')).not.toBeNull();
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

  it('clones a started Agent through a keyboard-complete target drill-in', async () => {
    const onCloneTab = vi.fn();
    strip({
      tabs: [tab({ id: 'a' })],
      engaged: { 'session-a': true },
      cloneTargets: [
        {
          id: 'codex-config',
          sourceId: 'codex-local',
          source: 'codex',
          modelId: 'gpt-5.6-sol',
          effort: 'high',
          label: 'GPT-5.6 Codex',
          detail: 'High',
          accessibleLabel: 'Codex, GPT-5.6 Codex, High',
        },
        {
          id: 'opencode-config',
          sourceId: 'opencode-local',
          source: 'opencode',
          modelId: 'openrouter/kimi',
          effort: null,
          label: 'Kimi K2',
          accessibleLabel: 'OpenCode, Kimi K2',
        },
      ],
      onCloneTab,
    });
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'New agent — result ready' }),
      { key: 'ContextMenu' }
    );
    const clone = screen.getByRole('menuitem', { name: 'Clone to…' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(clone).toHaveFocus();
    fireEvent.keyDown(clone, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', {
          name: 'Clone to Codex, GPT-5.6 Codex, High',
        })
      ).toHaveFocus()
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Clone to OpenCode, Kimi K2' })
    );
    expect(onCloneTab).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ id: 'opencode-config', source: 'opencode' })
    );
  });

  it('does not offer Clone to for shells or unstarted Agents', () => {
    strip({
      tabs: [
        tab({ id: 'a' }),
        tab({ id: 'sh', harness: 'shell', title: 'Shell' }),
      ],
      cloneTargets: [
        {
          id: 'codex-config',
          sourceId: 'codex-local',
          source: 'codex',
          modelId: 'gpt-5.6-sol',
          effort: 'high',
          label: 'GPT-5.6 Codex',
          detail: 'High',
          accessibleLabel: 'Codex, GPT-5.6 Codex, High',
        },
      ],
      onCloneTab: vi.fn(),
    });

    fireEvent.keyDown(screen.getByRole('button', { name: 'New agent — new' }), {
      key: 'ContextMenu',
    });
    expect(screen.queryByRole('menuitem', { name: 'Clone to…' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Shell — quiet' }), {
      key: 'ContextMenu',
    });
    expect(screen.queryByRole('menuitem', { name: 'Clone to…' })).toBeNull();
  });

  it('an agent tab menu carries the announced Push to cloud row and the Cloud entry; a shell tab does not (ENG-026 N3)', () => {
    strip({
      tabs: [
        tab({ id: 'a' }),
        tab({ id: 'sh', harness: 'shell', title: 'Shell' }),
      ],
    });

    fireEvent.keyDown(screen.getByRole('button', { name: 'New agent — new' }), {
      key: 'ContextMenu',
    });
    const agentMenu = screen.getByRole('menu', {
      name: 'New agent Session actions',
    });
    const announced = agentMenu.querySelector('[data-readiness="announced"]');
    expect(announced).not.toBeNull();
    expect(announced).toHaveTextContent('Push to cloud');
    // announced is not a menuitem: keyboard traversal skips it
    expect(announced?.getAttribute('role')).toBeNull();
    const cloudRow = screen.getByRole('menuitem', { name: /Cloud/ });
    expect(cloudRow).toHaveTextContent('Coming soon');
    fireEvent.keyDown(agentMenu, { key: 'Escape' });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Shell — quiet' }), {
      key: 'ContextMenu',
    });
    const shellMenu = screen.getByRole('menu', {
      name: /Shell Session actions/,
    });
    expect(shellMenu.querySelector('[data-readiness="announced"]')).toBeNull();
    expect(shellMenu).not.toHaveTextContent('Cloud');
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
    expect(project).toHaveStyle({
      opacity: '0',
      transformOrigin: 'left center',
    });
    expect(project?.getAttribute('style')).toContain('scaleX(0)');
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

/**
 * Delegated-child dots (ENG-023 D1). The strip is where the operator decides
 * whether anything needs them, so a tab that handed work off must not read as
 * finished, and the dots must not make the strip jump while children churn.
 */
describe('TabStrip delegated work (ENG-023)', () => {
  const children = (count: number, kind = 'Explore') =>
    Array.from({ length: count }, (_, index) => ({
      id: `a${index}`,
      agentType: kind,
      startedAt: index,
    }));
  const delegating = (count: number, kind?: string): SessionDelegation => ({
    ownTurn: 'available',
    blockedOn: null,
    children: children(count, kind),
  });

  it('a quiet parent with children reads as working, not as a ready result', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      engaged: { 'session-a': true },
      delegation: { 'session-a': delegating(2) },
    });
    expect(container.querySelector('[data-status="done"]')).toBeNull();
    expect(container.querySelector('[data-status="working"]')).not.toBeNull();
  });

  it('shows one dot per child and names the exact count for a screen reader', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      delegation: { 'session-a': delegating(3) },
    });
    const cluster = container.querySelector('[data-delegation]');
    expect(cluster?.getAttribute('data-delegation')).toBe('3');
    expect(cluster?.getAttribute('aria-label')).toBe(
      '3 delegated agents working — Explore'
    );
  });

  it('caps the dots but keeps the true number in the accessible name', () => {
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      delegation: { 'session-a': delegating(16) },
    });
    const cluster = container.querySelector('[data-delegation]');
    // a workflow fan-out reads as "lots", and the readout stays exact
    expect(cluster?.getAttribute('data-delegation')).toBe('16');
    expect(cluster?.getAttribute('aria-label')).toContain(
      '16 delegated agents'
    );
  });

  it('never resizes the tab as children come and go', () => {
    // The cluster exists precisely because children start and finish, and a
    // spawn must not shove the rest of the strip sideways. That invariant now
    // lives in the LAYOUT — a tab's width comes from the policy and the title
    // flexes inside it — so the cluster is free to be exactly as wide as the
    // children it reports. It used to reserve all five slots instead, which
    // bought a band of dead space between the glyph and the title on every
    // tab with one or two children.
    const { container, rerenderDelegation } = strip({
      tabs: [tab({ id: 'a' })],
      delegation: { 'session-a': delegating(1) },
    });
    const tabWidth = () =>
      (container.querySelector('[data-tab-id="a"]') as HTMLElement).style.width;
    const dots = () =>
      container.querySelectorAll('[data-delegation] > span').length;

    const settled = tabWidth();
    expect(settled).toBeTruthy();
    expect(dots()).toBe(1);

    rerenderDelegation({ 'session-a': delegating(4) });
    expect(tabWidth()).toBe(settled);
    expect(dots()).toBe(4);

    // past the cap the cluster stops growing; the exact count stays in the
    // accessible name
    rerenderDelegation({ 'session-a': delegating(19) });
    expect(tabWidth()).toBe(settled);
    expect(dots()).toBe(DELEGATION_DOT_CAP);
  });

  it('closes an unselected tab on middle-click without selecting it first', () => {
    // Chrome's third tab verb. Closing a tab you are NOT on is the whole
    // point, so it must not route through selection on the way.
    const onCloseTab = vi.fn();
    const onSelectTab = vi.fn();
    const { container } = strip({
      tabs: [tab({ id: 'a' }), tab({ id: 'b' })],
      onCloseTab,
      onSelectTab,
    });
    const second = container.querySelector('[data-tab-id="b"]') as HTMLElement;
    fireEvent(
      second,
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    );
    expect(onCloseTab).toHaveBeenCalledWith('b');
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it('leaves the other mouse buttons to selection and the context menu', () => {
    const onCloseTab = vi.fn();
    const { container } = strip({ tabs: [tab({ id: 'a' })], onCloseTab });
    const only = container.querySelector('[data-tab-id="a"]') as HTMLElement;
    fireEvent(
      only,
      new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true })
    );
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it('adds no empty flex child to a tab that is not delegating', () => {
    // Regression: the dots were briefly wrapped in a colored <span>. The
    // wrapper survived as a zero-width flex child when there was nothing to
    // draw, and the row's gap-1.5 then padded EVERY non-delegating tab.
    const { container } = strip({
      tabs: [tab({ id: 'a' })],
      engaged: { 'session-a': true },
    });
    const chrome = container.querySelector('[data-tab-chrome]');
    const empties = Array.from(chrome?.children ?? []).filter(
      node => node.innerHTML === ''
    );
    expect(empties).toEqual([]);
  });

  it('renders nothing at all when no delegation is reported', () => {
    // Codex reports none: absent must read as absent, never as an empty
    // cluster or a zero.
    const { container } = strip({
      tabs: [tab({ id: 'a', harness: 'codex' })],
      engaged: { 'session-a': true },
    });
    expect(container.querySelector('[data-delegation]')).toBeNull();
    expect(container.querySelector('[data-status="done"]')).not.toBeNull();
  });

  it('clears the dots and settles the light when the last child finishes', () => {
    const { container, rerenderDelegation } = strip({
      tabs: [tab({ id: 'a' })],
      engaged: { 'session-a': true },
      delegation: { 'session-a': delegating(2) },
    });
    expect(container.querySelector('[data-delegation]')).not.toBeNull();
    rerenderDelegation({});
    expect(container.querySelector('[data-delegation]')).toBeNull();
    expect(container.querySelector('[data-status="done"]')).not.toBeNull();
  });
});
