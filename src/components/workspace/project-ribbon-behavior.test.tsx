import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from './tab-strip';
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
  it('auto-expands only the selected Project and keeps inactive work compact', () => {
    const projects = [
      project('/alpha', [tab('a1'), tab('a2')]),
      project('/beta', [tab('b1'), tab('b2')]),
    ];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    expect(container.querySelector('[data-tab-id="a1"]')).not.toBeNull();
    expect(container.querySelector('[data-tab-id="a2"]')).not.toBeNull();
    expect(container.querySelector('[data-tab-id="b1"]')).toBeNull();
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
    expect(container.querySelector('[data-tab-id="b1"]')).not.toBeNull();
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

  it('rolls hidden Agent attention into a compact inactive Project signal', () => {
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
    expect(container.querySelector('[data-tab-id="b1"]')).toBeNull();
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
