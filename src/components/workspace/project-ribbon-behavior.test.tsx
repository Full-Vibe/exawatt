import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

// the strip navigates to the Cloud preview from the tab menu (ENG-026 N3);
// jsdom mounts no app router, so provide the standard stub
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { buildRibbonTokens, TabStrip } from './tab-strip';
import type { Project, WorkspaceTab } from './use-workspace-state';

function tab(id: string): WorkspaceTab {
  return {
    id,
    durableSessionId: `durable-${id}`,
    harness: 'claude',
    title: `Initiative ${id}`,
    titleKind: 'operator',
    cwd: '/repo',
    sessionId: `session-${id}`,
    harnessSessionId: `provider-${id}`,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: `Initiative ${id}`,
  };
}

function project(
  dir: string,
  tabs: WorkspaceTab[],
  ribbonExpanded = false
): Project {
  return {
    dir,
    name: dir.slice(1),
    color: '#19E6FF',
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    ribbonExpanded,
  };
}

function ribbon({
  projects,
  activeDir,
  dormantProjectDirs,
  attention = {},
  activity = {},
  onToggleProjectExpanded = vi.fn(),
}: {
  projects: Project[];
  activeDir: string;
  dormantProjectDirs?: ReadonlySet<string>;
  attention?: Record<string, { kind?: 'bell'; since: number }>;
  activity?: Record<string, boolean>;
  onToggleProjectExpanded?: (dir: string) => void;
}) {
  return render(
    <TooltipProvider>
      <TabStrip
        projects={projects}
        activeDir={activeDir}
        pinnedTabId={null}
        summaries={{}}
        attention={attention}
        activity={activity}
        dormantProjectDirs={dormantProjectDirs}
        onSelectProject={vi.fn()}
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onRenameTab={vi.fn()}
        onRenameProject={vi.fn()}
        onSetProjectColor={vi.fn()}
        onToggleProjectExpanded={onToggleProjectExpanded}
      />
    </TooltipProvider>
  );
}

describe('elastic Project ribbon behavior', () => {
  it('expands the selected Project and condenses inactive work in place (D42)', () => {
    const projects = [
      project('/alpha', [tab('a1'), tab('a2')]),
      project('/beta', [tab('b1'), tab('b2')]),
    ];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    expect(container.querySelector('[data-tab-id="a1"]')).not.toBeNull();
    expect(
      container.querySelector('[data-tab-id="a1"][data-tab-condensed]')
    ).toBeNull();
    // inactive tabs stay RENDERED — count, per-Agent state, and ordinal
    // anchors survive collapse — but condensed to glyph chips: no visible
    // title, no close affordance
    const b1 = container.querySelector('[data-tab-id="b1"]');
    expect(b1).not.toBeNull();
    expect(b1).toHaveAttribute('data-tab-condensed');
    expect(b1?.textContent).not.toContain('Initiative b1');
    expect(
      b1?.querySelector('[aria-label="Close Initiative b1"]')
    ).toBeNull();
    expect(container.querySelector('[data-project="beta"]')).toHaveAttribute(
      'data-ribbon-expanded',
      'false'
    );
  });

  it('supports multiple persisted manual expansions', () => {
    const projects = [
      project('/alpha', [tab('a1')]),
      project('/beta', [tab('b1')], true),
    ];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    expect(container.querySelector('[data-tab-id="a1"]')).not.toBeNull();
    const b1 = container.querySelector('[data-tab-id="b1"]');
    expect(b1).not.toBeNull();
    // a persisted disclosure keeps the inactive Project's tabs FULL-width
    expect(b1).not.toHaveAttribute('data-tab-condensed');
    expect(container.querySelector('[data-project="beta"]')).toHaveAttribute(
      'data-ribbon-expanded',
      'true'
    );
  });

  it('exposes the persistent disclosure as both a button and menu verb', () => {
    const toggle = vi.fn();
    const projects = [project('/alpha', [tab('a1')])];
    const { container } = ribbon({
      projects,
      activeDir: '/alpha',
      onToggleProjectExpanded: toggle,
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Keep alpha expanded when inactive',
      })
    );
    expect(toggle).toHaveBeenCalledWith('/alpha');
    fireEvent.contextMenu(container.querySelector('[data-project="alpha"]')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep expanded' }));
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('stable-partitions dormant empty Projects at the visual tail', () => {
    const projects = [
      project('/alpha', [tab('a1')]),
      project('/empty-a', []),
      project('/beta', [tab('b1')]),
      project('/empty-b', []),
    ];
    const { container } = ribbon({
      projects,
      activeDir: '/alpha',
      dormantProjectDirs: new Set(['/empty-a', '/empty-b']),
    });
    expect(
      Array.from(container.querySelectorAll('[data-project]')).map(element =>
        element.getAttribute('data-project')
      )
    ).toEqual(['alpha', 'beta', 'empty-a', 'empty-b']);
  });

  it('keeps per-Agent attention visible on condensed chips AND the Project signal', () => {
    const projects = [
      project('/alpha', [tab('a1')]),
      project('/beta', [tab('b1')]),
    ];
    const { container } = ribbon({
      projects,
      activeDir: '/alpha',
      attention: { 'session-b1': { kind: 'bell', since: 1 } },
    });
    const beta = container.querySelector('[data-project="beta"]');
    expect(
      beta?.querySelector('[data-project-signal="needs-you"]')
    ).not.toBeNull();
    // D42: the belled Agent itself stays visible as a condensed chip whose
    // own status glyph carries needs-you — not only the aggregate dot
    const b1 = container.querySelector('[data-tab-id="b1"]');
    expect(b1).toHaveAttribute('data-tab-condensed');
    expect(b1?.querySelector('[data-attention]')).not.toBeNull();
  });

  it('admits a late attention-bearing Project ahead of quiet overflow', () => {
    const projects = Array.from({ length: 14 }, (_, index) =>
      project(`/project-${index}`, [tab(`tab-${index}`)])
    );
    const late = projects.at(-1)!;
    const lateSession = late.tabs[0].sessionId!;
    const { container } = ribbon({
      projects,
      activeDir: projects[0].dir,
      attention: { [lateSession]: { kind: 'bell', since: 1 } },
    });
    expect(
      container.querySelector(`[data-project="${late.name}"]`)
    ).toHaveStyle({ opacity: '1' });
    expect(
      Array.from(container.querySelectorAll('[data-project]')).some(
        element =>
          element.getAttribute('data-project') !== late.name &&
          (element as HTMLElement).style.opacity === '0'
      )
    ).toBe(true);
  });

  it('keeps the strip height identical across Project switches (D42)', () => {
    const projects = [
      project(
        '/dense',
        Array.from({ length: 6 }, (_, index) =>
          tab(`dense-${index}-with-a-long-goal-label`)
        )
      ),
      project('/sparse', [tab('solo')]),
    ];
    const { container, rerender } = ribbon({
      projects,
      activeDir: '/dense',
    });
    const strip = () =>
      container.querySelector('[data-workspace-tab-strip]') as HTMLElement;
    const before = strip().style.height;
    const stableBefore = strip().getAttribute('data-ribbon-stable-rows');
    rerender(
      <TooltipProvider>
        <TabStrip
          projects={projects}
          activeDir="/sparse"
          pinnedTabId={null}
          summaries={{}}
          attention={{}}
          activity={{}}
          onSelectProject={vi.fn()}
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onRenameTab={vi.fn()}
          onRenameProject={vi.fn()}
          onSetProjectColor={vi.fn()}
          onToggleProjectExpanded={vi.fn()}
        />
      </TooltipProvider>
    );
    expect(strip().style.height).toBe(before);
    expect(strip().getAttribute('data-ribbon-stable-rows')).toBe(stableBefore);
    // and the height carries no transition to animate through
    expect(strip().style.transition).toBe('');
  });

  it('models the dead-chip title collapse in the width presentation (D42)', () => {
    // A stopped, unselected tab of an expanded-but-inactive Project renders
    // with a collapsed title; when its Project is active AND it is selected,
    // the title shows. The height model must see these as different widths
    // or a pure selection change could flip the reserved rows.
    const stopped: WorkspaceTab = {
      ...tab('dead-1'),
      sessionId: null,
      resumeState: 'ended-resumable',
      lifecycle: 'exited',
    };
    const projects = [
      project('/alpha', [tab('a1')]),
      { ...project('/beta', [stopped, tab('b2')], true), activeTabId: 'dead-1' },
    ];
    const inactive = buildRibbonTokens({
      orderedProjects: projects,
      projects,
      activeDir: '/alpha',
      projectSignals: new Map(),
      attention: {},
    }).find(token => token.key === 'tab:dead-1');
    const active = buildRibbonTokens({
      orderedProjects: projects,
      projects,
      activeDir: '/beta',
      projectSignals: new Map(),
      attention: {},
    }).find(token => token.key === 'tab:dead-1');
    expect(
      inactive?.kind === 'tab' && inactive.titleCollapsed
    ).toBe(true);
    expect(active?.kind === 'tab' && active.titleCollapsed).toBe(false);
    // the height model reserves the ACTIVE Project's dead tabs uncollapsed
    // even when they are NOT selected, so no activeTabId click inside it
    // can outgrow the reservation
    const betaOnOther = projects.map(entry =>
      entry.dir === '/beta' ? { ...entry, activeTabId: 'b2' } : entry
    );
    const plain = buildRibbonTokens({
      orderedProjects: betaOnOther,
      projects: betaOnOther,
      activeDir: '/beta',
      projectSignals: new Map(),
      attention: {},
    }).find(token => token.key === 'tab:dead-1');
    expect(plain?.kind === 'tab' && plain.titleCollapsed).toBe(true);
    const reserved = buildRibbonTokens({
      orderedProjects: betaOnOther,
      projects: betaOnOther,
      activeDir: '/beta',
      projectSignals: new Map(),
      attention: {},
      reserveDeadExpansion: true,
    }).find(token => token.key === 'tab:dead-1');
    expect(reserved?.kind === 'tab' && reserved.titleCollapsed).toBe(false);
  });

  it('bounds dense active work to two rows with an overview affordance', () => {
    const dense = project(
      '/dense',
      Array.from({ length: 20 }, (_, index) => tab(`dense-${index}`))
    );
    const { container } = ribbon({ projects: [dense], activeDir: '/dense' });
    const strip = container.querySelector('[data-workspace-tab-strip]');
    expect(Number(strip?.getAttribute('data-ribbon-rows'))).toBeLessThanOrEqual(
      2
    );
    expect(container.querySelector('[data-ribbon-overflow]')).not.toBeNull();
  });
});
