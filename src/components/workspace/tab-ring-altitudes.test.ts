import { describe, expect, it } from 'vitest';
import { nextTabInRing } from './tab-ring';
import { orderTeamTabs, teamViewProjects } from './team-order';
import type { TeamOrderSignals } from './team-order';
import type { Project, WorkspaceTab } from './use-workspace-state';

/**
 * BUG-021 — `⌘⇧[` / `⌘⇧]` at the Team altitude.
 *
 * The ring's own contract is DISPLAY order: "every visible section of the
 * strip in display order forms ONE global ring". At the Agent altitude the
 * display is the tab strip, which is the durable manual arrangement (D20).
 * At Team the display is the grid, which S6.3 sorts by Started or Activity
 * and deliberately never writes back. Feeding the ring the durable order
 * while Team is showing a different one is what makes the same command land
 * on "an apparently arbitrary tile": the step is one place in the STRIP and
 * lands wherever that Session happens to sit in the GRID.
 *
 * The trace below records both targets side by side, which is what the
 * roadmap asked for, and then asserts they agree.
 */

const T0 = 1_722_000_000_000;
const MIN = 60_000;

const tab = (id: string, startedAt: number): WorkspaceTab =>
  ({
    id,
    durableSessionId: `durable-${id}`,
    sessionId: `session-${id}`,
    harness: 'claude',
    title: id,
    titleKind: 'operator',
    cwd: '/workspace',
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    harnessSessionId: null,
    initialTask: null,
    startedAt,
    roadmapItemId: null,
  }) as WorkspaceTab;

/** Manual arrangement deliberately disagrees with start time: the operator
 *  drags tabs where he wants them, and Team's stored default is oldest
 *  first. Both orders are real; neither is wrong. */
const FLEET: Project[] = [
  {
    dir: '/workspace/exawatt',
    name: 'exawatt',
    color: '#19E6FF',
    activeTabId: 'exa-1',
    tabs: [
      tab('exa-1', T0 + 9 * MIN), // newest, dragged to the front
      tab('exa-2', T0 + 2 * MIN),
      tab('exa-3', T0 + 5 * MIN),
    ],
  },
  {
    dir: '/workspace/stock',
    name: 'Stock',
    color: '#FFB86B',
    activeTabId: 'stock-1',
    tabs: [tab('stock-1', T0 + 6 * MIN), tab('stock-2', T0 + 3 * MIN)],
  },
] as unknown as Project[];

const SIGNALS: TeamOrderSignals = { activity: {}, attention: {} };

/** Every stop Team paints, in the reading order of the grid. */
const teamStops = (projects: readonly Project[]) =>
  projects.flatMap(project =>
    project.tabs.length > 0
      ? project.tabs.map(t => `${project.dir}#${t.id}`)
      : [`${project.dir}#`]
  );

const ringStop = (
  projects: readonly Project[],
  activeDir: string,
  delta: 1 | -1
) => {
  const target = nextTabInRing(projects, activeDir, delta);
  return target ? `${target.dir}#${target.tab?.id ?? ''}` : null;
};

describe('the tab ring at the Team altitude (BUG-021)', () => {
  it('paints a grid whose order really does differ from the strip', () => {
    // If these ever coincide the trace below proves nothing, so it is
    // asserted rather than assumed.
    const strip = teamStops(FLEET);
    const grid = teamStops(teamViewProjects(FLEET, 'started', SIGNALS));
    expect(grid).not.toEqual(strip);
    expect(grid).toEqual([
      '/workspace/exawatt#exa-2',
      '/workspace/exawatt#exa-3',
      '/workspace/exawatt#exa-1',
      '/workspace/stock#stock-2',
      '/workspace/stock#stock-1',
    ]);
  });

  /**
   * The trace the roadmap asked for. From every stop Team paints, step the
   * ring once and record, side by side:
   *
   *   `ring`  where the ring goes when it is fed the DURABLE arrangement,
   *           which is what `cycleTab` used to do — the strip's next Session
   *   `grid`  the tile the operator can actually see next
   */
  it('disagreed with the grid while the ring was fed the durable arrangement', () => {
    const view = teamViewProjects(FLEET, 'started', SIGNALS);
    const stops = teamStops(view);
    const rows = stops.map((stop, index) => {
      const [dir, id] = stop.split('#');
      const at = FLEET.map(project =>
        project.dir === dir ? { ...project, activeTabId: id } : project
      );
      return {
        stop,
        ring: ringStop(at, dir, 1),
        grid: stops[(index + 1) % stops.length],
      };
    });
    // the reproduction: pressing ⌘⇧] lands somewhere the operator did not
    // point at, from most tiles on screen
    expect(
      rows
        .filter(row => row.ring !== row.grid)
        .map(row => `${row.stop} -> ring ${row.ring}, saw ${row.grid}`)
    ).toEqual([
      // one press crosses into another Project while the tile the operator
      // is looking at sits right there in the same one
      '/workspace/exawatt#exa-3 -> ring /workspace/stock#stock-1, saw /workspace/exawatt#exa-1',
      '/workspace/exawatt#exa-1 -> ring /workspace/exawatt#exa-2, saw /workspace/stock#stock-2',
      '/workspace/stock#stock-2 -> ring /workspace/exawatt#exa-1, saw /workspace/stock#stock-1',
      '/workspace/stock#stock-1 -> ring /workspace/stock#stock-2, saw /workspace/exawatt#exa-2',
    ]);
    // four of the five tiles on screen, so it is not an edge case
    expect(rows).toHaveLength(5);
  });

  it('steps to the tile the operator can see next, in both directions', () => {
    const view = teamViewProjects(FLEET, 'started', SIGNALS);
    const stops = teamStops(view);

    for (const [index, stop] of stops.entries()) {
      const [dir, id] = stop.split('#');
      const atStop = view.map(project =>
        project.dir === dir ? { ...project, activeTabId: id } : project
      );

      const forward = ringStop(atStop, dir, 1);
      const back = ringStop(atStop, dir, -1);

      expect({ stop, forward, back }).toEqual({
        stop,
        forward: stops[(index + 1) % stops.length],
        back: stops[(index - 1 + stops.length) % stops.length],
      });
    }
  });

  it('still walks the strip when the strip is what is on screen', () => {
    // The Agent altitude is unchanged: the ring follows the durable manual
    // arrangement, because that is the order the strip displays.
    const strip = teamStops(FLEET);
    expect(ringStop(FLEET, '/workspace/exawatt', 1)).toBe(strip[1]);
    expect(ringStop(FLEET, '/workspace/exawatt', -1)).toBe(
      strip[strip.length - 1]
    );
  });

  it('follows the Activity sort too, not just the stored default', () => {
    const signals: TeamOrderSignals = {
      activity: { 'session-exa-3': true },
      attention: {},
    };
    const view = teamViewProjects(FLEET, 'activity', signals);
    const stops = teamStops(view);
    expect(stops[0]).toBe('/workspace/exawatt#exa-3');
    const atFirst = view.map(project =>
      project.dir === '/workspace/exawatt'
        ? { ...project, activeTabId: 'exa-3' }
        : project
    );
    expect(ringStop(atFirst, '/workspace/exawatt', 1)).toBe(stops[1]);
  });

  it('keeps orderTeamTabs as the one producer of that order', () => {
    // teamViewProjects must BE the per-Project sort, not a second copy of
    // it: two producers of one order is how the strip and the grid drifted
    // apart in the first place.
    for (const mode of ['started', 'activity'] as const) {
      const view = teamViewProjects(FLEET, mode, SIGNALS);
      for (const [index, project] of view.entries()) {
        expect(project.tabs).toEqual(
          orderTeamTabs(FLEET[index].tabs, mode, SIGNALS)
        );
        expect(project.dir).toBe(FLEET[index].dir);
      }
    }
  });
});
