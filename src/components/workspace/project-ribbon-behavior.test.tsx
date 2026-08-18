import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

// the strip navigates to the Cloud preview from the tab menu (ENG-026 N3);
// jsdom mounts no app router, so provide the standard stub
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { TabStrip } from './tab-strip';
import { fleetAttention, mergeFleetAttention } from './session-status';
import { DEFAULT_RIBBON_POLICY } from './project-ribbon-layout';
import type { Project, SessionTab } from './use-workspace-state';

function tab(id: string): SessionTab {
  return {
    id,
    kind: 'session' as const,
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

function project(dir: string, tabs: SessionTab[]): Project {
  return {
    dir,
    name: dir.slice(1),
    color: '#19E6FF',
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
}

function view({
  projects,
  activeDir,
  dormantProjectDirs,
  summaries = {},
  attention = {},
  activity = {},
}: {
  projects: Project[];
  activeDir: string;
  dormantProjectDirs?: ReadonlySet<string>;
  summaries?: Record<string, string>;
  attention?: Record<string, { kind?: 'bell'; since: number }>;
  activity?: Record<string, boolean>;
}) {
  return (
    <TooltipProvider>
      <TabStrip
        projects={projects}
        activeDir={activeDir}
        pinnedTabId={null}
        summaries={summaries}
        attention={mergeFleetAttention(fleetAttention('test', attention))}
        activity={activity}
        dormantProjectDirs={dormantProjectDirs}
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

const ribbon = (args: Parameters<typeof view>[0]) => render(view(args));
const modeOf = (container: HTMLElement, name: string) =>
  container
    .querySelector(`[data-project="${name}"]`)
    ?.getAttribute('data-project-mode');

describe('single-row Project ribbon (D45)', () => {
  it('opens the selected Project and minis the others in place', () => {
    const projects = [
      project('/alpha', [tab('a1'), tab('a2')]),
      project('/beta', [tab('b1'), tab('b2')]),
    ];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    expect(modeOf(container, 'alpha')).toBe('open');
    expect(modeOf(container, 'beta')).toBe('mini');
    expect(
      container.querySelector('[data-tab-id="a1"][data-tab-condensed]')
    ).toBeNull();
    // an inactive Project's tabs stay RENDERED — per-Agent state, count and
    // ordinal anchors survive — but as glyph chips with no title or close
    const b1 = container.querySelector('[data-tab-id="b1"]');
    expect(b1).not.toBeNull();
    expect(b1).toHaveAttribute('data-tab-condensed');
    expect(b1?.textContent).not.toContain('Initiative b1');
    expect(b1?.querySelector('[aria-label="Close Initiative b1"]')).toBeNull();
  });

  it('uses the visible context labels to spend available width', () => {
    const first = {
      ...tab('a1'),
      title: 'Codex',
      titleKind: 'default' as const,
    };
    const second = {
      ...tab('a2'),
      title: 'Claude Code',
      titleKind: 'default' as const,
    };
    const projects = [project('/alpha', [first, second])];
    const { container } = ribbon({
      projects,
      activeDir: '/alpha',
      summaries: {
        [first.durableSessionId]:
          'Unify appearance settings across every application surface',
        [second.durableSessionId]:
          'Analyze workspace ribbon readability after the tab improvements',
      },
    });

    // The stored provider titles are deliberately short. The long context
    // labels are what actually paint, so both tabs should claim the full
    // width cap instead of budgeting from "Codex" and leaving the rest of
    // the row blank.
    const cap = `${DEFAULT_RIBBON_POLICY.maxTabWidth}px`;
    expect(
      (container.querySelector('[data-tab-id="a1"]') as HTMLElement).style
        .width
    ).toBe(cap);
    expect(
      (container.querySelector('[data-tab-id="a2"]') as HTMLElement).style
        .width
    ).toBe(cap);
  });

  it('has exactly one row whose height never changes with selection', () => {
    const projects = [
      project(
        '/dense',
        Array.from({ length: 6 }, (_, index) =>
          tab(`dense-${index}-with-a-long-goal-label`)
        )
      ),
      project('/sparse', [tab('solo')]),
    ];
    const { container, rerender } = ribbon({ projects, activeDir: '/dense' });
    const strip = () =>
      container.querySelector('[data-workspace-tab-strip]') as HTMLElement;
    const before = strip().style.height;
    expect(strip().getAttribute('data-ribbon-rows')).toBe('1');
    rerender(view({ projects, activeDir: '/sparse' }));
    expect(strip().style.height).toBe(before);
    expect(strip().getAttribute('data-ribbon-rows')).toBe('1');
    // height carries no transition to animate through
    expect(strip().style.transition).toBe('');
  });

  it('folds a Project into a counted container rather than evicting it', () => {
    // enough work that even glyph chips cannot all fit the fallback width
    const projects = Array.from({ length: 9 }, (_, index) =>
      project(
        `/project-${index}`,
        Array.from({ length: 3 }, (_, tabIndex) =>
          tab(`p${index}-t${tabIndex}`)
        )
      )
    );
    const { container } = ribbon({
      projects,
      activeDir: projects[0].dir,
    });
    const folded = Array.from(
      container.querySelectorAll('[data-project-folded]')
    );
    expect(folded.length).toBeGreaterThan(0);
    // the container says how much work it holds, and its tabs are not drawn
    for (const node of folded) {
      const dir = node.getAttribute('data-project-dir')!;
      const owner = projects.find(item => item.dir === dir)!;
      expect(
        node.querySelector(`[data-project-folded-count="${owner.tabs.length}"]`)
      ).not.toBeNull();
      expect(
        container.querySelector(`[data-tab-id="${owner.tabs[0].id}"]`)
      ).toBeNull();
    }
    // the Project you are in is never the one that folds
    expect(modeOf(container, projects[0].name)).toBe('open');
  });

  it('shows the same presentation for a Project wherever you are standing', () => {
    // The reported bug: a five-tab Project used to blank every other
    // Project's chips while a one-tab Project showed them all.
    const projects = [
      project('/big', Array.from({ length: 5 }, (_, i) => tab(`big-${i}`))),
      project('/mid', [tab('m1'), tab('m2')]),
      project('/small', [tab('s1')]),
    ];
    const { container, rerender } = ribbon({ projects, activeDir: '/big' });
    const midWhileBigActive = modeOf(container, 'mid');
    rerender(view({ projects, activeDir: '/small' }));
    expect(modeOf(container, 'mid')).toBe(midWhileBigActive);
  });

  it('reads attention off the chip, and the Project dot yields to it', () => {
    // The dot summarises a Project's Agents; while those Agents are on
    // screen as chips it would only repeat them (operator, 2026-08-03).
    const projects = [
      project('/alpha', [tab('a1')]),
      project('/beta', [tab('b1')]),
    ];
    const { container } = ribbon({
      projects,
      activeDir: '/alpha',
      attention: { 'session-b1': { kind: 'bell', since: 1 } },
    });
    const b1 = container.querySelector('[data-tab-id="b1"]');
    expect(b1).toHaveAttribute('data-tab-condensed');
    expect(b1?.querySelector('[data-attention]')).not.toBeNull();
    expect(
      container
        .querySelector('[data-project="beta"]')
        ?.querySelector('[data-project-signal]')
    ).toBeNull();
  });

  it('shows the Project dot exactly where the chips are missing', () => {
    // Folded Projects draw no chips, so the dot is the only status they
    // have.
    const many = Array.from({ length: 9 }, (_, index) =>
      project(
        `/project-${index}`,
        Array.from({ length: 3 }, (_, t) => tab(`p${index}-t${t}`))
      )
    );
    const { container } = ribbon({ projects: many, activeDir: many[0].dir });
    const folded = container.querySelector('[data-project-folded]');
    expect(folded?.querySelector('[data-project-signal]')).not.toBeNull();
  });

  it('does not resize a Project header when its last tab closes', () => {
    // An empty Project has no Agents to summarise, so it grows no dot —
    // which also means closing the last tab cannot shift the chips beside
    // it out from under the pointer mid-close (the D41 stability window).
    const populated = [project('/alpha', [tab('a1')]), project('/beta', [tab('b1')])];
    const emptied = [project('/alpha', [tab('a1')]), project('/beta', [])];
    const { container, rerender } = ribbon({
      projects: populated,
      activeDir: '/alpha',
    });
    const marksIn = (name: string) =>
      container.querySelector(`[data-project="${name}"]`)
        ?.querySelectorAll('[data-project-signal]').length;
    expect(marksIn('beta')).toBe(0);
    rerender(view({ projects: emptied, activeDir: '/alpha' }));
    expect(marksIn('beta')).toBe(0);
  });

  it('gives each glyph chip exactly one mark', () => {
    // The source swirl left the chips: status is the whole job at 26px.
    // a title long enough that the open tab is not width-squeezed, where
    // the source mark is dropped for room regardless
    const projects = [
      project('/alpha', [tab('a1-with-a-comfortably-long-goal')]),
      project('/beta', [tab('b1')]),
    ];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    const chip = container.querySelector('[data-tab-id="b1"]');
    expect(chip).toHaveAttribute('data-tab-condensed');
    expect(chip?.querySelector('[data-slot="harness-glyph"]')).toBeNull();
    // ...while the Project you are in keeps its source marks
    expect(
      container
        .querySelector('[data-tab-id="a1-with-a-comfortably-long-goal"]')
        ?.querySelector('[data-slot="harness-glyph"]')
    ).not.toBeNull();
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

  it('has no keep-expanded control left to explain', () => {
    // The operator: "I had no idea what that did as a user." One less state.
    const projects = [project('/alpha', [tab('a1')])];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    expect(
      screen.queryByRole('button', { name: /keep .* expanded/i })
    ).toBeNull();
    expect(container.querySelector('[data-ribbon-expanded]')).toBeNull();
    expect(container.textContent).not.toContain('◇');
    expect(container.textContent).not.toContain('◆');
  });

  it('never renders a +N overflow button — nothing is hidden to open', () => {
    const projects = Array.from({ length: 12 }, (_, index) =>
      project(`/project-${index}`, [tab(`tab-${index}`)])
    );
    const { container } = ribbon({ projects, activeDir: projects[0].dir });
    expect(container.querySelector('[data-ribbon-overflow]')).toBeNull();
    // every Project still has a chip on screen
    expect(container.querySelectorAll('[data-ribbon-item="project"]')).toHaveLength(
      projects.length
    );
  });
});

describe('D45 review-round regressions', () => {
  it('draws the scroll fade on the scroller, not over the whole strip', () => {
    // A mask paints its entire subtree: on the outer element it sliced the
    // fixed-position context menu down to a sliver whenever the row scrolled.
    const projects = Array.from({ length: 10 }, (_, index) =>
      project(`/project-${index}`, [tab(`tab-${index}`)])
    );
    const { container } = ribbon({ projects, activeDir: projects[0].dir });
    const strip = container.querySelector(
      '[data-workspace-tab-strip]'
    ) as HTMLElement;
    expect(strip.style.maskImage || '').toBe('');
    expect(strip.style.webkitMaskImage || '').toBe('');
    expect(container.querySelector('[data-ribbon-scroller]')).not.toBeNull();
  });

  it('sizes a Project header from its own content, never from its assignment', () => {
    // The header fills the width the engine assigns so long names truncate;
    // measuring that box would hand the engine its own output straight back
    // and the header could never grow to fit a longer name.
    const projects = [project('/alpha', [tab('a1')])];
    const { container } = ribbon({ projects, activeDir: '/alpha' });
    const label = container.querySelector('[data-project-label]');
    expect(label).not.toBeNull();
    // the label must not absorb slack — that slack is visible whitespace
    expect(label?.className).not.toContain('flex-1');
  });
});

describe('folded Projects stay reachable', () => {
  it('carries its tabs’ ordinals while ⌘ is held, since they have no chip', () => {
    const projects = Array.from({ length: 9 }, (_, index) =>
      project(
        `/project-${index}`,
        Array.from({ length: 3 }, (_, tabIndex) =>
          tab(`p${index}-t${tabIndex}`)
        )
      )
    );
    const { container } = ribbon({ projects, activeDir: projects[0].dir });
    const folded = container.querySelector('[data-project-folded]');
    expect(folded).not.toBeNull();
    const badge = folded?.querySelector('[data-project-folded-count]');
    // at rest the container reports how much work it holds
    expect(badge?.getAttribute('data-project-folded-ordinals')).toBeNull();
    expect(badge?.textContent).toBe('3');
  });
});
